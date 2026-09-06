// AKO_studio - Design Agent v1.0.0
// 文件名: src/core/version-guardian.ts
// 职责: DSH 版本锁定与校验（防腐层的第一道闸门）。
//       细化粒度：对每个被锁定包输出独立结果（locked/compatible/patch_ahead/blocked/missing），
//       聚合后可一键阻断启动。

import semver from 'semver';

import type {
  PinStrategy,
  VersionAuditSummary,
  VersionCheckResult,
  VersionGuardConfig
} from '../interfaces/version.interface';

const DEFAULT_STRATEGY: PinStrategy = 'exact';

/** 锁定校验未通过（含全部违规明细，禁止被静默忽略） */
export class VersionLockError extends Error {
  readonly code = 'VERSION_LOCK_BLOCKED';
  readonly results: readonly VersionCheckResult[];

  constructor(results: readonly VersionCheckResult[], message?: string) {
    super(
      message ??
        `DSH 版本锁定校验未通过：${results
          .map((r) => `${r.package_name}(${r.state}: ${r.message})`)
          .join('; ')}`
    );
    this.name = 'VersionLockError';
    this.results = results;
  }
}

/** 配置畸形（无法解析出有效锁定表） */
export class VersionGuardConfigError extends Error {
  readonly code = 'VERSION_GUARD_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'VersionGuardConfigError';
  }
}

function asStringRecord(value: unknown, field: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VersionGuardConfigError(`${field} 必须是对象`);
  }
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val !== 'string') {
      throw new VersionGuardConfigError(`${field}.${key} 必须是字符串版本约束`);
    }
    result[key] = val;
  }
  return result;
}

/** 将 config/dsh-lock.yml 解析结果（unknown）规范化为锁定配置，非法即抛错 */
export function parseVersionGuardConfig(raw: unknown): VersionGuardConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new VersionGuardConfigError('dsh-lock 配置根节点必须是对象');
  }
  const record = raw as Record<string, unknown>;
  const lockedVersions = asStringRecord(record.locked_versions, 'locked_versions');
  if (Object.keys(lockedVersions).length === 0) {
    throw new VersionGuardConfigError('locked_versions 不能为空');
  }
  for (const [pkg, constraint] of Object.entries(lockedVersions)) {
    if (semver.validRange(constraint) === null) {
      throw new VersionGuardConfigError(`locked_versions.${pkg} 不是合法版本约束: ${constraint}`);
    }
  }
  const strategyRaw = record.pin_strategy;
  const strategy: PinStrategy =
    strategyRaw === 'minor_lock' || strategyRaw === 'exact' ? strategyRaw : DEFAULT_STRATEGY;
  const fallbackMode =
    typeof record.fallback_mode === 'boolean' ? record.fallback_mode : false;
  const allowedUpdates = Array.isArray(record.allowed_updates)
    ? record.allowed_updates.filter((v): v is string => typeof v === 'string')
    : undefined;
  return {
    locked_versions: lockedVersions,
    fallback_mode: fallbackMode,
    pin_strategy: strategy,
    allowed_updates: allowedUpdates
  };
}

/** 从 package.json 原始内容（unknown）提取声明版本表（dependencies + optionalDependencies + peerDependencies） */
export function readDeclaredVersions(packageJsonRaw: unknown): Record<string, string> {
  if (typeof packageJsonRaw !== 'object' || packageJsonRaw === null) {
    return {};
  }
  const root = packageJsonRaw as Record<string, unknown>;
  const merged: Record<string, string> = {};
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const value = root[section];
    if (value === undefined || value === null) {
      continue; // package.json 未声明该段属正常情况
    }
    Object.assign(merged, asStringRecord(value, section));
  }
  return merged;
}

function describeRange(locked: string): { readonly ref: string; readonly range: string } {
  const exact = semver.valid(locked);
  if (exact !== null) {
    return { ref: exact, range: locked };
  }
  const min = semver.minVersion(locked);
  return { ref: min === null ? locked : min.version, range: locked };
}

export class VersionGuardian {
  private readonly config: VersionGuardConfig;
  private readonly declared: Readonly<Record<string, string | undefined>>;

  /**
   * 解析 dsh-lock 配置（静态入口；委托模块级 parseVersionGuardConfig）。
   * 供组合根以 “VersionGuardian 类” 统一使用配置解析与实例化。
   */
  static parseConfig(raw: unknown): VersionGuardConfig {
    return parseVersionGuardConfig(raw);
  }

