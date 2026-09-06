// AKO_studio - Design Agent v1.0.0
// 文件名: src/core/dsh-adapter.ts
// 职责: DSH 运行时防腐层（Anti-Corruption Layer）。
//   - 领域层只依赖 interfaces/dsh.interface.ts 的最小契约
//   - 真实 @deepseek-ai/dsh-agent 通过默认 loader 运行时探测 + 鸭子类型归一化；
//     支持 CJS require 与 ESM 动态导入（DeepSeek Harness 为 type:module，仅 ESM 可加载）
//   - 包未安装/API 漂移/版本被锁拒绝时返回类型化错误，领域层按 fallback 策略降级
//   - 测试可通过注入 runtimeLoader 提供假运行时，无需真实 DSH 环境

import { pathToFileURL } from 'node:url';

import type { Logger } from './logger';

import type {
  DshAdapterOptions,
  DshAdapterState,
  DshAdapterStatus,
  DshMessage,
  DshRuntime,
  DshRuntimeErrorCode,
  DshRuntimeInfo,
  DshRuntimeLoader,
  DshRuntimeSession,
  DshSessionResult,
  DshToolDefinition,
  VersionGuardianLike
} from '../interfaces/dsh.interface';

const DSH_RUNTIME_PACKAGE = '@deepseek-ai/dsh-agent';

/** DSH 运行时类型化错误（禁止静默吞掉导致降级错位） */
export class DshRuntimeError extends Error {
  readonly code: DshRuntimeErrorCode;

  constructor(code: DshRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'DshRuntimeError';
    this.code = code;
  }
}

type LoggerLike = Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

/** CommonJS 模块导出的解包（兼容 module.exports / esModuleInterop 默认导出形态） */
function unwrapModuleExports(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const candidate = value.default ?? value;
  return isRecord(candidate) ? candidate : {};
}

function parseInfo(raw: unknown): DshRuntimeInfo | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = raw.name;
  const version = raw.version;
  const apiVersion = raw.api_version;
  if (
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    typeof apiVersion !== 'string'
  ) {
    return null;
  }
  return { name, version, api_version: apiVersion };
}

function isRuntimeLike(candidate: Record<string, unknown>): boolean {
  return (
    isFunction(candidate.openSession) &&
    isFunction(candidate.close) &&
    parseInfo(candidate.info) !== null
  );
}

/** 鸭子类型收敛：形态满足最小契约即视为 DshRuntime */
function toRuntimeLike(candidate: Record<string, unknown>): DshRuntime | null {
  if (!isRuntimeLike(candidate)) {
    return null;
  }
  return candidate as unknown as DshRuntime;
}

export const defaultDshRuntimeLoader: DshRuntimeLoader = async (): Promise<DshRuntime> => {
  let resolved: string | undefined;
  try {
    resolved = require.resolve(DSH_RUNTIME_PACKAGE);
  } catch {
    throw new DshRuntimeError(
      'DSH_NOT_INSTALLED',
      `${DSH_RUNTIME_PACKAGE} 未安装（版本锁定契约见 config/dsh-lock.yml，安装后防腐层自动接入）`
    );
  }
  let rawModule: unknown;
  try {
    // CJS 优先；真实 Harness 是 ESM-only，命中 ERR_REQUIRE_ESM 时切到动态导入
    rawModule = require(resolved);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ERR_REQUIRE_ESM' || nodeErr.code === 'ERR_REQUIRE_ASYNC_MODULE') {
      try {
        rawModule = await import(pathToFileURL(resolved).href);
      } catch (importErr) {
        throw new DshRuntimeError(
          'DSH_RUNTIME_FAULT',
          `加载 ${DSH_RUNTIME_PACKAGE}（ESM 通道）失败：${String(importErr)}`
        );
      }
    } else {
      throw new DshRuntimeError('DSH_RUNTIME_FAULT', `加载 ${DSH_RUNTIME_PACKAGE} 失败：${String(err)}`);
    }
  }
  const api = unwrapModuleExports(rawModule);
  const directRuntime = toRuntimeLike(api);
  if (directRuntime !== null) {
    return directRuntime;
  }
  // 兼容“工厂形态”：export function createRuntime(...)
  const factory = api.createRuntime;
  if (isFunction(factory)) {
    try {
      const created = await factory();
      const createdApi = unwrapModuleExports(created);
      const createdRuntime = toRuntimeLike(createdApi);
      if (createdRuntime !== null) {
        return createdRuntime;
      }
    } catch (err) {
      throw new DshRuntimeError('DSH_RUNTIME_FAULT', `createRuntime 失败：${String(err)}`);
    }
  }
  throw new DshRuntimeError(
    'DSH_SURFACE_MISMATCH',
    `${DSH_RUNTIME_PACKAGE} 的导出不满足防腐层契约（需要 openSession/close/info 或 createRuntime 工厂），实际导出键：${describeKeys(api)}`
  );
};

