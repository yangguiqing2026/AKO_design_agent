// AKO_studio - Design Agent v1.0.1
// 文件名: tests/unit/design-context.test.ts
// 覆盖: createDesignContext 工厂默认值 / trace_id 生成 / retry_count 语义 + Critic 契约编译冒烟

import { createDesignContext, type DesignContext } from '../../src/interfaces/design-context.interface';
import type { ProfileConfig } from '../../src/interfaces/config.interface';
import type { CriticResult, ICriticExecutor } from '../../src/interfaces/critic.interface';

const PROFILE: ProfileConfig = {
  name: 'code-agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [{ id: 'loop', config: { loop: 'default' } }]
};

describe('createDesignContext 工厂（v1.0.1）', () => {
  it('生成初始状态：idle / cost=0 / retry_count=0 / checkpoint 空', () => {
    const ctx = createDesignContext({ session_id: 's-1', user_prompt: '设计一个编码 Agent' });
    expect(ctx.status).toBe('idle');
    expect(ctx.cost_usd).toBe(0);
    expect(ctx.retry_count).toBe(0);
    expect(ctx.checkpoint).toBe('');
    expect(ctx.session_id).toBe('s-1');
    expect(ctx.user_prompt).toBe('设计一个编码 Agent');
    expect(typeof ctx.created_at).toBe('number');
  });

  it('缺省 trace_id 带 ako-dsg- 前缀且可过滤', () => {
    const ctx = createDesignContext({ session_id: 's-1', user_prompt: 'x' });
    expect(ctx.trace_id).toMatch(/^ako-dsg-\d+-\w+$/);
  });

  it('显式传入 trace_id 则原样保留', () => {
    const ctx = createDesignContext({ session_id: 's-1', user_prompt: 'x', trace_id: 'ako-dsg-fixed' });
    expect(ctx.trace_id).toBe('ako-dsg-fixed');
  });

  it('critic 契约可用结构类型编译（satisfies）', async () => {
    const executor = {
      evaluate: async (): Promise<CriticResult> => ({ verdict: 'pass' }),
      suggestFix: async (): Promise<Partial<ProfileConfig>> => ({ name: PROFILE.name }),
      runLoop: async (config: ProfileConfig) => ({ config, interrupted: false, retryCount: 0 })
    } satisfies ICriticExecutor;

    const result = await executor.runLoop(PROFILE);
    expect(result.retryCount).toBe(0);
    expect(result.interrupted).toBe(false);
    expect(result.config.name).toBe('code-agent');
  });

  it('上下文对象可按 retry_count 表达 Critic 计数', () => {
    const ctx: DesignContext = {
      ...createDesignContext({ session_id: 's-1', user_prompt: '复杂架构' }),
      retry_count: 1
    };
    expect(ctx.retry_count).toBe(1);
  });
});
