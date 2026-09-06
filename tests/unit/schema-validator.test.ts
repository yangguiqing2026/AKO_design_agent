// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/unit/schema-validator.test.ts
// 覆盖: 声明式 schema 引擎——必填/类型/路径遍历（patches[].meta.depends_on）、
//       profile/patch/bundle/catalog 四类描述、未知 schema 报错。

import {
  assertValidBySchema,
  describeSchemas,
  SchemaValidatorError,
  schemaByName,
  validateSchema
} from '../../src/modules/validator/schema-validator';
import type { DesignProfile } from '../../src/interfaces/config.interface';

const VALID_PROFILE: DesignProfile = {
  name: 'agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [
    { id: 'a', config: { loop: 'default' } },
    { id: 'b', config: { tools: ['x'] }, meta: { depends_on: ['a'], build_order: 1 } }
  ]
};

describe('schema-validator：合法输入', () => {
  it('合法 profile 通过', () => {
    const outcome = validateSchema(VALID_PROFILE, schemaByName('profile'));
    expect(outcome.valid).toBe(true);
    expect(outcome.issues).toEqual([]);
  });

  it('可选字段缺失不报错（description/insert/meta 均可缺省）', () => {
    const outcome = validateSchema(
      { name: 'x', bundles: ['b'], patches: [{ id: 'p' }] },
      schemaByName('profile')
    );
    expect(outcome.valid).toBe(true);
  });

  it('describeSchemas 含 4 类 schema；schemaByName 未知抛 SchemaValidatorError', () => {
    expect(describeSchemas().map((s) => s.name).sort()).toEqual([
      'bundle',
      'component_catalog',
      'patch',
      'profile'
    ]);
    expect(() => schemaByName('nope' as never)).toThrow(SchemaValidatorError);
  });
});

describe('schema-validator：非法输入', () => {
  it('缺失必填 name/bundles/patches 报错', () => {
    const outcome = validateSchema({ patches: [] }, schemaByName('profile'));
    expect(outcome.valid).toBe(false);
    expect(outcome.issues.join(';')).toContain('name');
    expect(outcome.issues.join(';')).toContain('bundles');
  });

  it('类型错误：bundles 含数字、patch.id 为数字', () => {
    const outcome = validateSchema(
      {
        name: 'x',
        bundles: ['ok', 1],
        patches: [{ id: 7, config: [] }]
      },
      schemaByName('profile')
    );
    expect(outcome.valid).toBe(false);
    const joined = outcome.issues.join(';');
    expect(joined).toContain('bundles');
    expect(joined).toContain('patches[0].id');
  });

  it('patches[].meta.build_order 必须为 >=0 整数（-1/小数非法）', () => {
    const negative = validateSchema(
      { name: 'x', bundles: ['b'], patches: [{ id: 'p', meta: { build_order: -1 } }] },
      schemaByName('profile')
    );
    const fractional = validateSchema(
      { name: 'x', bundles: ['b'], patches: [{ id: 'p', meta: { build_order: 1.5 } }] },
      schemaByName('profile')
    );
    expect(negative.valid).toBe(false);
    expect(fractional.valid).toBe(false);
  });

  it('非数组 / 顶层非对象输入安全拒绝', () => {
    expect(validateSchema('x', schemaByName('profile')).valid).toBe(false);
    expect(validateSchema(null, schemaByName('patch')).valid).toBe(false);
    expect(validateSchema([], schemaByName('component_catalog')).valid).toBe(false);
  });
});

describe('schema-validator：patch/bundle/catalog 场景', () => {
  it('单条 patch 校验', () => {
    expect(
      validateSchema({ id: 'p', config: { a: 1 }, meta: { depends_on: ['x'] } }, schemaByName('patch')).valid
    ).toBe(true);
    expect(validateSchema({}, schemaByName('patch')).valid).toBe(false);
  });

  it('catalog 缺 tools 报错、合法通过', () => {
    expect(validateSchema({ bundles: ['b'] }, schemaByName('component_catalog')).valid).toBe(false);
    expect(validateSchema({ bundles: ['b'], tools: ['t'] }, schemaByName('component_catalog')).valid).toBe(true);
  });

  it('assertValidBySchema 非法即抛', () => {
    expect(() => assertValidBySchema({ bundles: [] }, 'profile')).toThrow(SchemaValidatorError);
  });
});