/** 导出键描述（用于 mismatch 诊断；最长 12 个） */
function describeKeys(record: Record<string, unknown>): string {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return '(空)';
  }
  return keys.length <= 12 ? keys.join(', ') : `${keys.slice(0, 12).join(', ')}, …(${keys.length} 个)`;
}

export interface DshCompatibilityProbe {
  readonly package_name: string;
  readonly present: boolean;
  readonly surface: 'runtime-ready' | 'mismatch' | 'not-installed' | 'faulted';
  readonly exported_keys: readonly string[];
  readonly reason?: string;
}

/**
 * 兼容性探针：真实加载 @deepseek-ai/dsh-agent 并报告适配结论（供 P1 E2E 与排障）。
 * 探针不抛错，总是返回结构化结果。
 */
export async function probeDshCompatibility(): Promise<DshCompatibilityProbe> {
  try {
    const runtime = await defaultDshRuntimeLoader();
    return {
      package_name: DSH_RUNTIME_PACKAGE,
      present: true,
      surface: 'runtime-ready',
      exported_keys: [],
      reason: `${runtime.info.name}@${runtime.info.version} 满足防腐层最小契约`
    };
  } catch (err) {
    const typed = err instanceof DshRuntimeError ? err : new DshRuntimeError('DSH_RUNTIME_FAULT', String(err));
    const notInstalled = typed.code === 'DSH_NOT_INSTALLED';
    const mismatch = typed.code === 'DSH_SURFACE_MISMATCH';
    return {
      package_name: DSH_RUNTIME_PACKAGE,
      present: !notInstalled,
      surface: notInstalled ? 'not-installed' : mismatch ? 'mismatch' : 'faulted',
      exported_keys: mismatch ? extractKeyHints(typed.message) : [],
      reason: typed.message
    };
  }
}

/** 从 mismatch 消息中回填导出键（格式见 describeKeys） */
function extractKeyHints(message: string): string[] {
  const idx = message.indexOf('实际导出键：');
  if (idx < 0) {
    return [];
  }
  const raw = message.slice(idx + '实际导出键：'.length).replace('(空)', '').split(',');
  return raw
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('…('))
    .map((part) => part.replace(/\.\.\.\(\d+ 个\)/, ''))
    .filter((part) => part.length > 0);
}

function stateOfCode(code: DshRuntimeErrorCode): DshAdapterState {
  switch (code) {
    case 'DSH_NOT_INSTALLED':
      return 'runtime-missing';
    case 'DSH_SURFACE_MISMATCH':
      return 'surface-mismatch';
    case 'DSH_VERSION_BLOCKED':
      return 'version-blocked';
    default:
      return 'faulted';
  }
}

export class DshAdapter {
  private readonly loader: DshRuntimeLoader;
  private readonly lockGuardian: VersionGuardianLike | undefined;
  private readonly tools: readonly DshToolDefinition[];
  private readonly logger: LoggerLike | undefined;
  private readonly now: () => Date;
  private runtime: DshRuntime | null = null;
  private status: DshAdapterStatus | null = null;

  constructor(options: DshAdapterOptions = {}, logger?: LoggerLike) {
    this.loader = options.runtimeLoader ?? defaultDshRuntimeLoader;
    this.lockGuardian = options.lockGuardian;
    this.logger = logger;
    this.now = options.now ?? ((): Date => new Date());
    this.tools = options.tools ?? [];
  }

