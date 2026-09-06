// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/integration/session-orchestrator.test.ts
// 覆盖: runDesignSession 四条主路径——成功交付 / 1 次重试后交付 / 3 次失败转人工 /
//       断点 resume 续跑（human approve），全程挂 memory/checkpoint/case-sink。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ICriticExecutor } from '../../src/interfaces/critic.interface';
import type { ProfileConfig } from '../../src/interfaces/config.interface';
import type { DesignSessionOptions, ProfileGenerator } from '../../src/interfaces/session.interface';
import { RequirementAnalyzer } from '../../src/modules/requirement-analyzer';
import { PatternMatcher } from '../../src/modules/pattern-matcher';
import { SessionManager } from '../../src/modules/session-manager/session-manager';
import { CheckpointStore } from '../../src/modules/session-manager/checkpoint-store';
import { MemoryHub } from '../../src/modules/memory/memory-hub';
import { CaseStore } from '../../src/modules/learning/case-store';
import { PatternWeightStore } from '../../src/modules/learning/pattern-weight';
import { LearningHub } from '../../src/modules/learning/learning-hub';
import { SessionOrchestrator } from '../../src/core/session-orchestrator';

const GOOD_PROFILE: ProfileConfig = {
  name: 'code-agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [
    { id: 'loop', config: { loop: 'default' } },
    { id: 'tools', config: { tools: ['search'] }, meta: { depends_on: ['loop'] } }
  ]
};

/** 失败前 n 次、随后通过的脚本化 Critic */
function scriptedCritic(options: {
  readonly failures?: number;
  readonly fix?: Partial<ProfileConfig>;
}): ICriticExecutor {
  let calls = 0;
  return {
    evaluate: async () => {
      calls += 1;
      if (calls <= (options.failures ?? 0)) {
        return { verdict: 'fail', errorLog: `第 ${calls} 次校验未通过` };
      }
      return { verdict: 'pass' };
    },
    suggestFix: async () => options.fix ?? {},
    runLoop: async (config) => ({ config, interrupted: false, retryCount: 0 })
  };
}

/** 永不通过的 Critic（无修复建议） */
function neverPassCritic(): ICriticExecutor {
  let calls = 0;
  return {
    evaluate: async () => {
      calls += 1;
      return { verdict: 'fail', errorLog: `始终失败 #${calls}` };
    },
    suggestFix: async () => ({}),
    runLoop: async (config) => ({ config, interrupted: true, retryCount: 3 })
  };
}

interface Rig {
  readonly rootDir: string;
  readonly memoryDir: string;
  readonly checkpointDir: string;
  readonly memoryHub: MemoryHub;
  readonly checkpointStore: CheckpointStore;
  readonly learningHub: LearningHub;
  newOrchestrator(deps?: {
    readonly critic?: ICriticExecutor;
    readonly generator?: ProfileGenerator;
  }): SessionOrchestrator;
}

function buildRig(): Rig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-orch-'));
  const memoryDir = path.join(rootDir, 'memory');
  const checkpointDir = path.join(rootDir, 'checkpoints');
  const learningDir = path.join(rootDir, 'learning');
  const memoryHub = new MemoryHub({ memoryDir });
  const checkpointStore = new CheckpointStore({ dir: checkpointDir });
  const caseStore = new CaseStore({ file: path.join(learningDir, 'cases.json') });
  const weightStore = new PatternWeightStore({ file: path.join(learningDir, 'weights.json') });
  const learningHub = new LearningHub({ cases: caseStore, weights: weightStore });

  const analyzer = new RequirementAnalyzer();
  const matcher = new PatternMatcher();
  const generator: ProfileGenerator = async () => GOOD_PROFILE;

  const newOrchestrator: Rig['newOrchestrator'] = (deps = {}) => {
    const sessionManager = new SessionManager(checkpointStore);
    return new SessionOrchestrator({
      analyzer,
      matcher,
      generator: deps.generator ?? generator,
      critic: deps.critic ?? scriptedCritic({ failures: 0 }),
      sessionManager,
      memoryHub,
      learningHub
    });
  };

  return {
    rootDir,
    memoryDir,
    checkpointDir,
    memoryHub,
    checkpointStore,
    learningHub,
    newOrchestrator
  };
}

