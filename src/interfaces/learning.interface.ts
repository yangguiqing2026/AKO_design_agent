// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/interfaces/learning.interface.ts
// 职责: 自学习闭环契约（FI-V-01/FI-V-02/FI-V-04，无 any）。
//   - 案例沉淀（case-store）：会话结局 → episodic 案例记录（profile/verdict/error_log/trace）
//   - 模式权重（pattern-weight）：命中 × 成败的统计式自动更新（有界 0.5–2.0，乘性）
//   - 语义向量检索为 v1.5 独立差距，本接口不含 embedding 依赖

import type { ProfileConfig } from './config.interface';

/** 案例来源 */
export type CaseSource = 'critic_loop' | 'human_interrupt';

/** 案例判定 */
export type CaseVerdict = 'accepted' | 'rejected' | 'partial';

/** 案例输入（session/trace 可为空：critic.runLoop 场景无会话上下文） */
export interface CaseRecordInput {
  readonly session_id?: string;
  readonly trace_id?: string;
  readonly source: CaseSource;
  readonly verdict: CaseVerdict;
  readonly interrupted: boolean;
  readonly retry_count: number;
  readonly pattern_id?: string;
  readonly profile?: ProfileConfig;
  readonly error_log?: readonly string[];
  /** 人工/修复采纳后的最终配置（与 profile 不同时为修复后版本） */
  readonly fixed_config?: ProfileConfig;
  readonly created_at?: number;
}

/** 落库案例 */
export interface CaseRecord {
  readonly case_id: string;
  readonly session_id?: string;
  readonly trace_id?: string;
  readonly source: CaseSource;
  readonly verdict: CaseVerdict;
  readonly interrupted: boolean;
  readonly retry_count: number;
  readonly pattern_id?: string;
  readonly profile?: ProfileConfig;
  readonly error_log?: readonly string[];
  readonly fixed_config?: ProfileConfig;
  readonly created_at: number;
}

/** 案例接收器（critic runLoop 结束 / 会话终结钩子） */
export type CaseSink = (input: Readonly<CaseRecordInput>) => void | Promise<void>;

/** 案例存储接口（episodic JSON 持久化） */
export interface ICaseStore {
  append(input: CaseRecordInput): CaseRecord;
  /** 列出案例；session_id 传入时过滤 */
  list(options?: { readonly session_id?: string }): readonly CaseRecord[];
}

/** 单模式权重统计 */
export interface PatternStats {
  readonly weight: number;
  readonly hits: number;
  readonly wins: number;
  readonly losses: number;
  readonly updated_at: number;
}

/** 权重文件结构 */
export interface PatternWeightsFile {
  readonly schema: 'pattern-weights';
  readonly version: 1;
  readonly weights: Readonly<Record<string, PatternStats>>;
}

/** 单次权重更新前后的差量 */
export interface PatternWeightDelta {
  readonly pattern_id: string;
  readonly outcome: 'win' | 'loss';
  readonly before: number;
  readonly after: number;
}

/** 模式权重存储接口（统计版自动更新） */
export interface IPatternWeightStore {
  /** 当前权重（未知模式返回 1.0） */
  weightOf(patternId: string): number;
  /** 记录一次命中成败并更新权重（有界 0.5–2.0），返回差量 */
  record(patternId: string, outcome: 'win' | 'loss'): PatternWeightDelta;
  /** 全部模式统计快照（深拷贝，键按 id 排序） */
  snapshot(): Readonly<Record<string, PatternStats>>;
  /** 单模式统计（未知返回 null） */
  statsOf(patternId: string): PatternStats | null;
}

/** 结局落定结果（案例 + 权重差量） */
export interface OutcomeSettled {
  readonly record: CaseRecord;
  readonly delta?: PatternWeightDelta;
}

/** 自学习中枢（案例沉淀 + 权重更新一站式入口） */
export interface ILearningHub {
  readonly cases: ICaseStore;
  readonly weights: IPatternWeightStore;
  /** 记录一次会话结局：沉淀案例；带模式时按成败更新权重 */
  recordOutcome(input: Readonly<CaseRecordInput>): OutcomeSettled;
  /** 召回案例（可按会话过滤，供 episodic 检索/复盘） */
  recall(sessionId?: string): readonly CaseRecord[];
}
