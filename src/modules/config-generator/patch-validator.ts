// AKO_studio - Design Agent v1.0.1
// 文件名: src/modules/config-generator/patch-validator.ts
// 职责: Patch 校验器（v1.0.1 修正）。
//   - 结构校验：id/config/insert/meta 字段形态
//   - Profile 校验：name/bundles/patches、patch id 唯一
//   - 语义校验（验收项）：Patch 应用后不丢失原配置字段。
//     Patch 采用整行替换语义，因此补丁必须携带被替换子树的“完整行”；本文件
//     通过深路径核对提示补丁作者遗漏字段（详见 missingFields / assertAdditive）。

import type { CordisPatch, DesignProfile } from '../../interfaces/config.interface';
import {
  applyPatchConfig,
  findDuplicatePatchIds,
  missingFields
} from './patch-builder';

/** Patch/Profile 校验失败 */
export class PatchValidationError extends Error {
  readonly code = 'PATCH_VALIDATION_FAILED';
  readonly issues: readonly string[];

  constructor(issues: readonly string[], message?: string) {
    super(message ?? `配置产物校验失败：\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'PatchValidationError';
    this.issues = issues;
  }
}

export interface ValidationOutcome {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): boolean {
  return Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 校验单个 patch 的结构（对 unknown 输入安全） */
export function validatePatch(value: unknown): ValidationOutcome {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, issues: ['patch 必须是对象'] };
  }
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    issues.push('patch.id 必须是非空字符串');
  }
  if (value.config !== undefined && !isRecord(value.config)) {
    issues.push('patch.config 必须是对象');
  }
  if (value.insert !== undefined && !isRecordArray(value.insert)) {
    issues.push('patch.insert 必须是数组');
  }
  if (Array.isArray(value.insert)) {
    const bad = value.insert.filter((item) => !isRecord(item)).length;
    if (bad > 0) {
      issues.push(`patch.insert 内含 ${bad} 个非对象元素`);
    }
  }
  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) {
      issues.push('patch.meta 必须是对象');
    } else {
      const meta = value.meta;
      if (meta.depends_on !== undefined && !isStringArray(meta.depends_on)) {
        issues.push('patch.meta.depends_on 必须是字符串数组');
      }
      if (
        meta.build_order !== undefined &&
        (typeof meta.build_order !== 'number' || !Number.isInteger(meta.build_order) || meta.build_order < 0)
      ) {
        issues.push('patch.meta.build_order 必须是非负整数');
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

/** 校验 profile（profile 必须是完整对象，字段类型逐一检查） */
export function validateProfile(value: unknown): ValidationOutcome {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, issues: ['profile 必须是对象'] };
  }
  if (typeof value.name !== 'string' || value.name.trim().length === 0) {
    issues.push('profile.name 必须是非空字符串');
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    issues.push('profile.description 必须是字符串');
  }
  if (!isStringArray(value.bundles)) {
    issues.push('profile.bundles 必须是字符串数组');
  }
  if (!Array.isArray(value.patches)) {
    issues.push('profile.patches 必须是数组');
    return { valid: false, issues };
  }
  const patchIds = new Set<string>();
  for (const [index, patch] of value.patches.entries()) {
    const result = validatePatch(patch);
    for (const issue of result.issues) {
      issues.push(`patches[${index}].${issue}`);
    }
    if (isRecord(patch) && typeof patch.id === 'string') {
      if (patchIds.has(patch.id)) {
        issues.push(`patches[${index}] id 重复：${patch.id}`);
      }
      patchIds.add(patch.id);
    }
  }
  return { valid: issues.length === 0, issues };
}

/** 强校验：不合法即抛 PatchValidationError */
export function assertValidProfile(profile: unknown): asserts profile is DesignProfile {
  const outcome = validateProfile(profile);
  if (!outcome.valid) {
    throw new PatchValidationError(outcome.issues);
  }
}

/** 断言补丁集不丢失原始配置字段（additive 契约，白皮书验收 10.1） */
export function assertAdditive(
  originalConfig: Readonly<Record<string, unknown>>,
  patches: readonly CordisPatch[]
): void {
  const merged = patches.reduce(
    (acc, patch) => applyPatchConfig(acc, patch),
    originalConfig
  );
  const lost = missingFields(originalConfig, merged);
  if (lost.length > 0) {
    throw new PatchValidationError(
      lost.map((field) => `字段丢失：${field}`),
      'Patch 应用导致原配置字段丢失'
    );
  }
}

/** 便捷：供测试使用的字段丢失列表 */
export function additiveLossFields(
  originalConfig: Readonly<Record<string, unknown>>,
  patches: readonly CordisPatch[]
): string[] {
  const merged = patches.reduce(
    (acc, patch) => applyPatchConfig(acc, patch),
    originalConfig
  );
  return missingFields(originalConfig, merged);
}

/** 便捷：供测试使用的重复 id 列表 */
export function duplicatePatchIds(profile: DesignProfile): string[] {
  return findDuplicatePatchIds(profile.patches);
}

