// AKO_studio - Design Agent v1.0.0
// 文件名: tests/unit/cost-circuit.test.ts
// 覆盖: 持久化/重载、月度轮转归档、预算告警与硬熔断、单会话上限、token 计价、损坏账本恢复

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BudgetExceededError,
  CostCircuit,
  CostConfigError,
  parseBudgetConfig
} from '../../src/modules/validator/cost-circuit';
import type { BudgetConfig, CostLedger } from '../../src/interfaces/cost.interface';

const BUDGET: BudgetConfig = {
  per_session_max_usd: 5,
  per_month_budget_usd: 100,
  alert_threshold_percent: 80,
  hard_break_percent: 100,
  token_cost: { cached_input: 0.022, uncached_input: 0.044, output: 0.088 }
};

let tempDir: string;
let ledgerPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-cost-'));
  ledgerPath = path.join(tempDir, 'cost-ledger.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function fixedNow(month: number, day: number, hour = 10): () => Date {
  return (): Date => new Date(2026, month - 1, day, hour, 0, 0, 0);
}

describe('持久化账本', () => {
  it('首次构造创建空账本并落盘', () => {
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    expect(circuit.getLedger().month_key).toBe('2026-09');
    expect(circuit.getLedger().sessions).toHaveLength(0);
    expect(fs.existsSync(ledgerPath)).toBe(true);
  });

  it('recordSession 落盘后新实例可重载', () => {
    const first = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 5) });
    first.recordSession('s-1', 'trace-1', 1.2, 3000, 'deepseek-v4-pro');

    const second = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 5) });
    const ledger = second.getLedger();
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0]).toMatchObject({
      session_id: 's-1',
      trace_id: 'trace-1',
      cost_usd: 1.2,
      tokens_used: 3000,
      model_used: 'deepseek-v4-pro'
    });
  });

  it('getLedger 返回深拷贝，外部改动不影响内部', () => {
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 5) });
    const snapshot = circuit.getLedger() as CostLedger;
    (snapshot as { month_key: string }).month_key = 'hacked';
    expect(circuit.getLedger().month_key).toBe('2026-09');
  });
});

describe('月度轮转与归档', () => {
  it('跨月后旧账本归档为 cost-ledger-YYYY-MM.json 并新建当月账本', () => {
    const old = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 30) });
    old.recordSession('s-sep', 't', 2, 100, 'deepseek-v4-pro');

    const fresh = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(10, 2) });
    expect(fresh.getLedger().month_key).toBe('2026-10');
    expect(fresh.getLedger().sessions).toHaveLength(0);

    const archivePath = path.join(tempDir, 'cost-ledger-2026-09.json');
    expect(fs.existsSync(archivePath)).toBe(true);
    const archived = JSON.parse(fs.readFileSync(archivePath, 'utf8')) as CostLedger;
    expect(archived.month_key).toBe('2026-09');
    expect(archived.sessions).toHaveLength(1);
  });
});

describe('预算熔断', () => {
  it('超过告警阈值 → warning，但未熔断', () => {
    const highSessionBudget: BudgetConfig = {
      ...BUDGET,
      per_session_max_usd: 200 // 隔离单会话上限影响，专注验证月度告警
    };
    const circuit = new CostCircuit(ledgerPath, highSessionBudget, { now: fixedNow(9, 1) });
    circuit.recordSession('s-1', 't1', 81, 1000, 'm'); // 81/100 = 81%
    const snap = circuit.snapshot();
    expect(snap.warning).toBe(true);
    expect(snap.exceeded).toBe(false);
  });

  it('入账后触及硬阈值 → 拒绝入账并抛 BudgetExceededError', () => {
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    expect(() => circuit.recordSession('s', 't', 100, 10, 'm')).toThrow(BudgetExceededError);
    // 拒绝入账意味着账本仍为空
    expect(circuit.getLedger().sessions).toHaveLength(0);
  });

  it('磁盘账本已超限时 checkBudget 抛错（不可被静默忽略）', () => {
    const ledger = {
      month_key: '2026-09',
      total_usd: 999,
      sessions: [{ session_id: 'x', trace_id: 'y', cost_usd: 999, tokens_used: 1, model_used: 'm', timestamp: 1 }]
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger), 'utf8');
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    expect(circuit.snapshot().exceeded).toBe(true);
    expect(() => circuit.checkBudget()).toThrow(BudgetExceededError);
    try {
      circuit.checkBudget();
    } catch (err) {
      expect((err as BudgetExceededError).code).toBe('BUDGET_EXCEEDED');
    }
  });

  it('单会话超过 per_session_max_usd 拒绝入账', () => {
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    expect(() => circuit.recordSession('s', 't', 5.01, 1, 'm')).toThrow(/单会话成本/);
    expect(circuit.getLedger().sessions).toHaveLength(0);
  });

  it('负成本拒绝入账', () => {
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    expect(() => circuit.recordSession('s', 't', -1, 1, 'm')).toThrow(BudgetExceededError);
  });
});

describe('token 计价', () => {
  it('按百万 token 单价正确折算（缓存/未缓存/输出）', () => {
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    const estimate = circuit.estimateCost({ cached_input: 1_000_000, uncached_input: 500_000, output: 250_000 });
    expect(estimate.usd).toBeCloseTo(0.022 + 0.022 + 0.022, 4);
    expect(estimate.tokens_total).toBe(1_750_000);
    expect(estimate.breakdown.cached_input_usd).toBeCloseTo(0.022, 4);
  });

  it('缺省输入字段按 0 处理', () => {
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    const estimate = circuit.estimateCost({ output: 1_000_000 });
    expect(estimate.usd).toBeCloseTo(0.088, 4);
  });
});

describe('损坏与非法账本', () => {
  it('损坏 JSON → 备份后重建可用账本', () => {
    fs.writeFileSync(ledgerPath, '{"month_key": 2026,', 'utf8');
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    expect(circuit.getLedger().month_key).toBe('2026-09');
    const corruptFiles = fs.readdirSync(tempDir).filter((f) => f.includes('.corrupt-'));
    expect(corruptFiles).toHaveLength(1);
  });

  it('结构非法（数组内容异常）→ 跳过非法条目或重建', () => {
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({ month_key: '2026-09', total_usd: 1, sessions: [{ bad: true }] }),
      'utf8'
    );
    const circuit = new CostCircuit(ledgerPath, BUDGET, { now: fixedNow(9, 1) });
    expect(circuit.getLedger().sessions).toHaveLength(0);
  });
});

describe('配置解析 parseBudgetConfig', () => {
  it('合法 YAML 结构规范化', () => {
    const config = parseBudgetConfig({
      hard_limits: {
        per_session_max_usd: 5,
        per_month_budget_usd: 500,
        alert_threshold_percent: 80,
        hard_break_percent: 100
      },
      token_cost: { cached_input: 0.022, uncached_input: 0.044, output: 0.088 }
    });
    expect(config.per_month_budget_usd).toBe(500);
    expect(config.token_cost.output).toBe(0.088);
  });

  it('缺少关键段抛出 CostConfigError', () => {
    expect(() => parseBudgetConfig({})).toThrow(CostConfigError);
    expect(() => parseBudgetConfig({ hard_limits: {} })).toThrow(CostConfigError);
    expect(
      () =>
        parseBudgetConfig({
          hard_limits: { per_session_max_usd: 1 },
          token_cost: { output: 'x' }
        })
    ).toThrow(CostConfigError);
  });
});
