// AKO_studio - Design Agent v1.0.1
// 文件名: src/interfaces/config.interface.ts
// 职责: 生成产物的配置结构（Profile / Bundle / Patch），全部为可 JSON 序列化类型（无 any）
//
// v1.0.1：CordisPatch 定义迁移至 ./patch.interface（新增拓扑元数据），此处 re-export 保持兼容。

import type { CordisPatch } from './patch.interface';

export type { CordisPatch };

/** 生成的 DSH Profile 配置（原子交付单元） */
export interface DesignProfile {
  readonly name: string;
  readonly description?: string;
  readonly bundles: readonly string[];
  readonly patches: readonly CordisPatch[];
}

/**
 * v1.0.1 兼容名：与白皮书 §5.2 接口契约（ProfileConfig）对齐。
 * 等价于 DesignProfile，供 critic/config-generator 等按规格命名消费。
 */
export type ProfileConfig = DesignProfile;

/** 配置产物片段类型 */
export type ConfigFragmentKind = 'profile' | 'bundle' | 'patch';
