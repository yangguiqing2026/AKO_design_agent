// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: src/core/cordis-adapter.ts
// 职责: Cordis-4 运行时防腐层（Sprint 3 P0，替代 legacy openSession 适配）。
//   - 归一化：真实 @deepseek-ai/*（ESM-only）经加载器鸭子类型收敛到 CordisAgentRuntimeLike
//   - 诊断：mismatch 输出实际导出键；probeCordisCompatibility() 不抛错结构化报告
//   - 版本闸门：与 VersionGuardian 串联（仅当运行时名被锁定清单跟踪时强制校验）
//   - 证据基线：tests/fixtures/cordis-probe-report.fixture.ts 固化探针形态，loader 测试对齐该快照

import { pathToFileURL } from 'node:url';

import type { Logger } from './logger';
import type { VersionGuardianLike } from '../interfaces/dsh.interface';
import type {
  CordisAdapterState,
  CordisAdapterStatus,
  CordisAgentDefinition,
  CordisAgentHandle,
  CordisAgentRuntimeLike,
  CordisCompatibilityProbe,
  CordisRuntimeLoader,
  CordisToolDefinition
} from '../interfaces/cordis-agent.interface';

/** Cordis 运行时包名（与 dsh-lock.yml 跟踪的 @deepseek-ai/dsh-agent 同包） */
export const CORDIS_RUNTIME_PACKAGE = '@deepseek-ai/dsh-agent';

/** Cordis 错误码 */
export type CordisRuntimeErrorCode =
  | 'DSH_NOT_INSTALLED'
  | 'CORDIS_SURFACE_MISMATCH'
  | 'DSH_VERSION_BLOCKED'
  | 'CORDIS_AGENT_FAILED'
  | 'CORDIS_RUNTIME_FAULT';

/** Cordis 类型化错误 */
export class CordisRuntimeError extends Error {
  readonly code: CordisRuntimeErrorCode;

  constructor(code: CordisRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'CordisRuntimeError';
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

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** CommonJS 模块导出的解包（兼容 module.exports / esModuleInterop 默认导出形态） */
function unwrapModuleExports(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const candidate = value.default ?? value;
  return isRecord(candidate) ? candidate : {};
}

/** 解析运行时元信息（info 或根级 name/version/api_version） */
function parseMeta(meta: Record<string, unknown> | undefined): {
  readonly name: string;
  readonly version: string;
  readonly api_version: string;
} | null {
  if (meta === undefined) {
    return null;
  }
  const name = meta.name;
  const version = meta.version;
  const apiVersion = meta.api_version ?? meta.apiVersion;
  if (isString(name) && isString(version) && isString(apiVersion)) {
    return { name, version, api_version: apiVersion };
  }
  return null;
}

/** ctx.agents 形态检测：必须存在 create（register 可选） */
function isAgentsApiLike(candidate: unknown): boolean {
  if (!isRecord(candidate)) {
    return false;
  }
  if (!isFunction(candidate.create)) {
    return false;
  }
  return candidate.register === undefined || isFunction(candidate.register);
}

/** 从模块导出收敛为 CordisAgentRuntimeLike；不满足返回 null */
export function normalizeCordisModule(api: unknown): CordisAgentRuntimeLike | null {
  if (!isRecord(api)) {
    return null;
  }
  const agents = api.agents;
  if (!isAgentsApiLike(agents)) {
    return null;
  }
  const metaRecord = isRecord(api.info) ? api.info : api;
  const meta = parseMeta(metaRecord);
  const name = meta?.name ?? CORDIS_RUNTIME_PACKAGE;
  const version = meta?.version ?? 'unknown';
  const apiVersion = meta?.api_version ?? 'cordis-4';
  return {
    name,
    version,
    api_version: apiVersion,
    agents: agents as CordisAgentRuntimeLike['agents']
  };
}

/** 默认 Cordis 加载器：真实 ESM-only 包；CJS 命中 ERR_REQUIRE_ESM 切动态导入 */
export const defaultCordisRuntimeLoader: CordisRuntimeLoader = async (): Promise<CordisAgentRuntimeLike> => {
  let resolved: string | undefined;
  try {
    resolved = require.resolve(CORDIS_RUNTIME_PACKAGE);
  } catch {
    throw new CordisRuntimeError(
      'DSH_NOT_INSTALLED',
      `${CORDIS_RUNTIME_PACKAGE} 未安装（版本锁定契约见 config/dsh-lock.yml；Cordis-4 归一化接入待受控私有源环境）`
    );
  }
  let rawModule: unknown;
  try {
    rawModule = require(resolved);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ERR_REQUIRE_ESM' || nodeErr.code === 'ERR_REQUIRE_ASYNC_MODULE') {
      try {
        rawModule = await import(pathToFileURL(resolved).href);
      } catch (importErr) {
        throw new CordisRuntimeError(
          'CORDIS_RUNTIME_FAULT',
          `加载 ${CORDIS_RUNTIME_PACKAGE}（ESM）失败：${String(importErr)}`
        );
      }
    } else {
      throw new CordisRuntimeError('CORDIS_RUNTIME_FAULT', `加载 ${CORDIS_RUNTIME_PACKAGE} 失败：${String(err)}`);
    }
  }
  const api = unwrapModuleExports(rawModule);
  const runtime = normalizeCordisModule(api);
  if (runtime !== null) {
    return runtime;
  }
  throw new CordisRuntimeError(
    'CORDIS_SURFACE_MISMATCH',
    `${CORDIS_RUNTIME_PACKAGE} 导出不满足 Cordis-4 归一化面（需要 ctx.agents.create/register），实际导出键：${describeKeys(api)}`
  );
};

/** 导出键描述（mismatch 诊断；最长 12 个） */
export function describeKeys(record: Record<string, unknown>): string {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return '(空)';
  }
  return keys.length <= 12 ? keys.join(', ') : `${keys.slice(0, 12).join(', ')}, …(${keys.length} 个)`;
}

