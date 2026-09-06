// AKO_studio - Design Agent v1.0.0
// 文件名: src/interfaces/cost.interface.ts
// 职责: 成本账目与预算配置的类型化契约（无 any）

/** 月份键，格式 YYYY-MM */
export type MonthKey = string;

/** Token 单价（美元 / 百万 token），对应 config/cost-budget.yml */
export interface TokenCostRates {
  readonly cached_input: number;
  readonly uncached_input: number;
  readonly output: number;
}

/** 预算配置，对应 config/cost-budget.yml 的 hard_limits + token_cost */
export interface BudgetConfig {
  readonly per_session_max_usd: number;
  readonly per_month_budget_usd: number;
  readonly alert_threshold_percent: number;
  readonly hard_break_percent: number;
  readonly token_cost: TokenCostRates;
}

/** 单次会话成本条目 */
export interface CostLedgerEntry {
  readonly session_id: string;
  readonly trace_id: string;
  readonly cost_usd: number;
  readonly tokens_used: number;
  readonly model_used: string;
  readonly timestamp: number;
}

/** 月度账本（持久化 JSON 结构） */
export interface CostLedger {
  readonly month_key: MonthKey;
  readonly total_usd: number;
  readonly sessions: readonly CostLedgerEntry[];
}

/** Token 用量拆分 */
export interface TokenUsage {
  readonly cached_input?: number;
  readonly uncached_input?: number;
  readonly output: number;
}

/** Token 计价结果 */
export interface CostEstimate {
  readonly usd: number;
  readonly tokens_total: number;
  readonly breakdown: {
    readonly cached_input_usd: number;
    readonly uncached_input_usd: number;
    readonly output_usd: number;
  };
}

/** 预算快照（供熔断与告警判定） */
export interface BudgetSnapshot {
  readonly month_key: MonthKey;
  readonly total_usd: number;
  readonly per_session_max_usd: number;
  readonly per_month_budget_usd: number;
  readonly usage_percent: number;
  readonly warning: boolean;
  readonly exceeded: boolean;
}
