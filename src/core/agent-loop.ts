// AKO_studio - Design Agent v1.0.1
// 文件名: src/core/agent-loop.ts
// 职责: 自定义 Agent 状态机（基于白皮书 §6.1 + v1.0.1 修正 4：Critic-Executor 重试回路）。
//
// v1.0.1 变更要点：
//   - VALIDATING 不再只通向 DELIVERING/INTERRUPTED：验证失败且 retry_count < CRITIC_MAX_RETRY
//     时回到 generate（修正后重试）；超限转 interrupt 求助人工
//   - 复杂度 complex 的验证通过仍进 interrupt 等待人工确认（白皮书 §8.2）
//   - 与修正 2/接口层一致：状态机提供纯函数 decidePostValidate + withRetryIncremented，
//     validate 节点内部调用 ICriticExecutor（Critic-Executor）并回写 retry_count
//
// 设计说明：本项目不引入 @langchain/langgraph 运行依赖；addConditionalEdges('validate', fn)
// 的判路逻辑被等价实现为 decidePostValidate，可直接作为条件边回调使用。

import type { DesignContext, DesignStatus } from '../interfaces/design-context.interface';
import type { ProfileConfig } from '../interfaces/config.interface';
import type { ICriticExecutor } from '../interfaces/critic.interface';

import { applyPatchConfig, createPatch } from '../modules/config-generator/patch-builder';

/** v1.0.1：Critic-Executor 最大重试次数（0→3 逐级递增，达到 3 即转人工） */
export const CRITIC_MAX_RETRY = 3;

/** VALIDATING 条件边可返回的目标 */
export type ValidateOutcome = 'generate' | 'deliver' | 'interrupt';

export interface GraphTransition {
  readonly from: DesignStatus;
  readonly to: readonly DesignStatus[];
}

/** 状态图静态边（VALIDATING 为条件边，见 decidePostValidate） */
export const STATE_GRAPH: readonly GraphTransition[] = [
  { from: 'idle', to: ['analyzing'] },
  { from: 'analyzing', to: ['matching', 'error'] },
  { from: 'matching', to: ['generating', 'error'] },
  { from: 'generating', to: ['validating', 'error'] },
  { from: 'validating', to: ['generating', 'delivering', 'interrupted', 'error'] },
  { from: 'delivering', to: ['completed', 'error'] },
  { from: 'interrupted', to: ['delivering', 'error'] }, // 人工确认/拒绝
  { from: 'error', to: ['idle'] } // fallback 恢复
];

export function allowedNextStates(from: DesignStatus): readonly DesignStatus[] {
  const transition = STATE_GRAPH.find((t) => t.from === from);
  return transition === undefined ? [] : transition.to;
}

/** 是否存在验证错误 */
export function hasValidationErrors(ctx: Pick<DesignContext, 'validation_errors'>): boolean {
  const errors = ctx.validation_errors ?? [];
  return errors.length > 0;
}

/**
 * v1.0.1 核心：VALIDATING 条件边判路。
 * - 验证失败 + retry_count < CRITIC_MAX_RETRY → 'generate'（回到生成态修正重试）
 * - 验证失败 + retry_count >= CRITIC_MAX_RETRY → 'interrupt'（求助人工）
 * - 验证通过 + complexity === 'complex' → 'interrupt'（复杂设计需人工确认）
 * - 验证通过 + 其余 → 'deliver'
 * 本函数为纯函数（不修改 ctx）；重试计数由节点内 withRetryIncremented 递增。
 */
export function decidePostValidate(
  ctx: Pick<DesignContext, 'validation_errors' | 'retry_count' | 'complexity'>
): ValidateOutcome {
  if (hasValidationErrors(ctx)) {
    if (ctx.retry_count < CRITIC_MAX_RETRY) {
      return 'generate';
    }
    return 'interrupt';
  }
  return ctx.complexity === 'complex' ? 'interrupt' : 'deliver';
}

/** 返回重试计数 +1 的新上下文（不可变），状态置为 generating 待回到生成节点 */
export function withRetryIncremented(ctx: DesignContext): DesignContext {
  return {
    ...ctx,
    status: 'generating',
    retry_count: ctx.retry_count + 1,
    checkpoint: 'validating->generate'
  };
}

/** 把条件边结果映射为正式状态名 */
export function toStatus(outcome: ValidateOutcome): DesignStatus {
  switch (outcome) {
    case 'generate':
      return 'generating';
    case 'deliver':
      return 'delivering';
    case 'interrupt':
      return 'interrupted';
  }
}

