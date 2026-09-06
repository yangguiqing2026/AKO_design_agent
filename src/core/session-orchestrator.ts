// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/core/session-orchestrator.ts
// 职责: 端到端设计会话编排（白皮书 §3.2 技术流程落地，Sprint 2 集成价值点）。
//   runDesignSession(prompt) 串行：analyze → match → generate → validate(Critic 重试回路) → deliver，
//   全程挂接 memory / checkpoint / case-sink（学习闭环）。
//   - 可恢复：传入 session_id 且存在未完成检查点时自动 resume（含 retry_count/complexity/profile）
//   - 可注入：generator / critic / analyzer / matcher 全部注入，测试不依赖真实网络与密钥
//   - 终止条件：completed（交付）/ interrupted（人工确认：approve/reject）/ error
//   - 所有状态推进前/后落检查点，便于断点续跑

import type { DesignContext, DesignStatus } from '../interfaces/design-context.interface';
import type { StructuredRequirement } from '../interfaces/design-context.interface';
import type { ICriticExecutor } from '../interfaces/critic.interface';
import type { IMemoryHub } from '../interfaces/memory.interface';
import type { ILearningHub } from '../interfaces/learning.interface';
import type {
  DesignSessionOptions,
  DesignSessionResult,
  ProfileGenerator,
  SessionEvent
} from '../interfaces/session.interface';
import type { RequirementAnalyzer } from '../modules/requirement-analyzer';
import type { PatternMatcher } from '../modules/pattern-matcher';
import type { SessionManager } from '../modules/session-manager/session-manager';
import type { CostCircuit } from '../modules/validator/cost-circuit';
import { BudgetExceededError } from '../modules/validator/cost-circuit';
import type { TimeCircuit } from '../modules/validator/time-circuit';
import { TimeBreachError } from '../modules/validator/time-circuit';
import { estimateProfileTokens } from '../modules/validator/validation-pipeline';
import { runValidationRound } from './agent-loop';

/** 编排默认最大步数（缺省与 config/default.yml runtime.max_steps 一致） */
export const DEFAULT_ORCHESTRATOR_MAX_STEPS = 20;

type LoggerLike = {
  readonly debug: (message: string, data?: unknown) => void;
  readonly info: (message: string, data?: unknown) => void;
  readonly warn: (message: string, data?: unknown) => void;
  readonly error: (message: string, data?: unknown) => void;
};

export interface SessionOrchestratorDeps {
  readonly analyzer: RequirementAnalyzer;
  readonly matcher: PatternMatcher;
  /** 配置生成 seam（默认 = generate-profile.tool.generate；测试可注入 fake） */
  readonly generator: ProfileGenerator;
  /** Critic-Executor（驱动验证/重试回路） */
  readonly critic: ICriticExecutor;
  readonly sessionManager: SessionManager;
  /** 三级记忆（可选） */
  readonly memoryHub?: IMemoryHub;
  /** 自学习中枢（可选；案例沉淀 + 权重更新收口） */
  readonly learningHub?: ILearningHub;
  /** Sprint 3：成本熔断（可选）；每次验证尝试按 profile 估算 token 记账，超限转 budget-exhausted */
  readonly costCircuit?: CostCircuit;
  /** 记账用模型名（缺省 'deepseek-v4-pro'，与 default.yml llm.model 一致） */
  readonly costModel?: string;
  /** Sprint 3：时间熔断（可选）；会话墙钟超限转 timeout-exhausted */
  readonly timeCircuit?: TimeCircuit;
  readonly logger?: LoggerLike;
  readonly now?: () => number;
}

