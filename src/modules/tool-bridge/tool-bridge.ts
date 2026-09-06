// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: src/modules/tool-bridge/tool-bridge.ts
// 职责: 工具桥接抽象类 + 本地默认实现（Sprint 3 P1）。
//   - ToolBridge（抽象）：list / call 语义、权限分层与输入 schema 校验在基类收敛，
//     子类只需提供定义表 + invoke 实现（未来可扩展为 MCP server 适配层）
//   - LocalToolBridge：进程内把工具实现绑定为 handler 的默认实现
//   - 错误码类型化；高风险工具在无审批通道时返回 blocked（不静默执行）

import type {
  BridgeCallContext,
  BridgeHandler,
  BridgeHandlerEntry,
  BridgeInvocationResponse,
  BridgePermission,
  BridgeToolDefinition,
  IToolBridge
} from '../../interfaces/tool-bridge.interface';

/** 桥接错误码 */
export type ToolBridgeErrorCode =
  | 'TOOL_BRIDGE_NOT_FOUND'
  | 'TOOL_BRIDGE_INVALID_ARGUMENTS'
  | 'TOOL_BRIDGE_BLOCKED'
  | 'TOOL_BRIDGE_HANDLER_FAILED';

/** 桥接类型化错误 */
export class ToolBridgeError extends Error {
  readonly code: ToolBridgeErrorCode;

  constructor(code: ToolBridgeErrorCode, message: string) {
    super(message);
    this.name = 'ToolBridgeError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 最小输入 schema 校验：{ type:'object', properties:{...}, required?: string[] }。
 * 仅校验 properties 中声明的类型（string/array/number/boolean/object），未知属性忽略。
 * 返回问题列表；空数组即通过。非法 schema 声明视为不校验（宽松，防误拦）。
 */
export function validateArguments(
  args: Readonly<Record<string, unknown>>,
  inputSchema: Readonly<Record<string, unknown>>
): readonly string[] {
  const issues: string[] = [];
  if (!isRecord(inputSchema)) {
    return issues;
  }
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((item): item is string => typeof item === 'string')
    : [];
  for (const key of required) {
    if (args[key] === undefined) {
      issues.push(`缺少必填参数 ${key}`);
    }
  }
  const properties = inputSchema.properties;
  if (!isRecord(properties)) {
    return issues;
  }
  for (const [key, value] of Object.entries(properties)) {
    if (args[key] === undefined) {
      continue;
    }
    if (!isRecord(value)) {
      continue;
    }
    const declared = value.type;
    const actual = args[key];
    if (declared === 'string' && typeof actual !== 'string') {
      issues.push(`${key} 必须是字符串`);
    } else if (declared === 'number' && typeof actual !== 'number') {
      issues.push(`${key} 必须是数字`);
    } else if (declared === 'boolean' && typeof actual !== 'boolean') {
      issues.push(`${key} 必须是布尔值`);
    } else if (declared === 'array' && !Array.isArray(actual)) {
      issues.push(`${key} 必须是数组`);
    } else if (declared === 'object' && !isRecord(actual)) {
      issues.push(`${key} 必须是对象`);
    }
  }
  return issues;
}

export interface ToolBridgeOptions {
  /** 审批通道：approval_required 工具在执行前调用；缺省即视为无审批能力（返回 blocked） */
  readonly approver?: (
    name: string,
    args: Readonly<Record<string, unknown>>
  ) => Promise<boolean> | boolean;
}

/** 工具桥接抽象基类（list/call 通用语义） */
export abstract class ToolBridge implements IToolBridge {
  private readonly approver:
    | ((name: string, args: Readonly<Record<string, unknown>>) => Promise<boolean> | boolean)
    | undefined;

  constructor(options: ToolBridgeOptions = {}) {
    this.approver = options.approver;
  }

  /** 子类实现：返回工具定义 + 执行处理器 */
  protected abstract entries(): readonly BridgeHandlerEntry[];

  list(): readonly BridgeToolDefinition[] {
    return [...this.entries()].map((entry) => ({
      ...entry.definition,
      input_schema: { ...entry.definition.input_schema }
    }));
  }

  async call(request: {
    readonly name: string;
    readonly arguments?: Readonly<Record<string, unknown>>;
    readonly trace_id?: string;
  }): Promise<BridgeInvocationResponse> {
    const args = request.arguments ?? {};
    const ctx: BridgeCallContext = {
      ...(request.trace_id !== undefined ? { trace_id: request.trace_id } : {})
    };
    const entry = this.entries().find((item) => item.definition.name === request.name);
    if (entry === undefined) {
      return notFound(request.name);
    }
    const permission = entry.definition.permission;
    if (permission === 'approval_required') {
      if (this.approver === undefined) {
        return blocked(request.name, '审批通道未配置（approval_required）');
      }
      const approved = await this.approver(request.name, args);
      if (!approved) {
        return blocked(request.name, '审批未通过');
      }
    }
    const issues = validateArguments(args, entry.definition.input_schema);
    if (issues.length > 0) {
      return {
        name: request.name,
        status: 'error',
        error: { code: 'TOOL_BRIDGE_INVALID_ARGUMENTS', message: issues.join('; ') }
      };
    }
    try {
      const output = await entry.handler(args, ctx);
      return { name: request.name, status: 'ok', output };
    } catch (err) {
      return {
        name: request.name,
        status: 'error',
        error: {
          code: 'TOOL_BRIDGE_HANDLER_FAILED',
          message: err instanceof Error ? err.message : String(err)
        }
      };
    }
  }
}

function notFound(name: string): BridgeInvocationResponse {
  return {
    name,
    status: 'not_found',
    error: { code: 'TOOL_BRIDGE_NOT_FOUND', message: `未知工具 ${name}` }
  };
}

function blocked(name: string, message: string): BridgeInvocationResponse {
  return { name, status: 'blocked', error: { code: 'TOOL_BRIDGE_BLOCKED', message } };
}

export interface LocalToolBridgeOptions extends ToolBridgeOptions {
  readonly entries: readonly BridgeHandlerEntry[];
}

/** 进程内本地工具桥接（默认实现：绑定既有工具 handler） */
export class LocalToolBridge extends ToolBridge {
  private readonly registered: readonly BridgeHandlerEntry[];

  constructor(options: LocalToolBridgeOptions) {
    super(options);
    this.registered = options.entries;
  }

  protected entries(): readonly BridgeHandlerEntry[] {
    return this.registered;
  }
}

/** 便捷构造 BridgeHandlerEntry */
export function bridgeEntry(
  name: string,
  description: string,
  inputSchema: Readonly<Record<string, unknown>>,
  permission: BridgePermission,
  handler: BridgeHandler
): BridgeHandlerEntry {
  return {
    definition: { name, description, input_schema: inputSchema, permission },
    handler
  };
}

