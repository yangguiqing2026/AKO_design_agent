// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/interfaces/dsh.interface.ts
// 职责: DSH 运行时防腐层契约（无 any）。适配器只依赖本接口，
//       真实 @deepseek-ai/* 包通过运行时探测做鸭子类型归一化。
//
// Sprint 3 说明（deprecated legacy）：
//   本文件承载 v0.1.x 探针期的“openSession 假契约”，仅供既有 FakeDshRuntime /
//   测试与历史适配器使用。真实 DeepSeek Harness 是 Cordis-4 插件生态 + ESM-only，
//   新接入统一走 ./cordis-agent.interface.ts（ctx.agents.* + Agent handle 归一化面）。

import type { VersionCheckResult } from './version.interface';

/** 会话消息角色 */
export type DshMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 会话消息 */
export interface DshMessage {
  readonly role: DshMessageRole;
  readonly content: string;
  readonly name?: string;          // tool 消息的工具名
  readonly tool_call_id?: string;  // tool 消息关联的工具调用
}

/** DSH 运行时错误码 */
export type DshRuntimeErrorCode =
  | 'DSH_NOT_INSTALLED'
  | 'DSH_SURFACE_MISMATCH'
  | 'DSH_VERSION_BLOCKED'
  | 'DSH_SESSION_FAILED'
  | 'DSH_RUNTIME_FAULT';

/** 适配器状态 */
export type DshAdapterState =
  | 'runtime-ready'
  | 'runtime-missing'
  | 'version-blocked'
  | 'surface-mismatch'
  | 'faulted';

/** 归一化后的运行时元信息 */
export interface DshRuntimeInfo {
  readonly name: string;
  readonly version: string;
  readonly api_version: string;
}

/** 注册到运行时环境的工具定义 */
export interface DshToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/**
 * 适配器对底层运行时的最小依赖契约。
 * 真实 DSH 实现若 API 漂移，只需在 loader 层做归一化适配，领域层不受影响。
 */
export interface DshRuntimeSession {
  readonly id: string;
  send(messages: readonly DshMessage[]): Promise<readonly DshMessage[]>;
  abort(): Promise<void>;
}

export interface DshRuntime {
  readonly info: DshRuntimeInfo;
  openSession(tools?: readonly DshToolDefinition[]): Promise<DshRuntimeSession>;
  close(): Promise<void>;
}

/** 运行时加载器：真实环境加载 @deepseek-ai/*，测试环境注入假实现 */
export type DshRuntimeLoader = () => Promise<DshRuntime>;

/** 版本守护最小结构依赖（避免适配器与实现强耦合） */
export interface VersionGuardianLike {
  checkPackage(packageName: string): VersionCheckResult;
}

/** 适配器构造选项 */
export interface DshAdapterOptions {
  readonly runtimeLoader?: DshRuntimeLoader;
  readonly lockGuardian?: VersionGuardianLike;
  readonly tools?: readonly DshToolDefinition[];
  readonly now?: () => Date;
}

/** 适配器健康/能力状态快照 */
export interface DshAdapterStatus {
  readonly state: DshAdapterState;
  readonly runtime?: DshRuntimeInfo;
  readonly checked_at: string;
  readonly error_code?: DshRuntimeErrorCode;
  readonly reason?: string;
}

/** 单轮会话执行结果 */
export interface DshSessionResult {
  readonly session_id: string;
  readonly messages: readonly DshMessage[];
  readonly runtime: DshRuntimeInfo;
}
