// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: src/interfaces/cordis-agent.interface.ts
// 职责: Cordis-4 运行时归一化契约（Sprint 3 P0，替代 legacy openSession 假契约）。
//   证据基线（Sprint 1 真包探针结论，见 .ako-compliance-report §P1）：
//     - 真实 DeepSeek Harness = Cordis-4 插件生态 + ESM-only（type: module）
//     - 导出形态为 ctx.agents.register/create 与 Agent handle（inbox/followup/steer…）
//     - 不含本项目旧防腐层的 openSession/close/info
//   设计原则：宁窄勿宽——只声明已确认的归一化面；形态若与实测导出不一致，
//   由 loader 鸭子类型归一化并在 mismatch 中输出实际导出键（不静默成功）。

import type { DshToolDefinition } from './dsh.interface';

/** 工具定义复用 DSH 既有形状（name/description/input_schema） */
export type CordisToolDefinition = DshToolDefinition;

/** 单轮 Agent 执行结果（归一化窄面） */
export interface CordisAgentTurn {
  readonly content: string;
  readonly tool_calls?: readonly {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  }[];
  /** 首字时延（TTFT）/ 轮次耗时（毫秒），供时间熔断与审计 */
  readonly latency_ms?: number;
}

/** Cordis Agent handle（归一化子集；以 fixture 快照校准） */
export interface CordisAgentHandle {
  readonly id: string;
  /** 主对话入口（对应用户消息发送） */
  send(input: { readonly text: string }): Promise<CordisAgentTurn>;
  /** 后续追问（真实包 handle 提供时存在） */
  followup?(prompt: string): Promise<CordisAgentTurn>;
  /** 运行时转向指令（真实包 handle 提供时存在） */
  steer?(directive: string): Promise<CordisAgentTurn>;
  abort(): Promise<void>;
}

/** Agent 定义（create/register 的入参窄面） */
export interface CordisAgentDefinition {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly system_prompt?: string;
  readonly tools?: readonly CordisToolDefinition[];
  readonly model?: string;
}

/** ctx.agents.* 插件 API（归一化窄面） */
export interface CordisAgentsApi {
  create(definition: CordisAgentDefinition): Promise<CordisAgentHandle> | CordisAgentHandle;
  register?(definition: CordisAgentDefinition): Promise<CordisAgentHandle> | CordisAgentHandle;
  list?(): readonly CordisAgentDefinition[];
}

/** 归一化后的 Cordis 运行时形态 */
export interface CordisAgentRuntimeLike {
  readonly name: string;
  readonly version: string;
  readonly api_version: string;
  readonly agents: CordisAgentsApi;
}

/** Cordis 运行时加载器（真实 ESM 包 / 注入假实现） */
export type CordisRuntimeLoader = () => Promise<CordisAgentRuntimeLike>;

/** Cordis 适配器状态 */
export type CordisAdapterState =
  | 'cordis-ready'
  | 'runtime-missing'
  | 'version-blocked'
  | 'surface-mismatch'
  | 'faulted';

/** Cordis 兼容性探针结果 */
export interface CordisCompatibilityProbe {
  readonly package_name: string;
  readonly present: boolean;
  readonly surface: 'cordis-ready' | 'mismatch' | 'not-installed' | 'faulted';
  readonly exported_keys: readonly string[];
  /** 归一化后形态（导出 agents/name/version 等键），供 fixture 校准 */
  readonly shape?: {
    readonly runtime_name?: string;
    readonly runtime_version?: string;
    readonly has_agents_api: boolean;
    readonly agent_create: boolean;
    readonly agent_register: boolean;
  };
  readonly reason?: string;
}

/** Cordis 适配器状态快照 */
export interface CordisAdapterStatus {
  readonly state: CordisAdapterState;
  readonly runtime?: {
    readonly name: string;
    readonly version: string;
    readonly api_version: string;
  };
  readonly checked_at: string;
  readonly error_code?: string;
  readonly reason?: string;
}
