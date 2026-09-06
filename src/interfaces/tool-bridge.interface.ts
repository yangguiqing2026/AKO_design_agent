// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: src/interfaces/tool-bridge.interface.ts
// 职责: 工具桥接抽象契约（Sprint 3 P1，MCP 工具外部化预留，对标白皮书 §4.2 注册 Tools / FI-II-03）。
//   - 桥接层命名与 MCP 对齐：list_tools（list）/ call_tool（call）
//   - 权限分层：general / sandbox / approval_required（高风险操作需审批通道）
//   - 无 any：入参/出参均为显式类型；schema 校验在实现层
//   - 真实 MCP SDK/协议归 v2.0（D3）；本接口为进程内桥接与未来 server 的共同契约

/** 工具权限层级 */
export type BridgePermission = 'general' | 'sandbox' | 'approval_required';

/** 桥接工具定义（对齐工具注册表与 MCP list_tools 形态） */
export interface BridgeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Readonly<Record<string, unknown>>;
  readonly permission: BridgePermission;
}

/** 调用上下文（trace 透传） */
export interface BridgeCallContext {
  readonly trace_id?: string;
}

/** 工具调用处理器 */
export type BridgeHandler = (
  args: Readonly<Record<string, unknown>>,
  ctx: BridgeCallContext
) => Promise<unknown> | unknown;

/** 调用结果状态 */
export type BridgeInvocationStatus = 'ok' | 'blocked' | 'error' | 'not_found';

/** 调用响应（结构化、可序列化） */
export interface BridgeInvocationResponse {
  readonly name: string;
  readonly status: BridgeInvocationStatus;
  readonly output?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

/** 桥接契约（list / call，MCP 语义前缀） */
export interface IToolBridge {
  list(): readonly BridgeToolDefinition[];
  call(request: { readonly name: string; readonly arguments?: Readonly<Record<string, unknown>>; readonly trace_id?: string }): Promise<BridgeInvocationResponse>;
}

/** 单条注册条目（定义 + 实现） */
export interface BridgeHandlerEntry {
  readonly definition: BridgeToolDefinition;
  readonly handler: BridgeHandler;
}