describe('runDesignSession：端到端编排主路径', () => {
  it('成功交付：completed + 案例 accepted + 检查点/记忆落库', async () => {
    const rig = buildRig();
    try {
      const result = await rig
        .newOrchestrator()
        .runDesignSession('设计一个可执行的 Agent', { max_steps: 20 });
      expect(result.outcome).toBe('delivered');
      expect(result.status).toBe('completed');
      expect(result.ctx.retry_count).toBe(0);
      expect(result.ctx.generated_profile?.name).toBe('code-agent');
      expect(result.ctx.matched_pattern_id).toBeDefined();

      const cases = rig.learningHub.recall(result.session_id);
      expect(cases).toHaveLength(1);
      expect(cases[0].verdict).toBe('accepted');
      expect(cases[0].interrupted).toBe(false);

      const sessions = rig.checkpointStore.list(result.session_id);
      expect(sessions.length).toBeGreaterThanOrEqual(5);
      expect(fs.existsSync(rig.checkpointDir)).toBe(true);

      const end = rig.memoryHub.read('short_term', { session_id: result.session_id });
      expect(end.some((e) => e.tags?.includes('session-end'))).toBe(true);
      expect(
        rig.memoryHub.read('episodic', { session_id: result.session_id }).some((e) => e.tags?.includes('delivered'))
      ).toBe(true);
    } finally {
      fs.rmSync(rig.rootDir, { recursive: true, force: true });
    }
  });

  it('1 次重试后交付：retry_count=1、修复后的 profile 生效', async () => {
    const rig = buildRig();
    try {
      const result = await rig
        .newOrchestrator({ critic: scriptedCritic({ failures: 1, fix: { name: 'code-agent-fixed' } }) })
        .runDesignSession('设计一个需要校验修正的 Agent');
      expect(result.outcome).toBe('delivered');
      expect(result.ctx.retry_count).toBe(1);
      expect(result.ctx.generated_profile?.name).toBe('code-agent-fixed');
      const caseRecord = rig.learningHub.recall(result.session_id)[0];
      expect(caseRecord?.retry_count).toBe(1);
    } finally {
      fs.rmSync(rig.rootDir, { recursive: true, force: true });
    }
  });

  it('3 次失败转人工：interrupted + 案例 rejected + 权重记录 loss', async () => {
    const rig = buildRig();
    try {
      const result = await rig
        .newOrchestrator({ critic: neverPassCritic() })
        .runDesignSession('一个反复失败的 Agent 设计', { max_steps: 20 });
      expect(result.outcome).toBe('interrupted');
      expect(result.status).toBe('interrupted');
      expect(result.ctx.retry_count).toBe(3);
      const caseRecord = rig.learningHub.recall(result.session_id)[0];
      expect(caseRecord?.verdict).toBe('rejected');
      expect(caseRecord?.interrupted).toBe(true);
      const patternId = result.ctx.matched_pattern_id;
      if (patternId !== undefined) {
        expect(rig.learningHub.weights.statsOf(patternId)?.losses).toBe(1);
      }
    } finally {
      fs.rmSync(rig.rootDir, { recursive: true, force: true });
    }
  });

  it('断点 resume 续跑：interrupted → 人工 approve → 从检查点续跑到 completed', async () => {
    const rig = buildRig();
    try {
      const sessionId = 'resume-session-1';

      // 第一次运行：Critic 始终失败 → interrupted（断点已落盘）
      const first = rig.newOrchestrator({ critic: neverPassCritic() });
      const firstResult = await first.runDesignSession('复杂 Agent 设计', {
        session_id: sessionId,
        max_steps: 20
      });
      expect(firstResult.status).toBe('interrupted');
      expect(firstResult.ctx.retry_count).toBe(3);

      // 第二次运行：全新 SessionManager/Orchestrator + 人工 approve → 续跑交付
      const resumed = rig.newOrchestrator({ critic: scriptedCritic({ failures: 0 }) });
      const events: string[] = [];
      const opts: DesignSessionOptions = {
        session_id: sessionId,
        human_decision: 'approve',
        on_event: (event) => events.push(event.kind)
      };
      const secondResult = await resumed.runDesignSession('复杂 Agent 设计', opts);
      expect(secondResult.resumed).toBe(true);
      expect(secondResult.outcome).toBe('delivered');
      expect(secondResult.status).toBe('completed');
      expect(secondResult.ctx.retry_count).toBe(3); // 恢复保留计数
      expect(events).toContain('resume');
      expect(events).toContain('checkpoint');
      const records = rig.learningHub.recall(sessionId);
      expect(records).toHaveLength(2); // 第一轮 rejected + 续跑 accepted
      expect(records.map((r) => r.verdict).sort()).toEqual(['accepted', 'rejected']);
    } finally {
      fs.rmSync(rig.rootDir, { recursive: true, force: true });
    }
  });

  it('generator 抛错 → error 终态并沉淀案例', async () => {
    const rig = buildRig();
    try {
      const generator: ProfileGenerator = async () => {
        throw new Error('生成器不可用');
      };
      const result = await rig
        .newOrchestrator({ generator })
        .runDesignSession('触发生成失败的会话');
      expect(result.outcome).toBe('error');
      expect(result.status).toBe('error');
      expect(result.ctx.validation_errors?.join(';')).toContain('生成器不可用');
    } finally {
      fs.rmSync(rig.rootDir, { recursive: true, force: true });
    }
  });
});