/** Cordis 兼容性探针（不抛错，结构化输出；供 fixture 校准与排障） */
export async function probeCordisCompatibility(): Promise<CordisCompatibilityProbe> {
  try {
    const runtime = await defaultCordisRuntimeLoader();
    return {
      package_name: CORDIS_RUNTIME_PACKAGE,
      present: true,
      surface: 'cordis-ready',
      exported_keys: [],
      shape: {
        runtime_name: runtime.name,
        runtime_version: runtime.version,
        has_agents_api: true,
        agent_create: isFunction(runtime.agents.create),
        agent_register: isFunction(runtime.agents.register)
      },
      reason: `${runtime.name}@${runtime.version} 满足 Cordis-4 归一化契约`
    };
  } catch (err) {
    const typed =
      err instanceof CordisRuntimeError
        ? err
        : new CordisRuntimeError('CORDIS_RUNTIME_FAULT', String(err));
    const notInstalled = typed.code === 'DSH_NOT_INSTALLED';
    const mismatch = typed.code === 'CORDIS_SURFACE_MISMATCH';
    return {
      package_name: CORDIS_RUNTIME_PACKAGE,
      present: !notInstalled,
      surface: notInstalled ? 'not-installed' : mismatch ? 'mismatch' : 'faulted',
      exported_keys: mismatch ? extractKeyHints(typed.message) : [],
      shape: {
        has_agents_api: false,
        agent_create: false,
        agent_register: false
      },
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

function stateOfCode(code: CordisRuntimeErrorCode): CordisAdapterState {
  switch (code) {
    case 'DSH_NOT_INSTALLED':
      return 'runtime-missing';
    case 'CORDIS_SURFACE_MISMATCH':
      return 'surface-mismatch';
    case 'DSH_VERSION_BLOCKED':
      return 'version-blocked';
    default:
      return 'faulted';
  }
}

export interface CordisAdapterOptions {
  readonly runtimeLoader?: CordisRuntimeLoader;
  readonly lockGuardian?: VersionGuardianLike;
  readonly tools?: readonly CordisToolDefinition[];
  readonly now?: () => Date;
  readonly logger?: LoggerLike;
}

/** Cordis 适配器：探测 / 版本闸门 / 建 Agent / 执行轮次 */
export class CordisAdapter {
  private readonly loader: CordisRuntimeLoader;
  private readonly lockGuardian: VersionGuardianLike | undefined;
  private readonly tools: readonly CordisToolDefinition[];
  private readonly logger: LoggerLike | undefined;
  private readonly nowProvider: () => Date;
  private runtime: CordisAgentRuntimeLike | null = null;
  private status: CordisAdapterStatus | null = null;

  constructor(options: CordisAdapterOptions = {}) {
    this.loader = options.runtimeLoader ?? defaultCordisRuntimeLoader;
    this.lockGuardian = options.lockGuardian;
    this.tools = options.tools ?? [];
    this.logger = options.logger;
    this.nowProvider = options.now ?? ((): Date => new Date());
  }

  getStatus(): CordisAdapterStatus | null {
    return this.status;
  }

  /** 探测并接入：加载 → 版本闸门 → cordis-ready（失败以状态快照返回） */
  async initialize(): Promise<CordisAdapterStatus> {
    const checkedAt = this.nowProvider().toISOString();
    let runtime: CordisAgentRuntimeLike;
    try {
      runtime = await this.loader();
    } catch (err) {
      const typed =
        err instanceof CordisRuntimeError
          ? err
          : new CordisRuntimeError('CORDIS_RUNTIME_FAULT', String(err));
      this.runtime = null;
      this.status = {
        state: stateOfCode(typed.code),
        checked_at: checkedAt,
        error_code: typed.code,
        reason: typed.message
      };
      this.logger?.warn(`Cordis 运行时不可用（${typed.code}）：${typed.message}`);
      return this.status;
    }

    // 版本闸门：仅当运行时名在锁定清单内强制校验；未跟踪包跳过（防 checkPackage 抛错）
    if (this.lockGuardian !== undefined) {
      let blocked = false;
      let blockReason: string | undefined;
      try {
        const check = this.lockGuardian.checkPackage(runtime.name);
        blocked = check.state === 'blocked' || check.state === 'missing';
        blockReason = `${runtime.name} ${runtime.version}：${check.message}`;
      } catch {
        blocked = false; // 未跟踪包：版本闸门放行
      }
      if (blocked) {
        this.status = {
          state: 'version-blocked',
          runtime: { name: runtime.name, version: runtime.version, api_version: runtime.api_version },
          checked_at: checkedAt,
          error_code: 'DSH_VERSION_BLOCKED',
          reason: blockReason
        };
        this.runtime = null;
        this.logger?.warn(`Cordis 版本闸门拦截：${blockReason ?? ''}`);
        return this.status;
      }
    }

    this.runtime = runtime;
    this.status = {
      state: 'cordis-ready',
      runtime: { name: runtime.name, version: runtime.version, api_version: runtime.api_version },
      checked_at: checkedAt
    };
    this.logger?.info(`Cordis 运行时就绪：${runtime.name}@${runtime.version} (api ${runtime.api_version})`);
    return this.status;
  }

  /** 就绪断言 */
  private requireRuntime(): CordisAgentRuntimeLike {
    const snapshot = this.status;
    if (snapshot !== null && snapshot.state === 'cordis-ready' && this.runtime !== null) {
      return this.runtime;
    }
    const code: CordisRuntimeErrorCode =
      snapshot?.error_code === undefined
        ? 'CORDIS_RUNTIME_FAULT'
        : (snapshot.error_code as CordisRuntimeErrorCode);
    throw new CordisRuntimeError(code, snapshot?.reason ?? 'Cordis 运行时尚未就绪，请先 initialize()');
  }

  /** 创建 Agent（经 ctx.agents.create，失败回退 register） */
  async createAgent(def: CordisAgentDefinition): Promise<CordisAgentHandle> {
    const runtime = this.requireRuntime();
    const fullDef: CordisAgentDefinition = {
      ...def,
      ...(def.tools === undefined && this.tools.length > 0 ? { tools: this.tools } : {})
    };
    try {
      return await runtime.agents.create(fullDef);
    } catch (err) {
      const typed = new CordisRuntimeError('CORDIS_AGENT_FAILED', `createAgent 失败：${String(err)}`);
      if (isFunction(runtime.agents.register)) {
        try {
          return await runtime.agents.register(fullDef);
        } catch {
          throw typed;
        }
      }
      throw typed;
    }
  }

  /** 关闭释放（无跨进程资源时为空操作） */
  async close(): Promise<void> {
    this.runtime = null;
    this.status = null;
  }
}

