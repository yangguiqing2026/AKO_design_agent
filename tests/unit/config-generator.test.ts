// AKO_studio - Design Agent v1.0.1
// 文件名: tests/unit/config-generator.test.ts
// 覆盖: Patch 构建/整行替换/幂等/拓扑排序/字段无损断言 + Patch/Profile 结构校验

import {
  annotateBuildOrder,
  applyPatchConfig,
  applyPatchSet,
  buildProfile,
  CircularDependencyError,
  createPatch,
  deepKeysOf,
  findDuplicatePatchIds,
  mergeReplacing,
  missingFields,
  PatchBuildError,
  sortPatchesTopologically
} from '../../src/modules/config-generator/patch-builder';
import {
  additiveLossFields,
  assertAdditive,
  assertValidProfile,
  duplicatePatchIds,
  PatchValidationError,
  validatePatch,
  validateProfile
} from '../../src/modules/config-generator/patch-validator';
import type { CordisPatch, DesignProfile } from '../../src/interfaces/config.interface';

describe('patch-builder：创建与规范化', () => {
  it('createPatch 复制输入且 id 去除空白', () => {
    const config = { loop: 'default' };
    const patch = createPatch({ id: '  p-1 ', config });
    expect(patch.id).toBe('p-1');
    expect(patch.config).toEqual({ loop: 'default' });
    config.loop = 'mutated'; // 外部篡改不影响已创建 patch
    expect(patch.config).toEqual({ loop: 'default' });
  });

  it('空 id 抛出 PatchBuildError', () => {
    expect(() => createPatch({ id: '   ' })).toThrow(PatchBuildError);
  });
});

describe('patch-builder：整行替换语义（v1.0.1，非 deep-merge）', () => {
  it('嵌套对象被整体替换，数组/标量替换，未覆盖键保留且不修改入参', () => {
    const base = { a: { x: 1, y: 2 }, list: [1], keep: true };
    const override = { a: { y: 9 }, list: [2, 3] };
    const merged = mergeReplacing(base, override);
    expect(merged).toEqual({ a: { y: 9 }, list: [2, 3], keep: true }); // a.x 被整行替换删除
    expect(base).toEqual({ a: { x: 1, y: 2 }, list: [1], keep: true });
  });

  it('applyPatchConfig：无 config 时返回克隆', () => {
    const base = { a: 1 };
    const out = applyPatchConfig(base, createPatch({ id: 'p' }));
    expect(out).toEqual({ a: 1 });
    expect(out).not.toBe(base);
  });

  it('applyPatchSet 按顺序整行替换（同顺序重复应用结果幂等）', () => {
    const base = { a: { b: 1 } };
    const patches = [
      createPatch({ id: 'p1', config: { a: { c: 2 } } }),
      createPatch({ id: 'p2', config: { a: { c: 3 }, d: 4 } })
    ];
    const merged = applyPatchSet(base, patches);
    expect(merged).toEqual({ a: { c: 3 }, d: 4 }); // a 子树每次被整行替换
    const twice = applyPatchSet(merged, [patches[1]]);
    expect(twice).toEqual(merged);
  });
});

describe('patch-builder：字段无损与 id 唯一', () => {
  it('deepKeysOf / missingFields 检测丢失字段', () => {
    const original = { a: { b: 1 }, c: 2 };
    expect(deepKeysOf(original)).toEqual(['a', 'a.b', 'c']);
    expect(missingFields(original, { a: { b: 1 }, c: 2 })).toEqual([]);
    expect(missingFields(original, { c: 2 })).toEqual(['a', 'a.b']);
  });

  it('findDuplicatePatchIds 仅报告重复项', () => {
    const patches = [
      createPatch({ id: 'x' }),
      createPatch({ id: 'y' }),
      createPatch({ id: 'x' })
    ];
    expect(findDuplicatePatchIds(patches)).toEqual(['x']);
  });

  it('buildProfile 校验 name 与 id 唯一性', () => {
    expect(() =>
      buildProfile({ name: '  ', bundles: [], patches: [] })
    ).toThrow(PatchBuildError);
    expect(() =>
      buildProfile({
        name: 'agent',
        bundles: [],
        patches: [createPatch({ id: 'a' }), createPatch({ id: 'a' })]
      })
    ).toThrow(/重复/);
    const profile = buildProfile({
      name: ' code-agent ',
      description: 'desc',
      bundles: ['@deepseek-ai/dsh-base'],
      patches: [createPatch({ id: 'p1', config: { loop: 'default' } })]
    });
    expect(profile.name).toBe('code-agent');
    expect(profile.patches).toHaveLength(1);
  });
});

