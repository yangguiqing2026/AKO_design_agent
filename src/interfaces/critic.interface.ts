// AKO_studio - Design Agent v1.0.1
// 文件名: src/interfaces/critic.interface.ts
// 职责: Critic-Executor 评审闭环契约（v1.0.1 新建，无 any）。
//   - CriticResult：评审判定 + 错误日志 + 建议 + 度量
//   - ICriticExecutor：沙箱评估 / 建议修复 / 完整重试闭环
//   - 上限语义：最多重试 2 次（retry_count > 2 由 runLoop 判定转人工 interrupt）

import type { ProfileConfig } from './config.interface';

/** 评审判定 */
export type CriticVerdict = 'pass' | 'fail' | 'partial';

/** Critic 评审结果 */
export interface CriticResult {
  readonly verdict: CriticVerdict;
  readonly errorLog?: string;
  readonly suggestion?: string;
  readonly metrics?: {
    readonly latency_ms: number;
    readonly token_count: number;
  };
}

/**
 * Critic-Executor 接口。
 * v1.0.1 简化版：最多重试 3 次（与 agent-loop CRITIC_MAX_RETRY 一致），仍失败则求助人工。
 */
export interface ICriticExecutor {
  /** 在沙箱中评估配置（返回评审结论，不抛错即视为完成一轮） */
  evaluate(config: ProfileConfig): Promise<CriticResult>;

  /** 根据 Critic 建议生成修复后的配置片段 */
  suggestFix(errorLog: string, currentConfig: ProfileConfig): Promise<Partial<ProfileConfig>>;

  /**
   * 执行完整 Critic-Executor 循环。
   * @param initialConfig 初始配置
   * @returns 最终配置 + 是否中断（重试超限转人工）+ 实际重试次数
   */
  runLoop(initialConfig: ProfileConfig): Promise<{
    config: ProfileConfig;
    interrupted: boolean;
    retryCount: number;
  }>;
}
