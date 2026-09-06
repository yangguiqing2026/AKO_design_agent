// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/integration/validator-e2e.test.ts
// 覆盖: validator E2E 与 orchestrator 打通——schema→结构→真实沙箱 simulate→cost 记账交付；
//       预算硬限 → budget-exhausted 中断（成本熔断真正参与会话）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProfileConfig } from '../../src/interfaces/config.interface';
import { BudgetConfig } from '../../src/interfaces/cost.interface';
import { RequirementAnalyzer } from '../../src/modules/requirement-analyzer';
import { PatternMatcher } from '../../src/modules/pattern-matcher';
import { SessionManager } from '../../src/modules/session-manager/session-manager';
import { CheckpointStore } from '../../src/modules/session-manager/checkpoint-store';
import { CostCircuit } from '../../src/modules/validator/cost-circuit';
import { SimpleCriticExecutor } from '../../src/modules/validator/critic-executor';
import { buildPipelineEvaluator } from '../../src/modules/validator/validation-pipeline';
import { SimulateRunTool } from '../../src/tools/simulate-run.tool';
import { SessionOrchestrator } from '../../src/core/session-orchestrator';

const GOOD_PROFILE: ProfileConfig = {
  name: 'code-agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [
    { id: 'loop', config: { loop: 'default' } },
    { id: 'tools', config: { tools: ['search'] }, meta: { depends_on: ['loop'] } }
  ]
};

function budget(perSessionUsd: number): BudgetConfig {
  return {
    per_session_max_usd: perSessionUsd,
    per_month_budget_usd: 500,
    alert_threshold_percent: 80,
    hard_break_percent: 100,
    token_cost: { cached_input: 0.022, uncached_input: 0.044, output: 0.088 }
  };
}

let rootDir: string;
const SIM_SANDBOX_REL = './sandbox/validator-e2e';

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-ve2e-'));
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), SIM_SANDBOX_REL), { recursive: true, force: true });
});

function buildOrchestrator(opts: {
  readonly budgetConfig: BudgetConfig;
  readonly evaluator: ReturnType<typeof buildPipelineEvaluator>;
}) {
  const costCircuit = new CostCircuit(path.join(rootDir, 'cost-ledger.json'), opts.budgetConfig);
  const critic = new SimpleCriticExecutor({ evaluateProfile: opts.evaluator });
  return {
    costCircuit,
    orchestrator: new SessionOrchestrator({
      analyzer: new RequirementAnalyzer(),
      matcher: new PatternMatcher(),
      generator: async () => GOOD_PROFILE,
      critic,
      sessionManager: new SessionManager(new CheckpointStore({ dir: path.join(rootDir, 'cp') })),
      costCircuit,
      costModel: 'deepseek-v4-pro'
    })
  };
}

describe('validator E2E：schema + 真实沙箱 + cost 记账 → 交付', () => {
  it('runDesignSession 成功路径：真实 SimulateRunTool 沙箱自检通过，账本记录会话条目', async () => {
    const sandbox = new SimulateRunTool({ temp_dir: SIM_SANDBOX_REL });
    const { orchestrator, costCircuit } = buildOrchestrator({
      budgetConfig: budget(5),
      evaluator: buildPipelineEvaluator({ sandbox })
    });
    const result = await orchestrator.runDesignSession('设计一个可执行的代码生成 Agent', {
      max_steps: 20
    });
    expect(result.outcome).toBe('delivered');
    expect(result.status).toBe('completed');
    const ledger = costCircuit.getLedger();
    expect(ledger.sessions.length).toBeGreaterThanOrEqual(1);
    expect(ledger.sessions[0].model_used).toBe('deepseek-v4-pro');
    expect(ledger.sessions[0].tokens_used).toBeGreaterThan(0);
    // 小规模 profile 的成本经 4 位小数舍入可能为 0.0000（记账条目本身已落库）
    expect(costCircuit.snapshot().total_usd).toBeGreaterThanOrEqual(0);
    // 沙箱目录确实被使用（L1：必须位于进程 cwd 内）
    expect(fs.existsSync(path.join(process.cwd(), SIM_SANDBOX_REL))).toBe(true);
  });
});

describe('validator E2E：成本熔断参与会话', () => {
  it('单会话上限为 0 → 首次验证即 budget-exhausted 中断，账本不新增条目', async () => {
    const { orchestrator, costCircuit } = buildOrchestrator({
      budgetConfig: budget(0),
      evaluator: buildPipelineEvaluator({})
    });
    const result = await orchestrator.runDesignSession('会触发预算上限的会话');
    expect(result.outcome).toBe('interrupted');
    expect(result.status).toBe('interrupted');
    expect(result.ctx.checkpoint).toBe('budget-exhausted');
    expect(result.ctx.validation_errors?.join(';')).toContain('上限');
    expect(costCircuit.getLedger().sessions).toHaveLength(0);
  });

  it('预算充足 → 交付后账本有条目且总额在单会话上限内', async () => {
    const { orchestrator, costCircuit } = buildOrchestrator({
      budgetConfig: budget(5),
      evaluator: buildPipelineEvaluator({})
    });
    const result = await orchestrator.runDesignSession('常规会话');
    expect(result.outcome).toBe('delivered');
    const ledger = costCircuit.getLedger();
    expect(ledger.sessions.length).toBeGreaterThanOrEqual(1);
    expect(ledger.sessions.reduce((acc, s) => acc + s.cost_usd, 0)).toBeLessThan(5);
  });
});
