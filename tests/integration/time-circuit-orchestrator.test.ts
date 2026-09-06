// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/integration/time-circuit-orchestrator.test.ts
// 覆盖: 时间熔断接入 runDesignSession——会话墙钟超限 → timeout-exhausted 中断（可 resume）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProfileConfig } from '../../src/interfaces/config.interface';
import { RequirementAnalyzer } from '../../src/modules/requirement-analyzer';
import { PatternMatcher } from '../../src/modules/pattern-matcher';
import { SessionManager } from '../../src/modules/session-manager/session-manager';
import { CheckpointStore } from '../../src/modules/session-manager/checkpoint-store';
import { TimeCircuit } from '../../src/modules/validator/time-circuit';
import { SessionOrchestrator } from '../../src/core/session-orchestrator';

const PROFILE: ProfileConfig = {
  name: 'agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [{ id: 'loop', config: { loop: 'default' } }]
};

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-timeit-'));
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('时间熔断接入 orchestrator', () => {
  it('会话墙钟超限 → interrupted(timeout-exhausted)，检查点仍落库（可 resume）', async () => {
    // 假时钟：每次读取推进 60ms；begin 后首个循环迭代 60ms<100ms 通过，
    // 下一次迭代 elapsed=120ms>100ms → 熔断
    let now = 0;
    const timeCircuit = new TimeCircuit({ maxSessionMs: 100, now: () => (now += 60) });

    const orchestrator = new SessionOrchestrator({
      analyzer: new RequirementAnalyzer(),
      matcher: new PatternMatcher(),
      generator: async () => PROFILE,
      critic: {
        evaluate: async () => ({ verdict: 'fail', errorLog: '缓慢评估中' }),
        suggestFix: async () => ({}),
        runLoop: async (config) => ({ config, interrupted: true, retryCount: 0 })
      },
      sessionManager: new SessionManager(new CheckpointStore({ dir: path.join(rootDir, 'cp') })),
      timeCircuit
    });
    const result = await orchestrator.runDesignSession('会话墙钟测试', { max_steps: 50 });
    expect(result.outcome).toBe('interrupted');
    expect(result.status).toBe('interrupted');
    expect(result.ctx.checkpoint).toBe('timeout-exhausted');
    expect(result.ctx.validation_errors?.join(';')).toContain('会话超时');
    // 检查点存在，具备 resume 能力
    const store = new CheckpointStore({ dir: path.join(rootDir, 'cp') });
    expect(store.latest(result.session_id)?.ctx.status).toBe('interrupted');
  });
});
