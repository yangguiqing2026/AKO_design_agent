// AKO_studio - Design Agent v1.0.1
// 文件名: tests/unit/agent-loop.test.ts
// 覆盖: v1.0.1 修正 4 —— VALIDATING 条件边（重试回路/人工确认）、retry 递增不可变、
//       Critic 单轮执行（pass→deliver、complex 人工确认、失败重试、超限 interrupt、缺配置→error）

import {
  createDesignContext,
  type DesignContext
} from '../../src/interfaces/design-context.interface';
import type { ProfileConfig } from '../../src/interfaces/config.interface';
import type { ICriticExecutor } from '../../src/interfaces/critic.interface';
import {
  allowedNextStates,
  CRITIC_MAX_RETRY,
  decidePostValidate,
  DesignAgentLoop,
  nextStatus,
  runValidationRound,
  toStatus,
  withRetryIncremented
} from '../../src/core/agent-loop';

const PROFILE: ProfileConfig = {
  name: 'code-agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [{ id: 'loop', config: { loop: 'default' } }]
};

function baseCtx(overrides: Partial<DesignContext> = {}): DesignContext {
  return {
    ...createDesignContext({ session_id: 's-1', user_prompt: '设计 Agent' }),
    status: 'validating',
    ...overrides
  };
}

function criticWith(options: {
  readonly verdict?: 'pass' | 'fail' | 'partial';
  readonly errorLog?: string;
  readonly fix?: Partial<ProfileConfig>;
}): ICriticExecutor {
  return {
    evaluate: async () => ({
      verdict: options.verdict ?? 'pass',
      ...(options.errorLog !== undefined ? { errorLog: options.errorLog } : {})
    }),
    suggestFix: async () => options.fix ?? {},
    runLoop: async (config) => ({ config, interrupted: false, retryCount: 0 })
  };
}

describe('decidePostValidate（修正 4 条件边判路）', () => {
  it('验证失败 + retry_count < 3 → generate', () => {
    expect(
      decidePostValidate({ validation_errors: ['x'], retry_count: 0, complexity: 'simple' })
    ).toBe('generate');
    expect(
      decidePostValidate({ validation_errors: ['x'], retry_count: CRITIC_MAX_RETRY - 1, complexity: 'complex' })
    ).toBe('generate');
  });

  it('验证失败 + retry_count >= 3 → interrupt', () => {
    expect(
      decidePostValidate({ validation_errors: ['x'], retry_count: 3, complexity: 'simple' })
    ).toBe('interrupt');
  });

  it('验证通过 + complex → interrupt（人工确认）', () => {
    expect(decidePostValidate({ validation_errors: [], retry_count: 0, complexity: 'complex' })).toBe(
      'interrupt'
    );
  });

  it('验证通过 + simple/medium/未标注 → deliver', () => {
    expect(decidePostValidate({ validation_errors: [], retry_count: 0, complexity: 'simple' })).toBe('deliver');
    expect(decidePostValidate({ validation_errors: [], retry_count: 0, complexity: 'medium' })).toBe('deliver');
    expect(decidePostValidate({ validation_errors: [], retry_count: 0 })).toBe('deliver');
  });
});

