// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: src/modules/validator/schema-validator.ts
// 职责: 中间产物 Schema 校验（Sprint 3 B 模块；白皮书 §4.2「中间输出 JSON + JSON Schema 校验」）。
//   - 声明式 schema 描述（Profile/Patch/Bundle/ComponentCatalog），无第三方 JSON-Schema 依赖（D2）
//   - 路径 DSL：'name'、'patches[].id'（[] 表示遍历数组元素）
//   - 输出统一 SchemaOutcome（valid/issues），供 critic evaluator 管道消费
//   - 语义校验（patch id 唯一/additive/拓扑成环）仍归 patch-validator/config-generator，分层不重复

/** Schema 值类型 */
export type SchemaValueType =
  | 'string'
  | 'stringArray'
  | 'object'
  | 'objectArray'
  | 'number'
  | 'integer'
  | 'boolean';

/** 单条 schema 规则 */
export interface SchemaRule {
  /** 点路径：'name'、'patches[].id'、'patches[].meta.depends_on' */
  readonly path: string;
  readonly type: SchemaValueType;
  /** 必须存在（缺省 false = 可选） */
  readonly required?: boolean;
  readonly description?: string;
}

/** 声明式 schema */
export interface DeclaredSchema {
  readonly name: string;
  readonly version: 1;
  readonly title: string;
  readonly rules: readonly SchemaRule[];
}

export type SchemaName = 'profile' | 'patch' | 'bundle' | 'component_catalog';

/** 校验结果（与 patch-validator 同构） */
export interface SchemaOutcome {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

/** Schema 校验失败 */
export class SchemaValidatorError extends Error {
  readonly code = 'SCHEMA_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidatorError';
  }
}

/** profile schema（对齐 DesignProfile 结构） */
const PROFILE_SCHEMA: DeclaredSchema = {
  name: 'profile',
  version: 1,
  title: 'DesignProfile（name/bundles/patches 结构契约）',
  rules: [
    { path: 'name', type: 'string', required: true, description: 'profile 名称，非空字符串' },
    { path: 'description', type: 'string', description: '可选描述' },
    { path: 'bundles', type: 'stringArray', required: true },
    { path: 'patches', type: 'objectArray', required: true },
    { path: 'patches[].id', type: 'string', required: true },
    { path: 'patches[].config', type: 'object', description: '整行替换配置片段（可选）' },
    { path: 'patches[].insert', type: 'objectArray', description: '插入片段列表（可选）' },
    { path: 'patches[].meta', type: 'object', description: '拓扑元数据（可选）' },
    { path: 'patches[].meta.depends_on', type: 'stringArray', description: '依赖 id 列表' },
    {
      path: 'patches[].meta.build_order',
      type: 'integer',
      description: '拓扑构建顺序（>=0，annotateBuildOrder 填充）'
    }
  ]
};

/** patch schema（独立单条校验） */
const PATCH_SCHEMA: DeclaredSchema = {
  name: 'patch',
  version: 1,
  title: 'CordisPatch 结构契约',
  rules: [
    { path: 'id', type: 'string', required: true },
    { path: 'config', type: 'object' },
    { path: 'insert', type: 'objectArray' },
    { path: 'meta', type: 'object' },
    { path: 'meta.depends_on', type: 'stringArray' },
    { path: 'meta.build_order', type: 'integer' }
  ]
};

/** bundle schema（组件/功能包） */
const BUNDLE_SCHEMA: DeclaredSchema = {
  name: 'bundle',
  version: 1,
  title: 'Bundle 包结构契约',
  rules: [
    { path: 'id', type: 'string', required: true },
    { path: 'description', type: 'string' },
    { path: 'includes', type: 'stringArray', description: '包含的组件/补丁 id' }
  ]
};

/** component-catalog schema（knowledge/component-catalog.json） */
const CATALOG_SCHEMA: DeclaredSchema = {
  name: 'component_catalog',
  version: 1,
  title: '组件目录结构契约',
  rules: [
    { path: 'bundles', type: 'stringArray', required: true },
    { path: 'tools', type: 'stringArray', required: true }
  ]
};

const SCHEMAS: readonly DeclaredSchema[] = [
  PROFILE_SCHEMA,
  PATCH_SCHEMA,
  BUNDLE_SCHEMA,
  CATALOG_SCHEMA
];

/** 全部声明式 schema（审计/导出用） */
export function describeSchemas(): readonly DeclaredSchema[] {
  return SCHEMAS.map((schema) => ({ ...schema, rules: schema.rules.map((rule) => ({ ...rule })) }));
}

/** 按名称取 schema；未知抛 SchemaValidatorError */
export function schemaByName(name: SchemaName): DeclaredSchema {
  const found = SCHEMAS.find((s) => s.name === name);
  if (found === undefined) {
    throw new SchemaValidatorError(`未知 schema：${name}`);
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SchemaLeaf {
  readonly value: unknown;
  readonly present: boolean;
  readonly label: string;
}

/** 按路径分段解析：'patches[].id' → ['patches','[]','id'] */
function tokenizePath(path: string): readonly string[] {
  const tokens: string[] = [];
  const re = /\[\]|[^.\[\]]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

function visit(node: unknown, tokens: readonly string[], label: string): SchemaLeaf[] {
  if (tokens.length === 0) {
    return [{ value: node, present: node !== undefined, label }];
  }
  const [head, ...rest] = tokens;
  if (head === '[]') {
    if (!Array.isArray(node)) {
      return [{ value: undefined, present: false, label: `${label}[]` }];
    }
    return node.flatMap((item, index) => visit(item, rest, `${label}[${index}]`));
  }
  if (!isRecord(node)) {
    return [{ value: undefined, present: false, label: label === '' ? head : `${label}.${head}` }];
  }
  return visit(node[head], rest, label === '' ? head : `${label}.${head}`);
}

function typeMatches(value: unknown, type: SchemaValueType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'stringArray':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    case 'objectArray':
      return Array.isArray(value) && value.every(isRecord);
    case 'object':
      return isRecord(value);
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) && (value as number) >= 0;
    case 'boolean':
      return typeof value === 'boolean';
  }
}

function typeNameOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/** 校验 unknown 值是否符合声明式 schema */
export function validateSchema(value: unknown, schema: DeclaredSchema): SchemaOutcome {
  const issues: string[] = [];
  for (const rule of schema.rules) {
    const leaves = visit(value, tokenizePath(rule.path), '');
    if (rule.required) {
      const missing = leaves.filter((leaf) => !leaf.present || leaf.value === undefined);
      if (missing.length > 0) {
        issues.push(`${schema.name} 缺少必填字段 ${missing[0].label}`);
        continue;
      }
    }
    for (const leaf of leaves) {
      if (!leaf.present || leaf.value === undefined) {
        continue;
      }
      if (!typeMatches(leaf.value, rule.type)) {
        issues.push(
          `${schema.name}.${leaf.label} 类型必须为 ${rule.type}（实际：${typeNameOf(leaf.value)}）`
        );
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

/** 强校验：非法即抛 SchemaValidatorError */
export function assertValidBySchema(value: unknown, name: SchemaName): void {
  const outcome = validateSchema(value, schemaByName(name));
  if (!outcome.valid) {
    throw new SchemaValidatorError(`${name} 校验失败：\n${outcome.issues.map((i) => `  - ${i}`).join('\n')}`);
  }
}

