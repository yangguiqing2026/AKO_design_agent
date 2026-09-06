// AKO_studio - Design Agent v1.0.0
// 文件名: src/interfaces/pattern.interface.ts
// 职责: 架构模式知识库与匹配结果的类型化契约（无 any）

import type { DesignProfile } from './config.interface';

/** 模式复杂度 */
export type PatternComplexity = 'simple' | 'medium' | 'complex';

/** 架构模式（对应 knowledge/patterns/*） */
export interface ArchitecturePattern {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly applicable_scenarios: readonly string[];
  readonly harness_components: readonly string[];
  readonly config_template?: DesignProfile;
  readonly complexity: PatternComplexity;
  readonly weight?: number;            // 自学习权重（维度V）
}

/** 单条匹配评分 */
export interface PatternCandidateScore {
  readonly pattern_id: string;
  readonly score: number;              // 0-100
  readonly matched_keywords: readonly string[];
}

/** 模式匹配输出 */
export interface PatternMatchResult {
  readonly candidates: readonly PatternCandidateScore[];
  readonly selected_pattern?: ArchitecturePattern;
  readonly fallback_used: boolean;
}
