// AKO_studio - Design Agent v1.0.0
// 文件名: src/modules/validator/cost-circuit.ts
// 职责: 成本熔断（持久化）。
//   - 账本持久化到 sandbox/logs/cost-ledger.json
//   - 月份切换自动归档为 cost-ledger-YYYY-MM.json 并新建当月账本
//   - 达到硬性阈值（月度/单会话）抛 BudgetExceededError，禁止被 fallback 静默忽略
//   - 提供 token 计价（单价配置来自 config/cost-budget.yml）

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  BudgetConfig,
  BudgetSnapshot,
  CostEstimate,
  CostLedger,
  CostLedgerEntry,
  MonthKey,
  TokenCostRates,
  TokenUsage
} from '../../interfaces/cost.interface';

/** 预算熔断（硬中断，不允许 fallback 静默忽略） */
export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';

  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/** 配置解析异常 */
export class CostConfigError extends Error {
  readonly code = 'COST_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'CostConfigError';
  }
}

export const DEFAULT_TOKEN_RATES: TokenCostRates = {
  cached_input: 0.022,
  uncached_input: 0.044,
  output: 0.088
};

/** 从 config/cost-budget.yml 解析结果（unknown）规范化预算配置 */
export function parseBudgetConfig(raw: unknown): BudgetConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CostConfigError('cost-budget 配置根节点必须是对象');
  }
  const root = raw as Record<string, unknown>;
  const limits = root.hard_limits;
  const tokenCost = root.token_cost;
  if (typeof limits !== 'object' || limits === null) {
    throw new CostConfigError('缺少 hard_limits 段');
  }
  if (typeof tokenCost !== 'object' || tokenCost === null) {
    throw new CostConfigError('缺少 token_cost 段');
  }
  const num = (value: unknown, field: string): number => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new CostConfigError(`${field} 必须是非 NaN 数字`);
    }
    return value;
  };
  const cost = tokenCost as Record<string, unknown>;
  return {
    per_session_max_usd: num((limits as Record<string, unknown>).per_session_max_usd, 'hard_limits.per_session_max_usd'),
    per_month_budget_usd: num((limits as Record<string, unknown>).per_month_budget_usd, 'hard_limits.per_month_budget_usd'),
    alert_threshold_percent: num((limits as Record<string, unknown>).alert_threshold_percent, 'hard_limits.alert_threshold_percent'),
    hard_break_percent: num((limits as Record<string, unknown>).hard_break_percent, 'hard_limits.hard_break_percent'),
    token_cost: {
      cached_input: num(cost.cached_input, 'token_cost.cached_input'),
      uncached_input: num(cost.uncached_input, 'token_cost.uncached_input'),
      output: num(cost.output, 'token_cost.output')
    }
  };
}

