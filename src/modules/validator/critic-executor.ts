// AKO_studio - Design Agent v1.0.1
// 文件名: src/modules/validator/critic-executor.ts
// 职责: SimpleCriticExecutor —— ICriticExecutor 的 v1.0.1 简化实现。
//   - evaluate：默认执行结构校验（复用 config-generator 的 validateProfile）；
//     生产装配可注入 evaluator（如 SimulateRunTool 沙箱执行）替换默认策略
//   - suggestFix：默认无可自动修复能力（返回空建议），交由注入 fixer（后续接 LLM）
//   - runLoop：完整闭环，最大尝试 = maxRetry（默认 3，与 agent-loop CRITIC_MAX_RETRY 一致）；
//     无修复建议或超限即 interrupted（转人工）

import type { CriticResult, ICriticExecutor } from '../../interfaces/critic.interface';
import type { ProfileConfig } from '../../interfaces/config.interface';
import type { CaseRecordInput, CaseSink } from '../../interfaces/learning.interface';

import { validateProfile } from '../config-generator/patch-validator';
import { mergeReplacing } from '../config-generator/patch-builder';

/** v1.0.1 简化版最大重试（与 agent-loop CRITIC_MAX_RETRY 保持一致） */
export const CRITIC_EXECUTOR_MAX_RETRY = 3;

export interface CriticEvaluation {
  readonly verdict: 'pass' | 'fail' | 'partial';
  readonly errorLog?: string;
  readonly suggestion?: string;
  /** Sprint 3：评估指标（latency/token），由 evaluator 管道上报 */
  readonly metrics?: {
    readonly latency_ms: number;
    readonly token_count: number;
  };
}

/** 评估函数（默认：结构校验；可注入沙箱/LLM 评估） */
export type ProfileEvaluator = (config: ProfileConfig) => Promise<CriticEvaluation>;

/** 修复函数（默认：无自动修复能力） */
export type ProfileFixer = (
  errorLog: string,
  currentConfig: ProfileConfig
) => Promise<Partial<ProfileConfig>>;

export interface SimpleCriticExecutorOptions {
  readonly maxRetry?: number;
  readonly evaluateProfile?: ProfileEvaluator;
  readonly fixer?: ProfileFixer;
  /**
   * Sprint 2：案例接收器钩子（D 模块）。
   * runLoop 结束（通过 / 无修复建议中断 / 超限转人工）时回调一次结局，
   * 供会话层/自学习模块沉淀 episodic 案例。不改动既有构造语义（可选参数）。
   */
  readonly onCaseSink?: CaseSink;
}

/** 默认静态评估：结构校验 + id 唯一性，不触发沙箱 I/O */
export const staticProfileEvaluator: ProfileEvaluator = async (
  config: ProfileConfig
): Promise<CriticEvaluation> => {
  const outcome = validateProfile(config);
  if (outcome.valid) {
    return { verdict: 'pass' };
  }
  return { verdict: 'fail', errorLog: outcome.issues.join('; ') };
};

export class SimpleCriticExecutor implements ICriticExecutor {
  private readonly maxRetry: number;
  private readonly evaluator: ProfileEvaluator;
  private readonly fixer: ProfileFixer;
  private readonly caseSink: CaseSink | undefined;

  constructor(options: SimpleCriticExecutorOptions = {}) {
    this.maxRetry = options.maxRetry ?? CRITIC_EXECUTOR_MAX_RETRY;
    this.evaluator = options.evaluateProfile ?? staticProfileEvaluator;
    this.fixer = options.fixer ?? (async (): Promise<Partial<ProfileConfig>> => ({}));
    this.caseSink = options.onCaseSink;
  }

  /** 在沙箱/静态策略中评估配置 */
  async evaluate(config: ProfileConfig): Promise<CriticResult> {
    const evaluation = await this.evaluator(config);
    return {
      verdict: evaluation.verdict,
      ...(evaluation.errorLog !== undefined ? { errorLog: evaluation.errorLog } : {}),
      ...(evaluation.suggestion !== undefined ? { suggestion: evaluation.suggestion } : {}),
      ...(evaluation.metrics !== undefined ? { metrics: evaluation.metrics } : {})
    };
  }

  /** 根据错误日志与当前配置生成修复建议（缺省无自动修复能力） */
  async suggestFix(errorLog: string, currentConfig: ProfileConfig): Promise<Partial<ProfileConfig>> {
    return this.fixer(errorLog, currentConfig);
  }

  /**
   * 完整 Critic-Executor 闭环。
   * - evaluate 通过 → 返回最终配置（interrupted=false, retryCount=已重试次数）
   * - 失败但有修复建议 → 应用建议后重试；无建议 → 立即 interrupted（避免空转）
   * - 超过 maxRetry → interrupted=true 转人工
   */
  async runLoop(initialConfig: ProfileConfig): Promise<{
    config: ProfileConfig;
    interrupted: boolean;
    retryCount: number;
  }> {
    let current = initialConfig;
    let retryCount = 0;
    for (;;) {
      const result = await this.evaluate(current);
      if (result.verdict === 'pass') {
        this.emitCase({ interrupted: false, retryCount, errorLog: undefined });
        return { config: current, interrupted: false, retryCount };
      }
      const fix = await this.suggestFix(result.errorLog ?? '', current);
      if (Object.keys(fix).length === 0) {
        this.emitCase({ interrupted: true, retryCount, errorLog: result.errorLog });
        return { config: current, interrupted: true, retryCount };
      }
      current = mergeReplacing(
        current as unknown as Readonly<Record<string, unknown>>,
        fix as Record<string, unknown>
      ) as unknown as ProfileConfig;
      retryCount += 1;
      if (retryCount >= this.maxRetry) {
        this.emitCase({ interrupted: true, retryCount, errorLog: result.errorLog });
        return { config: current, interrupted: true, retryCount };
      }
    }
  }

  /** runLoop 终结时回调案例接收器（仅在注入 onCaseSink 时触发） */
  private emitCase(input: {
    readonly interrupted: boolean;
    readonly retryCount: number;
    readonly errorLog: string | undefined;
  }): void {
    const sink = this.caseSink;
    if (sink === undefined) {
      return;
    }
    const record: CaseRecordInput = {
      source: 'critic_loop',
      verdict: input.interrupted ? 'rejected' : 'accepted',
      interrupted: input.interrupted,
      retry_count: input.retryCount,
      ...(input.errorLog !== undefined ? { error_log: [input.errorLog] } : {})
    };
    void sink(record);
  }
}