  /** 从 package.json 原始内容（unknown）提取声明版本表（静态入口；委托 readDeclaredVersions） */
  static readDeclaredVersions(packageJsonRaw: unknown): Record<string, string> {
    return readDeclaredVersions(packageJsonRaw);
  }

  /**
   * @param config 锁定配置（locked_versions 为被锁包名 → 版本约束）
   * @param declared 当前运行环境声明版本表（package 名 → 版本号）
   */
  constructor(config: VersionGuardConfig, declared: Readonly<Record<string, string | undefined>>) {
    this.config = {
      fallback_mode: false,
      pin_strategy: DEFAULT_STRATEGY,
      ...config
    };
    this.declared = declared;
  }

  get configSnapshot(): Readonly<VersionGuardConfig> {
    return this.config;
  }

  /** 该包是否在锁定清单内 */
  isTracked(packageName: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.config.locked_versions, packageName);
  }

  /**
   * 单包粒度校验。
   * @param packageName 必须是锁定清单内的包，否则抛出配置错误。
   */
  checkPackage(packageName: string): VersionCheckResult {
    const locked = this.config.locked_versions[packageName];
    if (locked === undefined) {
      throw new VersionGuardConfigError(`包 ${packageName} 不在锁定清单内`);
    }
    const declaredVersion = this.declared[packageName];
    if (declaredVersion === undefined || declaredVersion === null) {
      return {
        package_name: packageName,
        locked_version: locked,
        declared_version: null,
        state: 'missing',
        strategy: this.config.pin_strategy ?? DEFAULT_STRATEGY,
        message: '声明表中不存在该包'
      };
    }
    return this.compare(packageName, locked, declaredVersion);
  }

  private compare(packageName: string, locked: string, declared: string): VersionCheckResult {
    const strategy = this.config.pin_strategy ?? DEFAULT_STRATEGY;
    const range = describeRange(locked);

    if (!semver.valid(declared)) {
      return {
        package_name: packageName,
        locked_version: locked,
        declared_version: declared,
        state: 'blocked',
        strategy,
        message: `声明版本「${declared}」不是合法 SemVer`
      };
    }

    if (strategy === 'exact') {
      const matched = semver.satisfies(declared, range.range) || semver.eq(declared, range.ref);
      return {
        package_name: packageName,
        locked_version: locked,
        declared_version: declared,
        state: matched ? 'locked' : 'blocked',
        strategy,
        message: matched
          ? `与锁定版本一致 (${locked})`
          : `声明 ${declared} 与锁定版本 ${locked} 不一致`
      };
    }

    // minor_lock：仅允许同 minor 的 patch/安全升级
    const lockedMajor = semver.major(range.ref);
    const lockedMinor = semver.minor(range.ref);
    const sameMinor =
      semver.major(declared) === lockedMajor && semver.minor(declared) === lockedMinor;
    if (!sameMinor) {
      return {
        package_name: packageName,
        locked_version: locked,
        declared_version: declared,
        state: 'blocked',
        strategy,
        message: `声明 ${declared} 与锁定 ${locked} 不在同一 minor 版本线`
      };
    }
    const isPatchAhead =
      semver.gt(declared, range.ref) &&
      semver.patch(declared) > semver.patch(range.ref);
    const compatible = semver.gte(declared, range.ref);
    return {
      package_name: packageName,
      locked_version: locked,
      declared_version: declared,
      state: compatible ? (isPatchAhead ? 'patch_ahead' : 'compatible') : 'blocked',
      strategy,
      message: compatible
        ? `同 minor 版本线内，声明 ${declared} >= 锁定 ${locked}`
        : `声明 ${declared} 低于锁定 ${locked}`
    };
  }

  /** 聚合审计：返回全部单包结果 + 阻断清单 */
  audit(): VersionAuditSummary {
    const results = Object.keys(this.config.locked_versions)
      .sort()
      .map((pkg) => this.checkPackage(pkg));
    const fallbackMode = this.config.fallback_mode ?? false;
    const blocked = results.filter(
      (r) => r.state === 'blocked' || (r.state === 'missing' && !fallbackMode)
    );
    return {
      compliant: blocked.length === 0,
      fallback_mode: fallbackMode,
      results,
      blocked,
      checked_at: new Date().toISOString()
    };
  }

  /** 硬闸门：任一阻断即抛 VersionLockError（不允许 fallback 静默忽略） */
  assertLocked(): void {
    const summary = this.audit();
    if (!summary.compliant) {
      throw new VersionLockError(summary.blocked);
    }
  }
}

