// AKO_studio - Design Agent v1.0.1
// 文件名: src/modules/config-generator/patch-builder.ts
// 职责: Patch 构建器（v1.0.1 修正：整行替换语义，非 deep-merge）。
//   - 整行替换：patch.config 各键整体替换基础配置同键值（不再递归深合并），
//     因此生成器必须输出“完整行”以配合 assertAdditive 不丢字段
//   - 幂等：同一 base 连续应用同一 patch 结果不变
//   - 拓扑：meta.depends_on 驱动 sortPatchesTopologically / annotateBuildOrder
//   - 不丢失字段：提供断言辅助（缺失字段列表）

import type { CordisPatch, DesignProfile } from '../../interfaces/config.interface';
import type { PatchMeta } from '../../interfaces/patch.interface';

/** Patch 构建错误 */
export class PatchBuildError extends Error {
  readonly code = 'PATCH_BUILD_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PatchBuildError';
  }
}

/** 依赖成环：拓扑排序不可解析（修正 3 专用错误） */
export class CircularDependencyError extends Error {
  readonly code = 'PATCH_CIRCULAR_DEPENDENCY';

  constructor(message: string) {
    super(message);
    this.name = 'CircularDependencyError';
  }
}

export interface PatchDraft {
  readonly id: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly insert?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** v1.0.1 新增：拓扑元数据 */
  readonly meta?: PatchMeta;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = cloneValue(val);
    }
    return out;
  }
  return value;
}

/** 创建一个规范化 Patch（拷贝输入，避免外部可变对象污染产物） */
export function createPatch(draft: PatchDraft): CordisPatch {
  if (draft.id.trim().length === 0) {
    throw new PatchBuildError('Patch id 不能为空');
  }
  const built: CordisPatch = {
    id: draft.id.trim(),
    ...(draft.config !== undefined
      ? { config: cloneValue(draft.config) as Record<string, unknown> }
      : {}),
    ...(draft.insert !== undefined && draft.insert.length > 0
      ? { insert: draft.insert.map((item) => cloneValue(item) as Record<string, unknown>) }
      : {}),
    ...(draft.meta !== undefined
      ? {
          meta: {
            depends_on: [...draft.meta.depends_on],
            ...(draft.meta.build_order !== undefined ? { build_order: draft.meta.build_order } : {})
          } satisfies PatchMeta
        }
      : {})
  };
  return built;
}

/**
 * 整行替换合并（v1.0.1 修正：非 deep-merge）。
 * override 的每个键【整体替换】base 中同键的值（对象子树不递归合并），
 * 未被 override 覆盖的 base 键原样保留（按值拷贝）。返回新对象，不修改入参。
 */
export function mergeReplacing(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(override)])) {
    const baseValue = base[key];
    const overrideValue = override[key];
    if (overrideValue === undefined) {
      if (baseValue !== undefined) {
        result[key] = cloneValue(baseValue);
      }
      continue;
    }
    result[key] = cloneValue(overrideValue);
  }
  return result;
}

/** 将单个 Patch 应用到基础配置（整行替换；无 config 时等价克隆） */
export function applyPatchConfig(
  baseConfig: Readonly<Record<string, unknown>>,
  patch: CordisPatch
): Record<string, unknown> {
  return patch.config === undefined
    ? (cloneValue(baseConfig) as Record<string, unknown>)
    : mergeReplacing(baseConfig, patch.config);
}

/** 依次应用一组 patch（建议按拓扑序；同顺序重复应用结果幂等） */
export function applyPatchSet(
  baseConfig: Readonly<Record<string, unknown>>,
  patches: readonly CordisPatch[]
): Record<string, unknown> {
  return patches.reduce(
    (acc, patch) => applyPatchConfig(acc, patch),
    cloneValue(baseConfig) as Record<string, unknown>
  );
}

/**
 * 拓扑排序（v1.0.1）：依据 meta.depends_on 稳定地重排 patch。
 * - 仅处理集合内部的依赖边；指向集合外组件 ID 的依赖视为已满足（由外部目录提供）
 * - 集合内依赖成环 → 抛 CircularDependencyError（构建顺序不可解析）
 */
export function sortPatchesTopologically(patches: readonly CordisPatch[]): CordisPatch[] {
  const byId = new Map(patches.map((patch) => [patch.id, patch]));
  const internalIds = new Set(byId.keys());
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: CordisPatch[] = [];

  const visit = (patch: CordisPatch): void => {
    if (visited.has(patch.id)) {
      return;
    }
    if (visiting.has(patch.id)) {
      throw new CircularDependencyError(`Patch 依赖存在环：${patch.id}`);
    }
    visiting.add(patch.id);
    for (const dep of patch.meta?.depends_on ?? []) {
      if (!internalIds.has(dep)) {
        continue; // 外部依赖由组件目录保证
      }
      const depPatch = byId.get(dep);
      if (depPatch !== undefined) {
        visit(depPatch);
      }
    }
    visiting.delete(patch.id);
    visited.add(patch.id);
    ordered.push(patch);
  };

  for (const patch of patches) {
    visit(patch);
  }
  return ordered;
}

/** 按拓扑序注解 build_order（0 起），返回新的 patch 数组（不修改入参） */
export function annotateBuildOrder(patches: readonly CordisPatch[]): CordisPatch[] {
  return sortPatchesTopologically(patches).map((patch, index) =>
    createPatch({
      id: patch.id,
      config: patch.config,
      insert: patch.insert,
      meta: { depends_on: patch.meta?.depends_on ?? [], build_order: index }
    })
  );
}

/** 校验 profile 内 patch id 唯一性，返回重复 id 列表 */
export function findDuplicatePatchIds(patches: readonly CordisPatch[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const patch of patches) {
    if (seen.has(patch.id)) {
      duplicates.add(patch.id);
    }
    seen.add(patch.id);
  }
  return [...duplicates];
}

/** 深路径展开：{a:{b:1}} → ['a.b'] */
export function deepKeysOf(obj: Readonly<Record<string, unknown>>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    keys.push(path);
    if (isPlainRecord(value)) {
      keys.push(...deepKeysOf(value, path));
    }
  }
  return keys;
}

function valueAtPath(obj: Readonly<Record<string, unknown>>, path: string): unknown {
  let cursor: unknown = obj;
  for (const segment of path.split('.')) {
    if (!isPlainRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

/** 返回 merged 相对 original 丢失的字段路径（空数组 = 无字段丢失） */
export function missingFields(
  original: Readonly<Record<string, unknown>>,
  merged: Readonly<Record<string, unknown>>
): string[] {
  return deepKeysOf(original).filter((path) => valueAtPath(merged, path) === undefined);
}

/** 构造 DesignProfile 便捷函数（原子交付单元） */
export function buildProfile(profile: {
  readonly name: string;
  readonly description?: string;
  readonly bundles: readonly string[];
  readonly patches: readonly CordisPatch[];
}): DesignProfile {
  const duplicates = findDuplicatePatchIds(profile.patches);
  if (duplicates.length > 0) {
    throw new PatchBuildError(`Patch id 重复：${duplicates.join(', ')}`);
  }
  if (profile.name.trim().length === 0) {
    throw new PatchBuildError('Profile name 不能为空');
  }
  return {
    name: profile.name.trim(),
    ...(profile.description !== undefined ? { description: profile.description } : {}),
    bundles: [...profile.bundles],
    patches: profile.patches.map((patch) =>
      createPatch({
        id: patch.id,
        config: patch.config,
        insert: patch.insert,
        meta: patch.meta
      })
    )
  };
}