  /** 最近一次探测结果（尚未探测为 null） */
  getStatus(): DshAdapterStatus | null {
    return this.status;
  }

  /**
   * 探测并接入运行时：加载 → 版本闸门 → 就绪。
   * 探测失败以状态快照返回（不抛出），便于启动期做降级决策。
   */
  async initialize(): Promise<DshAdapterStatus> {
    const checkedAt = this.now().toISOString();
    let runtime: DshRuntime;
    try {
      runtime = await this.loader();
    } catch (err) {
      const typed =
        err instanceof DshRuntimeError
          ? err
          : new DshRuntimeError('DSH_RUNTIME_FAULT', String(err));
      this.runtime = null;
      this.status = {
        state: stateOfCode(typed.code),
        checked_at: checkedAt,
        error_code: typed.code,
        reason: typed.message
      };
      this.logger?.warn(`DSH 运行时不可用（${typed.code}）：${typed.message}`);
      return this.status;
    }

    // 版本闸门：仅当运行时声明名被锁定清单跟踪时强制校验
    if (this.lockGuardian !== undefined) {
      const check = this.lockGuardian.checkPackage(runtime.info.name);
      if (check.state === 'blocked' || check.state === 'missing') {
        this.status = {
          state: 'version-blocked',
          runtime: runtime.info,
          checked_at: checkedAt,
          error_code: 'DSH_VERSION_BLOCKED',
          reason: `${runtime.info.name} ${runtime.info.version}：${check.message}`
        };
        this.runtime = null;
        try {
          await runtime.close();
        } catch {
          // 关闭失败不影响状态判定
        }
        this.logger?.warn(`DSH 版本闸门拦截：${this.status.reason}`);
        return this.status;
      }
    }

    this.runtime = runtime;
    this.status = {
      state: 'runtime-ready',
      runtime: runtime.info,
      checked_at: checkedAt
    };
    this.logger?.info(
      `DSH 运行时就绪：${runtime.info.name}@${runtime.info.version} (api ${runtime.info.api_version})`
    );
    return this.status;
  }

  /** 运行期断言：就绪才返回运行时，否则抛类型化错误 */
  private requireRuntime(): DshRuntime {
    const snapshot = this.status;
    if (snapshot !== null && snapshot.state === 'runtime-ready' && this.runtime !== null) {
      return this.runtime;
    }
    const code: DshRuntimeErrorCode =
      snapshot === null ? 'DSH_RUNTIME_FAULT' : (snapshot.error_code ?? 'DSH_RUNTIME_FAULT');
    throw new DshRuntimeError(
      code,
      snapshot?.reason ?? 'DSH 运行时尚未就绪，请先执行 initialize()'
    );
  }

  /**
   * 执行一轮会话：向运行时发送消息并返回助手消息。
   * @throws DshRuntimeError 运行时缺失 / 版本被锁 / 会话失败时抛出
   */
  async runSession(messages: readonly DshMessage[]): Promise<DshSessionResult> {
    const runtime = this.requireRuntime();
    let session: DshRuntimeSession;
    try {
      session = await runtime.openSession(this.tools);
    } catch (err) {
      throw new DshRuntimeError('DSH_SESSION_FAILED', `创建会话失败：${String(err)}`);
    }
    try {
      const replies = await session.send(messages);
      return {
        session_id: session.id,
        messages: [...replies],
        runtime: runtime.info
      };
    } catch (err) {
      throw new DshRuntimeError('DSH_SESSION_FAILED', `会话执行失败：${String(err)}`);
    } finally {
      try {
        await session.abort();
      } catch {
        // 会话已结束，忽略关闭异常
      }
    }
  }

  /** 释放运行时资源 */
  async close(): Promise<void> {
    if (this.runtime !== null) {
      try {
        await this.runtime.close();
      } catch {
        // 忽略关闭异常
      }
      this.runtime = null;
      this.status = null;
    }
  }
}