describe('retry 计数与不可变推进', () => {
  it('withRetryIncremented 返回新上下文（retry+1、generating、checkpoint），原对象不变', () => {
    const ctx = baseCtx({ retry_count: 1 });
    const next = withRetryIncremented(ctx);
    expect(next.retry_count).toBe(2);
    expect(next.status).toBe('generating');
    expect(next.checkpoint).toBe('validating->generate');
    expect(ctx.retry_count).toBe(1);
    expect(ctx.status).toBe('validating');
  });

  it('toStatus 结果映射与 nextStatus 静态推进', () => {
    expect(toStatus('generate')).toBe('generating');
    expect(toStatus('interrupt')).toBe('interrupted');
    expect(nextStatus(baseCtx({ status: 'idle' }))).toBe('analyzing');
    expect(nextStatus(baseCtx({ status: 'analyzing' }))).toBe('matching');
    expect(nextStatus(baseCtx({ status: 'matching' }))).toBe('generating');
    expect(nextStatus(baseCtx({ status: 'generating' }))).toBe('validating');
    expect(nextStatus(baseCtx({ status: 'delivering' }))).toBe('completed');
    expect(nextStatus(baseCtx({ status: 'completed' }))).toBeNull();
  });

  it('状态图边（VALIDATING 含重试回路）', () => {
    expect(allowedNextStates('validating')).toEqual(
      expect.arrayContaining(['generating', 'delivering', 'interrupted', 'error'])
    );
    expect(allowedNextStates('error')).toEqual(['idle']);
    expect(allowedNextStates('interrupted')).toEqual(expect.arrayContaining(['delivering', 'error']));
    expect(allowedNextStates('completed')).toEqual([]);
  });
});

describe('runValidationRound（VALIDATING 节点内含 Critic-Executor）', () => {
  it('评估通过且 simple → delivering，验证错误清空', async () => {
    const ctx = baseCtx({ generated_profile: PROFILE, complexity: 'simple' });
    const round = await runValidationRound(ctx, criticWith({ verdict: 'pass' }));
    expect(round.next).toBe('delivering');
    expect(round.ctx.status).toBe('delivering');
    expect(round.ctx.validation_errors).toBeUndefined();
  });

  it('评估通过但 complex → interrupted（人工确认）', async () => {
    const ctx = baseCtx({ generated_profile: PROFILE, complexity: 'complex' });
    const round = await runValidationRound(ctx, criticWith({ verdict: 'pass' }));
    expect(round.next).toBe('interrupted');
  });

  it('评估失败 + 未超限 → 应用建议回到 generate 并递增 retry_count', async () => {
    const ctx = baseCtx({ generated_profile: PROFILE, retry_count: 0 });
    const round = await runValidationRound(
      ctx,
      criticWith({ verdict: 'fail', errorLog: 'loop 配置非法', fix: { name: 'code-agent-v2' } })
    );
    expect(round.next).toBe('generating');
    expect(round.ctx.retry_count).toBe(1);
    expect(round.ctx.generated_profile?.name).toBe('code-agent-v2');
    expect(round.ctx.validation_errors).toEqual(['loop 配置非法']);
    expect(ctx.retry_count).toBe(0); // 原上下文不可变
  });

  it('评估失败 + 已达重试上限 → interrupted（转人工）', async () => {
    const ctx = baseCtx({ generated_profile: PROFILE, retry_count: CRITIC_MAX_RETRY });
    const round = await runValidationRound(ctx, criticWith({ verdict: 'fail', errorLog: 'bad' }));
    expect(round.next).toBe('interrupted');
    expect(round.ctx.status).toBe('interrupted');
    expect(round.ctx.checkpoint).toBe('validating-retry-exhausted');
  });

  it('缺少 generated_profile → error', async () => {
    const ctx = baseCtx({ generated_profile: undefined });
    const round = await runValidationRound(ctx, criticWith({ verdict: 'pass' }));
    expect(round.next).toBe('error');
    expect(round.ctx.validation_errors?.join(';')).toContain('缺少 generated_profile');
  });
});

describe('DesignAgentLoop 外观', () => {
  it('注入 critic 时 validate 走完整单轮', async () => {
    const loop = new DesignAgentLoop({ critic: criticWith({ verdict: 'pass' }) });
    const round = await loop.validate(baseCtx({ generated_profile: PROFILE, complexity: 'simple' }));
    expect(round.next).toBe('delivering');
  });

  it('未注入 critic 时 validate 退化为纯条件边判路', async () => {
    const loop = new DesignAgentLoop();
    const round = await loop.validate(baseCtx({ validation_errors: ['x'], retry_count: 0 }));
    expect(round.next).toBe('generating');
  });
});
