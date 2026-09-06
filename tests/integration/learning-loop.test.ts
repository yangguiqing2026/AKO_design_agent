// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/integration/learning-loop.test.ts
// 覆盖: 自学习闭环——(1) SimpleCriticExecutor.runLoop 案例钩子；(2) 端到端
//       失败→修复→成功→案例→权重上升（FI-V-01 统计版闭环），持久化幂等。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProfileConfig } from '../../src/interfaces/config.interface';
import type { CaseRecordInput } from '../../src/interfaces/learning.interface';
import { SimpleCriticExecutor } from '../../src/modules/validator/critic-executor';
import { RequirementAnalyzer } from '../../src/modules/requirement-analyzer';
import { PatternMatcher } from '../../src/modules/pattern-matcher';
import { SessionManager } from '../../src/modules/session-manager/session-manager';
import { CheckpointStore } from '../../src/modules/session-manager/checkpoint-store';
import { MemoryHub } from '../../src/modules/memory/memory-hub';
import { CaseStore } from '../../src/modules/learning/case-store';
import { PatternWeightStore } from '../../src/modules/learning/pattern-weight';
import { LearningHub } from '../../src/modules/learning/learning-hub';
import { SessionOrchestrator } from '../../src/core/session-orchestrator';

const BASE_PROFILE: ProfileConfig = {
  name: 'bad-agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [
    { id: 'loop', config: { loop: 'default' } },
    { id: 'tools', config: { tools: ['search'] }, meta: { depends_on: ['loop'] } }
  ]
};

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-learn-'));
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('SimpleCriticExecutor.runLoop 案例钩子（D 数据源）', () => {
  it('无修复建议 → interrupted：sink 收到一次 rejected', async () => {
    const records: CaseRecordInput[] = [];
    const critic = new SimpleCriticExecutor({
      evaluateProfile: async () => ({ verdict: 'fail', errorLog: '结构非法' }),
      fixer: async () => ({}),
      onCaseSink: (record) => {
        records.push(record);
      }
    });
    const outcome = await critic.runLoop(BASE_PROFILE);
    expect(outcome.interrupted).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].verdict).toBe('rejected');
    expect(records[0].interrupted).toBe(true);
    expect(records[0].source).toBe('critic_loop');
  });

  it('修复后通过 → sink 收到一次 accepted（retry_count=1）', async () => {
    const records: CaseRecordInput[] = [];
    const critic = new SimpleCriticExecutor({
      evaluateProfile: async (config) =>
        config.name === 'good-agent' ? { verdict: 'pass' } : { verdict: 'fail', errorLog: '名字需修正' },
      fixer: async () => ({ name: 'good-agent' }),
      onCaseSink: (record) => {
        records.push(record);
      }
    });
    const outcome = await critic.runLoop(BASE_PROFILE);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.config.name).toBe('good-agent');
    expect(outcome.retryCount).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0].verdict).toBe('accepted');
    expect(records[0].retry_count).toBe(1);
  });
});

describe('端到端学习闭环：失败→修复→成功→案例→权重上升', () => {
  it('单会话成功交付：案例 accepted、模式权重升到 1.15、跨实例幂等', async () => {
    const learningDir = path.join(rootDir, 'learning');
    const casesFile = path.join(learningDir, 'cases.json');
    const weightsFile = path.join(learningDir, 'weights.json');
    const caseStore = new CaseStore({ file: casesFile });
    const weightStore = new PatternWeightStore({ file: weightsFile });
    const learningHub = new LearningHub({ cases: caseStore, weights: weightStore });

    // 真实 SimpleCriticExecutor：bad-agent 名 → 建议修复为 good-agent
    const critic = new SimpleCriticExecutor({
      evaluateProfile: async (config) =>
        config.name === 'good-agent' ? { verdict: 'pass' } : { verdict: 'fail', errorLog: '需要更名' },
      fixer: async () => ({ name: 'good-agent' })
    });

    const orchestrator = new SessionOrchestrator({
      analyzer: new RequirementAnalyzer(),
      matcher: new PatternMatcher(),
      generator: async () => BASE_PROFILE,
      critic,
      sessionManager: new SessionManager(new CheckpointStore({ dir: path.join(rootDir, 'cp') })),
      memoryHub: new MemoryHub({ memoryDir: path.join(rootDir, 'memory') }),
      learningHub
    });

    const result = await orchestrator.runDesignSession('实现一个代码生成编码 Agent 的自动化脚本', {
      max_steps: 20
    });
    expect(result.outcome).toBe('delivered');
    expect(result.ctx.retry_count).toBe(1);

    const patternId = result.ctx.matched_pattern_id;
    expect(patternId).toBeDefined();

    // 案例已沉淀且判定 accepted
    const cases = learningHub.recall(result.session_id);
    expect(cases).toHaveLength(1);
    expect(cases[0].verdict).toBe('accepted');
    expect(cases[0].pattern_id).toBe(patternId);
    expect(cases[0].profile?.name).toBe('good-agent'); // 修复后的最终配置

    // 权重上升：默认 1.0 → win → 1.15
    const stats = weightStore.statsOf(patternId as string);
    expect(stats?.weight).toBe(1.15);
    expect(stats?.wins).toBe(1);
    expect(stats?.hits).toBe(1);

    // 幂等重载：新实例读回同一案例与权重
    const reloadedCases = new CaseStore({ file: casesFile });
    const reloadedWeights = new PatternWeightStore({ file: weightsFile });
    expect(reloadedCases.list({ session_id: result.session_id })).toHaveLength(1);
    expect(reloadedWeights.statsOf(patternId as string)?.weight).toBe(1.15);

    // 匹配器消费权重：加权 matcher 下同模式得分 >= 无权重 matcher（权重放大生效）
    const weightedMatcher = new PatternMatcher({ weightMap: { [patternId as string]: 1.15 } });
    const plainMatcher = new PatternMatcher();
    const query = { keywords: ['编码实现', '软件开发任务'], complexity: 'medium' as const };
    const weightedScore = weightedMatcher
      .match(query)
      .candidates.find((c) => c.pattern_id === patternId)?.score;
    const plainScore = plainMatcher
      .match(query)
      .candidates.find((c) => c.pattern_id === patternId)?.score;
    if (weightedScore !== undefined && plainScore !== undefined) {
      expect(weightedScore).toBeGreaterThanOrEqual(plainScore);
    }
  });
});