function monthKeyOf(date: Date): MonthKey {
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function cloneLedger(ledger: CostLedger): CostLedger {
  return JSON.parse(JSON.stringify(ledger)) as CostLedger;
}

export interface CostCircuitOptions {
  readonly now?: () => Date;
  readonly warn?: (message: string) => void;
}

export class CostCircuit {
  private readonly storagePath: string;
  private readonly budget: BudgetConfig;
  private readonly nowProvider: () => Date;
  private readonly warnSink: (message: string) => void;
  private ledger: CostLedger;

  /**
   * @param storagePath 账本 JSON 路径（如 sandbox/logs/cost-ledger.json）
   * @param budget      预算配置
   */
  constructor(
    storagePath: string,
    budget: BudgetConfig,
    options: CostCircuitOptions = {}
  ) {
    this.storagePath = path.resolve(storagePath);
    this.budget = budget;
    this.nowProvider = options.now ?? ((): Date => new Date());
    this.warnSink = options.warn ?? ((): void => undefined);
    this.ledger = this.loadOrCreateLedger();
  }

  get budgetSnapshotConfig(): Readonly<BudgetConfig> {
    return { ...this.budget, token_cost: { ...this.budget.token_cost } };
  }

  /** 读取账本原始快照（深拷贝，防外部篡改） */
  getLedger(): CostLedger {
    return cloneLedger(this.ledger);
  }

  /**
   * token 计价。
   * @param usage 用量拆分；output 为必填
   */
  estimateCost(usage: TokenUsage): CostEstimate {
    const rates = this.budget.token_cost;
    const cached = Math.max(0, usage.cached_input ?? 0);
    const uncached = Math.max(0, usage.uncached_input ?? 0);
    const output = Math.max(0, usage.output);
    const cachedUsd = (cached / 1_000_000) * rates.cached_input;
    const uncachedUsd = (uncached / 1_000_000) * rates.uncached_input;
    const outputUsd = (output / 1_000_000) * rates.output;
    return {
      usd: roundUsd(cachedUsd + uncachedUsd + outputUsd),
      tokens_total: cached + uncached + output,
      breakdown: {
        cached_input_usd: roundUsd(cachedUsd),
        uncached_input_usd: roundUsd(uncachedUsd),
        output_usd: roundUsd(outputUsd)
      }
    };
  }

  /** 预算快照（自动处理月份轮转） */
  snapshot(): BudgetSnapshot {
    this.ensureCurrentMonth();
    const total = this.sumTotal();
    const usagePercent = (total / this.budget.per_month_budget_usd) * 100;
    return {
      month_key: this.ledger.month_key,
      total_usd: roundUsd(total),
      per_session_max_usd: this.budget.per_session_max_usd,
      per_month_budget_usd: this.budget.per_month_budget_usd,
      usage_percent: roundUsd(usagePercent),
      warning: usagePercent >= this.budget.alert_threshold_percent,
      exceeded: usagePercent >= this.budget.hard_break_percent
    };
  }

  /**
   * 月度预算硬检查。
   * @throws BudgetExceededError 已达硬性熔断（100%），禁止继续
   */
  checkBudget(): BudgetSnapshot {
    const snap = this.snapshot();
    if (snap.exceeded) {
      throw new BudgetExceededError(
        `月度预算已用尽：$${snap.total_usd} / $${snap.per_month_budget_usd}（${snap.usage_percent}%）`
      );
    }
    return snap;
  }

  /**
   * 记录单次会话成本（追加 + 立即持久化）。
   * 双重熔断：
   *   1) 单会话成本 > per_session_max_usd → 拒绝入账并抛错
   *   2) 入账后月度累计达到硬性阈值 → 拒绝入账并抛错
   */
  recordSession(
    sessionId: string,
    traceId: string,
    costUsd: number,
    tokensUsed: number,
    modelUsed: string
  ): BudgetSnapshot {
    if (!(costUsd >= 0) || !(tokensUsed >= 0)) {
      throw new BudgetExceededError('会话成本与 token 数不能为负');
    }
    // Sprint 3：per_session_max_usd<=0 表示“无会话预算”，任何入账都拒绝（防 0.0000 舍入绕过）
    if (this.budget.per_session_max_usd <= 0) {
      throw new BudgetExceededError(
        `单会话预算上限为 $${this.budget.per_session_max_usd}，不允许任何成本入账（session=${sessionId}）`
      );
    }
    const current = this.snapshot();
    if (current.exceeded) {
      throw new BudgetExceededError(
        `月度预算已用尽：$${current.total_usd} / $${current.per_month_budget_usd}`
      );
    }
    if (costUsd > this.budget.per_session_max_usd) {
      throw new BudgetExceededError(
        `单会话成本 $${costUsd} 超过上限 $${this.budget.per_session_max_usd}（session=${sessionId}）`
      );
    }
    const nextTotal = current.total_usd + costUsd;
    const hardBreakUsd = (this.budget.per_month_budget_usd * this.budget.hard_break_percent) / 100;
    if (nextTotal >= hardBreakUsd) {
      throw new BudgetExceededError(
        `入账后月度累计 $${nextTotal} 将达到硬性阈值 $${hardBreakUsd}，已拒绝记录`
      );
    }
    const entry: CostLedgerEntry = {
      session_id: sessionId,
      trace_id: traceId,
      cost_usd: roundUsd(costUsd),
      tokens_used: Math.round(tokensUsed),
      model_used: modelUsed,
      timestamp: this.nowProvider().getTime()
    };
    this.ledger = {
      ...this.ledger,
      sessions: [...this.ledger.sessions, entry]
    };
    this.persist();
    return this.snapshot();
  }

  private sumTotal(): number {
    return this.ledger.sessions.reduce((acc, s) => acc + s.cost_usd, 0);
  }

  /** 若当前账本月份已过时，归档旧账本并新建当月账本 */
  private ensureCurrentMonth(): void {
    const currentMonth = monthKeyOf(this.nowProvider());
    if (this.ledger.month_key === currentMonth) {
      return;
    }
    const dir = path.dirname(this.storagePath);
    const baseName = path.basename(this.storagePath, path.extname(this.storagePath));
    const archivePath = path.join(dir, `${baseName}-${this.ledger.month_key}.json`);
    try {
      fs.renameSync(this.storagePath, archivePath);
    } catch (err) {
      this.warnSink(`账本归档失败（将丢弃旧账本）：${String(err)}`);
    }
    this.ledger = this.emptyLedger(currentMonth);
    this.persist();
  }

  private emptyLedger(monthKey: MonthKey): CostLedger {
    return { month_key: monthKey, total_usd: 0, sessions: [] };
  }

  /** 原子持久化：先写临时文件再 rename，避免半截 JSON */
  private persist(target?: CostLedger): void {
    const ledger = target ?? this.ledger;
    const withTotal: CostLedger = {
      ...ledger,
      total_usd: roundUsd(ledger.sessions.reduce((acc, s) => acc + s.cost_usd, 0))
    };
    const dir = path.dirname(this.storagePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.storagePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(withTotal, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.storagePath);
  }

  private loadOrCreateLedger(): CostLedger {
    const currentMonth = monthKeyOf(this.nowProvider());
    if (!fs.existsSync(this.storagePath)) {
      const fresh = this.emptyLedger(currentMonth);
      this.persist(fresh);
      return fresh;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8')) as unknown;
    } catch (err) {
      // 损坏账本：备份后重建，保证不阻断运行
      const backup = `${this.storagePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.storagePath, backup);
        this.warnSink(`账本损坏，已备份至 ${backup}`);
      } catch {
        this.warnSink(`账本损坏且无法备份：${String(err)}`);
      }
      const rebuilt = this.emptyLedger(currentMonth);
      this.persist(rebuilt);
      return rebuilt;
    }
    const parsedLedger = this.normalizeParsedLedger(parsed);
    if (parsedLedger === null) {
      const rebuilt = this.emptyLedger(currentMonth);
      this.persist(rebuilt); // 结构非法：原地重建为合法空账本
      return rebuilt;
    }
    // 跨月账本：加载时即归档（长驻进程内再做一次惰性兜底）
    if (parsedLedger.month_key !== currentMonth) {
      const baseName = path.basename(this.storagePath, path.extname(this.storagePath));
      const archivePath = path.join(path.dirname(this.storagePath), `${baseName}-${parsedLedger.month_key}.json`);
      try {
        fs.renameSync(this.storagePath, archivePath);
      } catch (err) {
        this.warnSink(`账本归档失败（将重建当月账本）：${String(err)}`);
      }
      const rotated = this.emptyLedger(currentMonth);
      this.persist(rotated);
      return rotated;
    }
    return parsedLedger;
  }

  /** 将磁盘 JSON 规整为合法账本；结构非法返回 null */
  private normalizeParsedLedger(value: unknown): CostLedger | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.month_key !== 'string' || !Array.isArray(record.sessions)) {
      return null;
    }
    const sessions: CostLedgerEntry[] = [];
    for (const item of record.sessions) {
      if (typeof item !== 'object' || item === null) {
        continue;
      }
      const s = item as Record<string, unknown>;
      if (
        typeof s.session_id === 'string' &&
        typeof s.trace_id === 'string' &&
        typeof s.cost_usd === 'number' &&
        typeof s.tokens_used === 'number' &&
        typeof s.model_used === 'string' &&
        typeof s.timestamp === 'number'
      ) {
        sessions.push({
          session_id: s.session_id,
          trace_id: s.trace_id,
          cost_usd: s.cost_usd,
          tokens_used: s.tokens_used,
          model_used: s.model_used,
          timestamp: s.timestamp
        });
      }
    }
    return {
      month_key: record.month_key,
      total_usd: roundUsd(sessions.reduce((acc, s) => acc + s.cost_usd, 0)),
      sessions
    };
  }
}

