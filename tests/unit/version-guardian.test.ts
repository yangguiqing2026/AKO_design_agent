// AKO_studio - Design Agent v1.0.0
// 文件名: tests/unit/version-guardian.test.ts
// 覆盖: exact/minor_lock 粒度、missing/blocked、fallback_mode、聚合阻断、配置解析

import {
  parseVersionGuardConfig,
  readDeclaredVersions,
  VersionGuardConfigError,
  VersionGuardian,
  VersionLockError
} from '../../src/core/version-guardian';
import type { VersionGuardConfig } from '../../src/interfaces/version.interface';

const lock: VersionGuardConfig = {
  locked_versions: {
    '@deepseek-ai/dsh-agent': '0.1.3-alpha.1',
    '@deepseek-ai/cordis': '0.1.3-alpha.1',
    '@deepseek-ai/dsh-llm': '0.1.3-alpha.1'
  },
  fallback_mode: false,
  pin_strategy: 'exact'
};

describe('VersionGuardian exact 粒度', () => {
  it('声明与锁定完全一致 → locked，审计通过', () => {
    const guardian = new VersionGuardian(lock, {
      '@deepseek-ai/dsh-agent': '0.1.3-alpha.1',
      '@deepseek-ai/cordis': '0.1.3-alpha.1',
      '@deepseek-ai/dsh-llm': '0.1.3-alpha.1'
    });
    const result = guardian.checkPackage('@deepseek-ai/dsh-agent');
    expect(result.state).toBe('locked');
    expect(guardian.audit().compliant).toBe(true);
  });

  it('exact 策略下 patch 漂移即 blocked', () => {
    const guardian = new VersionGuardian(
      { locked_versions: { pkg: '1.2.3' } },
      { pkg: '1.2.4' }
    );
    expect(guardian.checkPackage('pkg').state).toBe('blocked');
    expect(() => guardian.assertLocked()).toThrow(VersionLockError);
  });

  it('未在锁定清单的包 → 抛配置错误', () => {
    const guardian = new VersionGuardian({ locked_versions: { pkg: '1.0.0' } }, { other: '2.0.0' });
    expect(() => guardian.checkPackage('other')).toThrow(VersionGuardConfigError);
  });
});

describe('VersionGuardian missing / fallback_mode', () => {
  it('声明缺失 → missing；fallback=false 时阻断启动', () => {
    const guardian = new VersionGuardian(
      { locked_versions: { pkg: '1.0.0' }, fallback_mode: false },
      {}
    );
    const summary = guardian.audit();
    expect(summary.results[0].state).toBe('missing');
    expect(summary.compliant).toBe(false);
    expect(summary.blocked).toHaveLength(1);
    expect(() => guardian.assertLocked()).toThrow(/missing/);
  });

  it('fallback_mode=true 时 missing 不阻断（降级路径合法）', () => {
    const guardian = new VersionGuardian(
      { locked_versions: { pkg: '1.0.0' }, fallback_mode: true },
      {}
    );
    const summary = guardian.audit();
    expect(summary.results[0].state).toBe('missing');
    expect(summary.compliant).toBe(true);
  });
});

describe('VersionGuardian minor_lock 细化粒度', () => {
  const minorConfig = (): VersionGuardConfig => ({
    locked_versions: { pkg: '1.2.0' },
    pin_strategy: 'minor_lock',
    fallback_mode: false
  });

  it('同 minor 的 patch 升级 → compatible / patch_ahead', () => {
    const same = new VersionGuardian(minorConfig(), { pkg: '1.2.0' });
    expect(same.checkPackage('pkg').state).toBe('compatible');

    const ahead = new VersionGuardian(minorConfig(), { pkg: '1.2.7' });
    expect(ahead.checkPackage('pkg').state).toBe('patch_ahead');
  });

  it('minor 漂移（1.3.x）→ blocked', () => {
    const guardian = new VersionGuardian(minorConfig(), { pkg: '1.3.0' });
    expect(guardian.checkPackage('pkg').state).toBe('blocked');
    expect(() => guardian.assertLocked()).toThrow(VersionLockError);
  });

  it('低于锁定版本 → blocked', () => {
    const guardian = new VersionGuardian(minorConfig(), { pkg: '1.1.9' });
    expect(guardian.checkPackage('pkg').state).toBe('blocked');
  });
});

describe('版本锁定错误细节', () => {
  it('VersionLockError 携带 code 与逐包结果', () => {
    const guardian = new VersionGuardian(
      { locked_versions: { a: '1.0.0', b: '2.0.0' } },
      { a: '1.0.1', b: '2.1.0' }
    );
    try {
      guardian.assertLocked();
      throw new Error('应当抛出 VersionLockError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersionLockError);
      expect((err as VersionLockError).code).toBe('VERSION_LOCK_BLOCKED');
      expect((err as VersionLockError).results).toHaveLength(2);
    }
  });
});

describe('配置解析 parseVersionGuardConfig', () => {
  it('锁定表缺失 / 为空 / 非法范围 → 抛配置错误', () => {
    expect(() => parseVersionGuardConfig({})).toThrow(VersionGuardConfigError);
    expect(() => parseVersionGuardConfig({ locked_versions: {} })).toThrow(VersionGuardConfigError);
    expect(() => parseVersionGuardConfig({ locked_versions: { a: '不是版本' } })).toThrow(
      VersionGuardConfigError
    );
  });

  it('合法锁定表正确规范化（策略缺省 exact）', () => {
    const config = parseVersionGuardConfig({
      locked_versions: { '@deepseek-ai/cordis': '0.1.3-alpha.1' },
      fallback_mode: false
    });
    expect(config.pin_strategy).toBe('exact');
    expect(config.fallback_mode).toBe(false);
    expect(config.locked_versions['@deepseek-ai/cordis']).toBe('0.1.3-alpha.1');
  });

  it('未知策略回落 exact；明确 minor_lock 被保留', () => {
    expect(parseVersionGuardConfig({ locked_versions: { a: '1.0.0' }, pin_strategy: 'wat' }).pin_strategy).toBe('exact');
    expect(parseVersionGuardConfig({ locked_versions: { a: '1.0.0' }, pin_strategy: 'minor_lock' }).pin_strategy).toBe('minor_lock');
  });
});

describe('readDeclaredVersions', () => {
  it('合并 dependencies / optionalDependencies / peerDependencies', () => {
    const declared = readDeclaredVersions({
      dependencies: { dotenv: '^16.0.0' },
      optionalDependencies: { opt: '1.0.0' },
      peerDependencies: { peer: '2.0.0' }
    });
    expect(declared).toMatchObject({ dotenv: '^16.0.0', opt: '1.0.0', peer: '2.0.0' });
  });

  it('非对象输入 → 空表', () => {
    expect(readDeclaredVersions(null)).toEqual({});
    expect(readDeclaredVersions('x')).toEqual({});
  });
});

describe('VersionGuardian 静态入口（Sprint 3 组合根统一走类）', () => {
  it('parseConfig 与模块级 parseVersionGuardConfig 等价', () => {
    const raw = { locked_versions: { a: '1.0.0' }, pin_strategy: 'minor_lock' };
    expect(VersionGuardian.parseConfig(raw)).toEqual(parseVersionGuardConfig(raw));
    expect(() => VersionGuardian.parseConfig({})).toThrow(VersionGuardConfigError);
  });

  it('readDeclaredVersions 静态方法与模块函数等价', () => {
    const raw = { dependencies: { a: '1.0.0' } };
    expect(VersionGuardian.readDeclaredVersions(raw)).toEqual(readDeclaredVersions(raw));
  });
});