/** 端到端会话编排器 */
export class SessionOrchestrator {
  private readonly analyzer: RequirementAnalyzer;
  private readonly matcher: PatternMatcher;
  private readonly generator: ProfileGenerator;
  private readonly critic: ICriticExecutor;
  private readonly sessionManager: SessionManager;
  private readonly memoryHub: IMemoryHub | undefined;
  private readonly learningHub: ILearningHub | undefined;
  private readonly costCircuit: CostCircuit | undefined;
  private readonly costModel: string;
  private readonly timeCircuit: TimeCircuit | undefined;
  private readonly logger: LoggerLike | undefined;
  private readonly nowProvider: () => number;

  constructor(deps: SessionOrchestratorDeps) {
    this.analyzer = deps.analyzer;
    this.matcher = deps.matcher;
    this.generator = deps.generator;
    this.critic = deps.critic;
    this.sessionManager = deps.sessionManager;
    this.memoryHub = deps.memoryHub;
    this.learningHub = deps.learningHub;
    this.costCircuit = deps.costCircuit;
    this.costModel = deps.costModel ?? 'deepseek-v4-pro';
    this.timeCircuit = deps.timeCircuit;
    this.logger = deps.logger;
    this.nowProvider = deps.now ?? ((): number => Date.now());
  }

