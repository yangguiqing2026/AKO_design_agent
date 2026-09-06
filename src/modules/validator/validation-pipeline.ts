// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: src/modules/validator/validation-pipeline.ts
// 职责: Critic evaluator 管道（Sprint 3 B 模块）。
//   默认评估链：Schema 声明式校验 → patch-validator 结构校验 → SimulateRunTool 沙箱自检。
//   - 各环节可注入开关（风险 R3：沙箱默认启用但可关闭/替换）
//   - 输出 CriticEvaluation：verdict/errorLog/metrics（latency_ms + estimate token_count）
//   - token 估算口径（D5）：profile 序列化字符数 / 4，估算值标注 estimate 语义

import type { ProfileConfig } from '../../interfaces/config.interface';
import type { ProfileEvaluator, CriticEvaluation } from './critic-executor';
import { schemaByName, validateSchema } from './schema-validator';
import { validateProfile } from '../config-generator/patch-validator';

/** 沙箱 profile 检查器（结构最小化，便于测试注入假沙箱） */
export interface SandboxProfileChecker {
  run(request: { readonly profile: ProfileConfig; readonly timeout_ms?: number }): Promise<{
    readonly ok: boolean;
    readonly blocked: boolean;
    readonly summary?: { readonly status?: string; readonly reason?: string };
  }>;
}

/** token 估算（profile 序列化字符 / 4；estimate=true 口径） */
export function estimateProfileTokens(profile: ProfileConfig): number {
  try {
    const size = JSON.stringify(profile).length;
    return Math.max(1, Math.ceil(size / 4));
  } catch {
    return 1;
  }
}

export interface ValidationPipelineOptions {
  readonly enableSchema?: boolean;
  readonly enableStructural?: boolean;
  readonly sandbox?: SandboxProfileChecker;
  readonly now?: () => number;
}

/** 组装默认 critic evaluator 管道 */
export function buildPipelineEvaluator(options: ValidationPipelineOptions = {}): ProfileEvaluator {
  const enableSchema = options.enableSchema ?? true;
  const enableStructural = options.enableStructural ?? true;
  const nowProvider = options.now ?? ((): number => Date.now());

  return async (config: ProfileConfig): Promise<CriticEvaluation> => {
    const started = nowProvider();

    if (enableSchema) {
      const schemaOutcome = validateSchema(config, schemaByName('profile'));
      if (!schemaOutcome.valid) {
        return failEvaluation(schemaOutcome.issues, started, config, nowProvider);
      }
    }
    if (enableStructural) {
      const outcome = validateProfile(config);
      if (!outcome.valid) {
        return failEvaluation(outcome.issues, started, config, nowProvider);
      }
    }

    if (options.sandbox !== undefined) {
      const result = await options.sandbox.run({ profile: config });
      const latency = nowProvider() - started;
      if (result.blocked) {
        return {
          verdict: 'fail',
          errorLog: `沙箱自检被安全策略拦截：${result.summary?.reason ?? 'blocked'}`,
          metrics: { latency_ms: latency, token_count: estimateProfileTokens(config) }
        };
      }
      if (!result.ok) {
        return {
          verdict: 'fail',
          errorLog: `沙箱自检未通过：${result.summary?.reason ?? 'unknown'}`,
          metrics: { latency_ms: latency, token_count: estimateProfileTokens(config) }
        };
      }
    }

    return {
      verdict: 'pass',
      metrics: {
        latency_ms: nowProvider() - started,
        token_count: estimateProfileTokens(config)
      }
    };
  };
}

function failEvaluation(
  issues: readonly string[],
  started: number,
  config: ProfileConfig,
  now: () => number
): CriticEvaluation {
  return {
    verdict: 'fail',
    errorLog: issues.join('; '),
    metrics: { latency_ms: now() - started, token_count: estimateProfileTokens(config) }
  };
}
