// AKO_studio - Design Agent v1.0.1
// 文件名: tests/unit/critic-executor.test.ts
// 覆盖: SimpleCriticExecutor —— 静态评估 / 注入评估 / runLoop 通过/中断/超限语义

import type { ProfileConfig } from '../../src/interfaces/config.interface';
import type { CriticResult, ICriticExecutor } from '../../src/interfaces/critic.interface';
import {
  CRITIC_EXECUTOR_MAX_RETRY,
  SimpleCriticExecutor,
  staticProfileEvaluator
} from '../../src/modules/validator/critic-executor';

const VALID_PROFILE: ProfileConfig = {
  name: 'code-agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [{ id: 'loop', config: { loop: 'default' } }]
};

describe('SimpleCriticExecutor：评估', () => {
  it('结构合法的配置 → verdict=pass', async () => {
    const executor = new SimpleCriticExecutor();
    const result: CriticResult = await executor.evaluate(VALID_PROFILE);
    expect(result.verdict).toBe('pass');
  });

  it('结构非法的配置 → verdict=fail 且附带 errorLog', async () => {
    const executor = new SimpleCriticExecutor();
    const broken = { ...VALID_PROFILE, bundles: ['ok', 42] } as unknown as ProfileConfig;
    const result = await executor.evaluate(broken);
    expect(result.verdict).toBe('fail');
    expect(result.errorLog).toContain('bundles');
  });

  it('staticProfileEvaluator 可直接作为默认策略', async () => {
    const evalResult = await staticProfileEvaluator(VALID_PROFILE);
    expect(evalResult.verdict).toBe('pass');
  });
});

describe('SimpleCriticExecutor：runLoop', () => {
  it('评估即通过 → interrupted=false, retryCount=0', async () => {
    const executor = new SimpleCriticExecutor();
    const outcome = await executor.runLoop(VALID_PROFILE);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.retryCount).toBe(0);
    expect(outcome.config).toEqual(VALID_PROFILE);
  });

  it('无修复能力且评估失败 → 立即 interrupted（避免空转）', async () => {
    const executor = new SimpleCriticExecutor({
      evaluateProfile: async () => ({ verdict: 'fail', errorLog: '结构错误' })
    });
    const outcome = await executor.runLoop(VALID_PROFILE);
    expect(outcome.interrupted).toBe(true);
    expect(outcome.retryCount).toBe(0);
  });

  it('首次失败、注入修复后通过 → retryCount=1 且返回修复后配置', async () => {
    let calls = 0;
    const executor = new SimpleCriticExecutor({
      evaluateProfile: async (config) => {
        calls += 1;
        return config.name.includes('-fixed') ? { verdict: 'pass' } : { verdict: 'fail', errorLog: 'bad' };
      },
      fixer: async () => ({ name: `${VALID_PROFILE.name}-fixed` })
    });
    const outcome = await executor.runLoop(VALID_PROFILE);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.retryCount).toBe(1);
    expect(outcome.config.name).toBe('code-agent-fixed');
    expect(calls).toBe(2);
  });

  it('始终失败且每次有修复 → 达 maxRetry 后 interrupted=true', async () => {
    let calls = 0;
    const executor = new SimpleCriticExecutor({
      maxRetry: 2,
      evaluateProfile: async () => {
        calls += 1;
        return { verdict: 'fail', errorLog: '还是不行' };
      },
      fixer: async (_err, config) => ({ name: `${config.name}-x` })
    });
    const outcome = await executor.runLoop(VALID_PROFILE);
    expect(outcome.interrupted).toBe(true);
    expect(outcome.retryCount).toBe(2);
    expect(outcome.config.name).toBe('code-agent-x-x');
  });

  it('重试循环 ≤2 次：两次修复后通过时 retry_count 从 0→1→2 正确递增', async () => {
    let calls = 0;
    const executor = new SimpleCriticExecutor({
      maxRetry: 3,
      evaluateProfile: async (config) => {
        calls += 1;
        // 前两次失败，第三次（修复至 -v2 后）通过
        return config.name.includes('-v2') ? { verdict: 'pass' } : { verdict: 'fail', errorLog: '待修' };
      },
      fixer: async (_err, config) => ({
        name: config.name === VALID_PROFILE.name ? `${VALID_PROFILE.name}-v1` : `${VALID_PROFILE.name}-v2`
      })
    });
    const outcome = await executor.runLoop(VALID_PROFILE);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.retryCount).toBe(2); // 只允许 ≤2 次重试后即应通过
    expect(outcome.config.name).toBe('code-agent-v2');
    expect(calls).toBe(3);
  });

  it('3 次失败后中断：retryCount=3 且 interrupted=true', async () => {
    let calls = 0;
    const executor = new SimpleCriticExecutor({
      maxRetry: 3, // 与 agent-loop CRITIC_MAX_RETRY 一致
      evaluateProfile: async () => {
        calls += 1;
        return { verdict: 'fail', errorLog: '始终失败' };
      },
      fixer: async (_err, config) => ({ name: `${config.name}-x` })
    });
    const outcome = await executor.runLoop(VALID_PROFILE);
    expect(outcome.interrupted).toBe(true);
    expect(outcome.retryCount).toBe(3);
    expect(calls).toBe(3);
  });

  it('默认 maxRetry 与 agent-loop 上限常量一致', () => {
    expect(CRITIC_EXECUTOR_MAX_RETRY).toBe(3);
  });

  it('实现满足 ICriticExecutor 契约（satisfies）', () => {
    const executor = new SimpleCriticExecutor();
    const critic: ICriticExecutor = executor;
    expect(critic).toBeDefined();
  });
});
