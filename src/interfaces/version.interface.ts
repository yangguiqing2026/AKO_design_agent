// AKO_studio - Design Agent v1.0.0
// 文件名: src/interfaces/version.interface.ts
// 职责: DSH 版本锁定（Version Guardian）契约，无 any

/** 锁定粒度策略 */
export type PinStrategy = 'exact' | 'minor_lock';

/**
 * 单包校验状态
 * - locked      ：声明版本与锁定版本完全一致
 * - compatible  ：minor_lock 下同 minor 且声明版本 >= 锁定版本
 * - patch_ahead ：minor_lock 下同 minor、patch 超前（允许范围，仅供审计）
 * - blocked     ：违反锁定（major/minor 漂移或精确不匹配）
 * - missing     ：包未声明/未安装
 */
export type VersionCheckState =
  | 'locked'
  | 'compatible'
  | 'patch_ahead'
  | 'blocked'
  | 'missing';

/** 单包校验结果（细化粒度：每个被锁定包一条） */
export interface VersionCheckResult {
  readonly package_name: string;
  readonly locked_version: string;
  readonly declared_version: string | null;
  readonly state: VersionCheckState;
  readonly strategy: PinStrategy;
  readonly message: string;
}

/** 版本锁定配置，对应 config/dsh-lock.yml */
export interface VersionGuardConfig {
  readonly locked_versions: Record<string, string>;
  readonly fallback_mode?: boolean;
  readonly pin_strategy?: PinStrategy;
  readonly allowed_updates?: readonly string[];
}

/** 聚合审计结果 */
export interface VersionAuditSummary {
  readonly compliant: boolean;
  readonly fallback_mode: boolean;
  readonly results: readonly VersionCheckResult[];
  readonly blocked: readonly VersionCheckResult[];
  readonly checked_at: string;
}
