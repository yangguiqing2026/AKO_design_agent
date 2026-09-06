// AKO_studio - Design Agent v1.0.1
// 文件名: tests/integration/agent-loop.test.ts
// 用途: 状态机集成验证（修正 4）——真实 SimpleCriticExecutor + DesignAgentLoop 驱动
//       VALIDATING → GENERATING → VALIDATING 重试回路直至 deliver / interrupt。

import {
  createDesignContext,
  type DesignContext
} from '../../src/interfaces/design-context.interface';
import type { ProfileConfig } from '../../src/interfaces/config.interface';
import { DesignAgentLoop, nextStatus } from '../../src/core/agent-loop';
import { SimpleCriticExecutor } from '../../src/modules/validator/critic-executor';

const PROFILE: ProfileConfig = {
  name: 'code-agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [{ id: 'loop', config: { loop: 'default' } }]
};

function seedCtx(overrides: Partial<DesignContext> = {}): DesignContext {
  return {
    ...createDesignContext({ session_id: 's-1', user_prompt: '设计 Agent' }),
    status: 'validating',
    generated_profile: PROFILE,
    complexity: 'simple',
    ...overrides
  };
}

/**
 * 驱动 VALIDATING ↔ GENERATING 之间的状态机流转：
 * - validating：调用 loop.validate（Critic 单轮，返回新 ctx）
 * - generating：经 nextStatus 推进回 validating
 */
async function driveUntilTerminal(
  loop: DesignAgentLoop,
  seed: DesignContext,
  maxSteps = 12
): Promise<{ final: DesignContext; path: string[]; steps: number }> {
  let current = seed;
  let steps = 0;
  const path: string[] = [seed.status];
  while (steps < maxSteps) {
    steps += 1;
    if (current.status === 'validating') {
      const round = await loop.validate(current);
      current = round.ctx;
      path.push(current.status);
    } else if (current.status === 'generating') {
      const ns = nextStatus(current);
      if (ns === null) {
        break;
      }
      current = { ...current, status: ns };
      path.push(current.status);
    } else {
      break;
    }
  }
  return { final: current, path, steps };
}

describe('agent-loop 状态机集成（修正 4）', () => {
  it('验证失败一次、修复后通过：VALIDATING → GENERATING → VALIDATING → DELIVERING', async () => {
    let calls = 0;
    const critic = new SimpleCriticExecutor({
      evaluateProfile: async (config) => {
        calls += 1;
        return config.name.includes('-fixed')
          ? { verdict: 'pass' }
          : { verdict: 'fail', errorLog: '结构待修正' };
      },
      fixer: async () => ({ name: `${PROFILE.name}-fixed` })
    });
    const loop = new DesignAgentLoop({ critic });
    const { final, path } = await driveUntilTerminal(loop, seedCtx());

    expect(path).toContain('generating'); // 命中条件边：VALIDATING → GENERATING
    expect(final.status).toBe('delivering');
    expect(final.retry_count).toBe(1);
    expect(final.generated_profile?.name).toBe('code-agent-fixed');
    expect(final.validation_errors).toBeUndefined();
    expect(calls).toBe(2);
  });

  it('持续失败：重试 3 次后转 INTERRUPTED（人工求助）', async () => {
    let calls = 0;
    const critic = new SimpleCriticExecutor({
      evaluateProfile: async () => {
        calls += 1;
        return { verdict: 'fail', errorLog: '始终无法通过' };
      },
      fixer: async (_err, config) => ({ name: `${config.name}-x` })
    });
    const loop = new DesignAgentLoop({ critic });
    const { final, path } = await driveUntilTerminal(loop, seedCtx());

    expect(path.filter((s) => s === 'generating').length).toBeGreaterThanOrEqual(3);
    expect(final.status).toBe('interrupted');
    expect(final.retry_count).toBe(3);
    expect(final.checkpoint).toBe('validating-retry-exhausted');
    expect(final.validation_errors).toContain('始终无法通过');
    expect(calls).toBe(4); // 3 次失败评估 + 第 4 次评估发现 retry_count=3 → interrupt
  });

  it('验证通过但复杂度 complex：直接 INTERRUPTED 等待人工确认（不进入重试）', async () => {
    const critic = new SimpleCriticExecutor(); // 静态评估对合法配置判 pass
    const loop = new DesignAgentLoop({ critic });
    const { final, path } = await driveUntilTerminal(loop, seedCtx({ complexity: 'complex' }));

    expect(final.status).toBe('interrupted');
    expect(final.retry_count).toBe(0);
    expect(path).not.toContain('generating');
  });
});