/** 静态主边（VALIDATING 使用条件边，其余按状态图推进；终态返回 null） */
export function nextStatus(ctx: DesignContext): DesignStatus | null {
  switch (ctx.status) {
    case 'validating':
      return toStatus(decidePostValidate(ctx));
    case 'delivering':
      return 'completed';
    case 'error':
      return 'idle';
    case 'completed':
    case 'interrupted':
      return null; // 等待人工/会话终结
    default:
      return allowedNextStates(ctx.status)[0] ?? 'error';
  }
}

export interface CriticRoundResult {
  readonly ctx: DesignContext;
  readonly next: DesignStatus;
}

/** 将 Critic 建议（Partial<ProfileConfig>）以整行替换语义合并到配置 */
export function applySuggestion(
  profile: ProfileConfig,
  suggestion: Partial<ProfileConfig>
): ProfileConfig {
  if (Object.keys(suggestion).length === 0) {
    return profile;
  }
  const patch = createPatch({
    id: 'critic-suggestion',
    config: suggestion as Record<string, unknown>
  });
  return applyPatchConfig(profile as unknown as Readonly<Record<string, unknown>>, patch) as unknown as ProfileConfig;
}

/**
 * VALIDATING 节点单轮执行：调用 Critic-Executor 评估；失败且未超限则应用建议并回退 generate，
 * 超限转 interrupted。节点返回更新后的上下文（不可变）与下一状态。
 */
export async function runValidationRound(
  ctx: DesignContext,
  critic: ICriticExecutor
): Promise<CriticRoundResult> {
  const profile = ctx.generated_profile;
  if (profile === undefined) {
    const errorCtx: DesignContext = {
      ...ctx,
      status: 'error',
      validation_errors: [...(ctx.validation_errors ?? []), '缺少 generated_profile，无法进入验证'],
      checkpoint: 'validating->error'
    };
    return { ctx: errorCtx, next: 'error' };
  }

  const result = await critic.evaluate(profile);
  if (result.verdict === 'pass') {
    const outcome = decidePostValidate({
      validation_errors: [],
      retry_count: ctx.retry_count,
      complexity: ctx.complexity
    });
    const passCtx: DesignContext = {
      ...ctx,
      status: toStatus(outcome),
      validation_errors: undefined,
      checkpoint: `validating->${outcome}`
    };
    return { ctx: passCtx, next: passCtx.status };
  }

  const errorLog =
    result.errorLog ?? (result.verdict === 'partial' ? '评估：部分通过，需修正' : '评估：未通过');
  if (ctx.retry_count < CRITIC_MAX_RETRY) {
    const suggestion = await critic.suggestFix(errorLog, profile);
    const fixedProfile = applySuggestion(profile, suggestion);
    const retryCtx = withRetryIncremented({
      ...ctx,
      validation_errors: [errorLog],
      generated_profile: fixedProfile
    });
    return { ctx: retryCtx, next: 'generating' };
  }

  const interruptCtx: DesignContext = {
    ...ctx,
    status: 'interrupted',
    validation_errors: [errorLog],
    checkpoint: 'validating-retry-exhausted'
  };
  return { ctx: interruptCtx, next: 'interrupted' };
}

export interface DesignAgentLoopDeps {
  /** Critic-Executor 实现（SimpleCriticExecutor 或注入 LLM 版） */
  readonly critic?: ICriticExecutor;
}

/** 状态机外观：提供节点判路与单轮推进（Critic 循环封装在 VALIDATING 节点内） */
export class DesignAgentLoop {
  private readonly critic: ICriticExecutor | undefined;

  constructor(deps: DesignAgentLoopDeps = {}) {
    this.critic = deps.critic;
  }

  /** 静态推进（同导出函数 nextStatus） */
  advance(ctx: DesignContext): DesignStatus | null {
    return nextStatus(ctx);
  }

  /**
   * 执行 VALIDATING 单轮。
   * 未注入 critic 时仅按条件边判路（推荐在接线层提供 critic 以真正驱动重试回路）。
   */
  async validate(ctx: DesignContext): Promise<CriticRoundResult> {
    if (this.critic === undefined) {
      const outcome = decidePostValidate(ctx);
      const nextCtx: DesignContext = { ...ctx, status: toStatus(outcome) };
      return { ctx: nextCtx, next: toStatus(outcome) };
    }
    return runValidationRound(ctx, this.critic);
  }
}