  /** 会话唯一 id（缺省生成 dsg-{ts}-{rand}） */
  newSessionId(): string {
    return `dsg-${this.nowProvider()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /** 端到端执行 */
  async runDesignSession(prompt: string, options: DesignSessionOptions = {}): Promise<DesignSessionResult> {
    const sessionId = options.session_id ?? this.newSessionId();
    const maxSteps = options.max_steps ?? DEFAULT_ORCHESTRATOR_MAX_STEPS;

    // 恢复：存在未完成检查点则续跑
    let resumed = false;
    let ctx: DesignContext | null = null;
    if (options.session_id !== undefined) {
      const restored = this.sessionManager.resume(sessionId);
      if (restored !== null) {
        ctx = restored;
        resumed = true;
        this.emit(options, { kind: 'resume', session_id: sessionId, trace_id: ctx.trace_id, status: ctx.status, detail: `断点续跑：${ctx.checkpoint}` });
      }
    }
    if (ctx === null) {
      ctx = this.sessionManager.create(sessionId, prompt);
      this.emit(options, { kind: 'step', session_id: sessionId, trace_id: ctx.trace_id, status: ctx.status, detail: '会话开始' });
    }

    // Sprint 3：时间熔断墙钟起点（resume 也在此重置起点，wall-clock 从续跑点计）
    if (this.timeCircuit !== undefined) {
      this.timeCircuit.begin(sessionId);
    }

    let stepsUsed = 0;

    for (;;) {
      if (stepsUsed >= maxSteps) {
        // 步数耗尽的兜底：非终态一律转人工中断
        if (ctx.status !== 'completed' && ctx.status !== 'error' && ctx.status !== 'interrupted') {
          ctx = { ...ctx, status: 'interrupted', checkpoint: 'max-steps-exhausted' };
        }
      }

      // Sprint 3：会话墙钟检查（超限 → timeout-exhausted 中断，可 resume）
      if (this.timeCircuit !== undefined) {
        try {
          this.timeCircuit.checkSession();
        } catch (err) {
          if (err instanceof TimeBreachError) {
            ctx = {
              ...ctx,
              status: 'interrupted',
              checkpoint: 'timeout-exhausted',
              validation_errors: [...(ctx.validation_errors ?? []), err.message]
            };
            break;
          }
          throw err;
        }
      }

      if (ctx.status === 'interrupted') {
        if (options.human_decision === 'approve') {
          ctx = { ...ctx, status: 'delivering', checkpoint: 'human-approved' };
          continue;
        }
        break; // reject / 缺省等待：interrupted 为终态
      }

      if (isTerminal(ctx.status)) {
        break;
      }

      // 状态推进前保存检查点
      this.checkpoint(options, ctx, `before:${ctx.status}`);

      const before = ctx.status;
      try {
        ctx = await this.stepForward(ctx, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx = {
          ...ctx,
          status: 'error',
          validation_errors: [...(ctx.validation_errors ?? []), `编排异常：${message}`],
          checkpoint: 'orchestrator-error'
        };
      }
      stepsUsed += 1;
      this.checkpoint(options, ctx, `after:${before}->${ctx.status}`);
    }

    // 终态收尾：记忆 + 案例/权重
    const finalCtx = ctx;
    const delivered = finalCtx.status === 'completed';
    const failed = finalCtx.status === 'error';

    if (this.memoryHub !== undefined) {
      this.memoryHub.write({
        kind: 'short_term',
        session_id: sessionId,
        content: delivered
          ? `会话结束：配置已交付（pattern=${finalCtx.matched_pattern_id ?? 'none'}）`
          : failed
            ? '会话结束：error'
            : '会话结束：interrupted（等待人工）',
        tags: ['session-end']
      });
      if (delivered) {
        this.memoryHub.write({
          kind: 'episodic',
          session_id: sessionId,
          content: `会话 ${sessionId} 交付：pattern=${finalCtx.matched_pattern_id ?? 'none'}，retry=${finalCtx.retry_count}`,
          tags: ['delivered']
        });
      }
    }

    if (this.learningHub !== undefined) {
      this.learningHub.recordOutcome({
        session_id: sessionId,
        trace_id: finalCtx.trace_id,
        source: options.human_decision === 'approve' && delivered ? 'human_interrupt' : 'critic_loop',
        verdict: delivered ? 'accepted' : 'rejected',
        interrupted: !delivered,
        retry_count: finalCtx.retry_count,
        pattern_id: finalCtx.matched_pattern_id,
        profile: finalCtx.generated_profile,
        error_log: finalCtx.validation_errors
      });
    }

    const finalCheckpoint = this.sessionManager.checkpoint(finalCtx, `final:${finalCtx.status}`);
    this.logger?.info('会话结束', {
      session_id: sessionId,
      status: finalCtx.status,
      steps: stepsUsed,
      resumed,
      checkpoint: finalCheckpoint.checkpoint_id
    });

    return {
      session_id: sessionId,
      trace_id: finalCtx.trace_id,
      status: finalCtx.status,
      outcome: delivered ? 'delivered' : failed ? 'error' : 'interrupted',
      ctx: finalCtx,
      steps_used: stepsUsed,
      resumed,
      final_checkpoint_id: finalCheckpoint.checkpoint_id
    };
  }

  /** 单步推进状态机（analyze/match/generate/validate/deliver） */
  private async stepForward(ctx: DesignContext, options: DesignSessionOptions): Promise<DesignContext> {
    switch (ctx.status) {
      case 'idle':
      case 'analyzing':
        return this.analyzeStep(ctx, options);
      case 'matching':
        return this.matchStep(ctx, options);
      case 'generating':
        return this.generateStep(ctx, options);
      case 'validating':
        return this.validateStep(ctx, options);
      case 'delivering':
        return { ...ctx, status: 'completed', checkpoint: 'delivered' };
      default:
        return ctx;
    }
  }

  /** analyze 节点：需求结构化 + 复杂度判定；回写记忆 */
  private analyzeStep(ctx: DesignContext, options: DesignSessionOptions): DesignContext {
    const result = this.analyzer.analyze(ctx.user_prompt);
    const complexity = options.complexity_override ?? result.complexity;
    this.memoryHub?.write({
      kind: 'short_term',
      session_id: ctx.session_id,
      content: `需求分析：task_type=${result.structured.task_type}，complexity=${complexity}`,
      tags: ['analyze']
    });
    const next: DesignContext = {
      ...ctx,
      status: 'matching',
      structured_req: result.structured,
      complexity,
      checkpoint: 'analyzed'
    };
    return next;
  }

  /** match 节点：模式匹配并落 selected_pattern_id */
  private matchStep(ctx: DesignContext, _options: DesignSessionOptions): DesignContext {
    const structured = ctx.structured_req as StructuredRequirement;
    const match = this.matcher.matchStructured(structured, ctx.complexity);
    const patternId = match.selected_pattern?.id;
    const next: DesignContext = {
      ...ctx,
      status: 'generating',
      ...(patternId !== undefined ? { matched_pattern_id: patternId } : {}),
      ...(match.fallback_used ? { validation_errors: ['未找到强匹配模式，已回退 ReAct'] } : {}),
      checkpoint: 'matched'
    };
    return next;
  }

  /** generate 节点：调用 generator seam 产出配置并交由验证 */
  private async generateStep(ctx: DesignContext, _options: DesignSessionOptions): Promise<DesignContext> {
    // 重试回路语义：Critic 建议已整行替换到 generated_profile，故仅首次生成缺失时调用 seam，
    // 否则保留修复后的配置直接进入 VALIDATING（避免确定性生成器覆盖已修复内容）
    let profile = ctx.generated_profile;
    let checkpointLabel = 're-validating-fixed';
    if (profile === undefined) {
      const hints = this.memoryHub
        ?.recall('long_term', ctx.user_prompt, { limit: 4 })
        .map((hit) => hit.entry.content);
      profile = await this.generator({
        ctx,
        memory_hints: hints
      });
      checkpointLabel = 'generated';
    }
    const next: DesignContext = {
      ...ctx,
      status: 'validating',
      generated_profile: profile,
      validation_errors: undefined,
      checkpoint: checkpointLabel
    };
    return next;
  }

  /** validate 节点：单轮 Critic 评估（重试计数在 runValidationRound 内推进） */
  private async validateStep(ctx: DesignContext, options: DesignSessionOptions): Promise<DesignContext> {
    // Sprint 3：成本记账（估算 token）与预算熔断（达上限 → budget-exhausted 中断）
    const budgetMessage = this.accountValidation(ctx);
    if (budgetMessage !== null) {
      return {
        ...ctx,
        status: 'interrupted',
        checkpoint: 'budget-exhausted',
        validation_errors: [...(ctx.validation_errors ?? []), budgetMessage]
      };
    }

    const round = await runValidationRound(ctx, this.critic);

    this.emit(options, {
      kind: 'critic_round',
      session_id: ctx.session_id,
      trace_id: ctx.trace_id,
      status: round.ctx.status,
      retry_count: round.ctx.retry_count,
      detail: `验证结果：${round.next}`
    });
    return round.ctx;
  }

  /** 按 profile 估算 token 记账；未配熔断或暂无 profile 返回 null；超限返回错误消息 */
  private accountValidation(ctx: DesignContext): string | null {
    if (this.costCircuit === undefined || ctx.generated_profile === undefined) {
      return null;
    }
    const tokens = estimateProfileTokens(ctx.generated_profile);
    const estimate = this.costCircuit.estimateCost({ output: tokens });
    try {
      this.costCircuit.recordSession(
        ctx.session_id,
        ctx.trace_id,
        estimate.usd,
        estimate.tokens_total,
        this.costModel
      );
      return null;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return err.message;
      }
      throw err;
    }
  }

  /** 保存检查点并广播事件 */
  private checkpoint(options: DesignSessionOptions, ctx: DesignContext, label: string): void {
    if (this.sessionManager === undefined) {
      return;
    }
    const saved = this.sessionManager.checkpoint(ctx, label);
    this.emit(options, {
      kind: 'checkpoint',
      session_id: ctx.session_id,
      trace_id: ctx.trace_id,
      status: ctx.status,
      checkpoint_id: saved.checkpoint_id,
      detail: label
    });
  }

  private emit(options: DesignSessionOptions, event: SessionEvent): void {
    options.on_event?.(event);
  }
}

/** 终态判定 */
function isTerminal(status: DesignStatus): boolean {
  return status === 'completed' || status === 'error' || status === 'interrupted';
}