describe('patch-validator：结构校验', () => {
  it('validatePatch 识别缺 id / config 非对象 / insert 内非对象', () => {
    expect(validatePatch(null).valid).toBe(false);
    expect(validatePatch({ config: {} }).valid).toBe(false);
    expect(validatePatch({ id: 'p', config: 'x' }).valid).toBe(false);
    expect(validatePatch({ id: 'p', insert: [{}, 'bad'] }).valid).toBe(false);
    expect(validatePatch({ id: 'p', config: { a: 1 } }).valid).toBe(true);
  });

  it('validatePatch 校验 meta 字段形态', () => {
    expect(validatePatch({ id: 'p', meta: 'x' }).valid).toBe(false);
    expect(validatePatch({ id: 'p', meta: { depends_on: [1] } }).valid).toBe(false);
    expect(validatePatch({ id: 'p', meta: { depends_on: ['a'], build_order: -1 } }).valid).toBe(false);
    expect(validatePatch({ id: 'p', meta: { depends_on: ['a'], build_order: 2 } }).valid).toBe(true);
  });

  it('validateProfile 检查 bundles 与 patch id 重复', () => {
    const profile = {
      name: 'agent',
      bundles: 'nope',
      patches: [{ id: 'a' }, { id: 'a' }]
    };
    const outcome = validateProfile(profile);
    expect(outcome.valid).toBe(false);
    expect(outcome.issues.join(';')).toContain('重复');
  });

  it('assertValidProfile 抛 PatchValidationError', () => {
    expect(() => assertValidProfile({ name: '', bundles: [], patches: [] })).toThrow(
      PatchValidationError
    );
  });
});

describe('patch-validator：additive 语义（整行替换下补丁须携带完整行）', () => {
  it('补丁携带完整替换块则无字段丢失', () => {
    const original = { loop: 'default', tools: { search: true, calculator: false } };
    // 整行替换：修改 tools 时必须给出完整子树，否则 tools.search 会被判定为丢失
    const patch = createPatch({ id: 'tune', config: { tools: { search: true, calculator: true } } });
    expect(additiveLossFields(original, [patch])).toEqual([]);
    expect(() => assertAdditive(original, [patch])).not.toThrow();
  });

  it('补丁给出不完整子树（整行替换遗漏字段）→ 判定丢失并抛错', () => {
    const original = { tools: { search: true, calculator: false } };
    const partial = createPatch({ id: 'tune', config: { tools: { calculator: true } } });
    expect(additiveLossFields(original, [partial])).toContain('tools.search');
    expect(() => assertAdditive(original, [partial])).toThrow(PatchValidationError);
  });

  it('补丁以 null 覆盖子树导致字段丢失 → assertAdditive 抛错', () => {
    const original = { a: { b: 1 }, c: 2 };
    const patch = createPatch({ id: 'drop', config: { a: null } });
    expect(additiveLossFields(original, [patch])).toContain('a.b');
    expect(() => assertAdditive(original, [patch])).toThrow(PatchValidationError);
  });

  it('duplicatePatchIds 便捷函数', () => {
    const profile: DesignProfile = {
      name: 'x',
      bundles: [],
      patches: [createPatch({ id: 'a' }), createPatch({ id: 'a' })]
    };
    expect(duplicatePatchIds(profile)).toEqual(['a']);
  });
});

describe('patch meta 与拓扑排序（v1.0.1）', () => {
  it('createPatch 透传并复制 meta（外部数组篡改不影响产物）', () => {
    const dependsOn = ['base'];
    const patch = createPatch({ id: 'p', meta: { depends_on: dependsOn, build_order: 0 } });
    expect(patch.meta).toEqual({ depends_on: ['base'], build_order: 0 });
    dependsOn.push('other');
    expect(patch.meta?.depends_on).toEqual(['base']);
  });

  it('sortPatchesTopologically 将依赖者排在依赖之后（稳定且外部依赖忽略）', () => {
    const patches: CordisPatch[] = [
      createPatch({ id: 'web', meta: { depends_on: ['base', 'external-catalog-item'] } }),
      createPatch({ id: 'base', meta: { depends_on: [] } }),
      createPatch({ id: 'loop', meta: { depends_on: [] } })
    ];
    const ordered = sortPatchesTopologically(patches).map((p) => p.id);
    expect(ordered.indexOf('base')).toBeLessThan(ordered.indexOf('web'));
  });

  it('annotateBuildOrder 按拓扑序写入 build_order（0 起，不修改入参）', () => {
    const patches: CordisPatch[] = [
      createPatch({ id: 'app', meta: { depends_on: ['router'] } }),
      createPatch({ id: 'router', meta: { depends_on: [] } })
    ];
    const annotated = annotateBuildOrder(patches);
    const orderOf = (id: string): number | undefined =>
      annotated.find((p) => p.id === id)?.meta?.build_order;
    expect(orderOf('app')).toBeGreaterThan(orderOf('router') ?? -1);
    expect(patches[0].meta?.build_order).toBeUndefined(); // 原数组未被修改
  });

  it('集合内依赖成环 → CircularDependencyError', () => {
    const patches: CordisPatch[] = [
      createPatch({ id: 'a', meta: { depends_on: ['b'] } }),
      createPatch({ id: 'b', meta: { depends_on: ['a'] } })
    ];
    expect(() => sortPatchesTopologically(patches)).toThrow(CircularDependencyError);
    expect(() => annotateBuildOrder(patches)).toThrow(CircularDependencyError);
    try {
      sortPatchesTopologically(patches);
    } catch (err) {
      expect((err as CircularDependencyError).code).toBe('PATCH_CIRCULAR_DEPENDENCY');
    }
  });
});
