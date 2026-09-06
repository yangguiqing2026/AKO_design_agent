// AKO_studio - Design Agent v1.0.0
// 文件名: src/modules/pattern-matcher/scoring.ts
// 职责: 模式匹配评分（确定性、可注入权重）。
//   评分维度：关键词命中 / 场景短语命中 / 复杂度适配（不匹配扣分）。

import type {
  ArchitecturePattern,
  PatternCandidateScore,
  PatternComplexity
} from '../../interfaces/pattern.interface';

/** 复杂度序：simple < medium < complex */
const COMPLEXITY_ORDER: Readonly<Record<PatternComplexity, number>> = {
  simple: 1,
  medium: 2,
  complex: 3
};

export interface PatternQuery {
  /** 来自需求分析的关键词/意图词 */
  readonly keywords: readonly string[];
  /** 期望复杂度（可选，来自需求复杂度判断） */
  readonly complexity?: PatternComplexity;
}

export interface ScoreWeights {
  readonly keywordHit?: number;        // 每个关键词命中加分
  readonly scenarioHit?: number;       // 每个适用场景短语命中加分
  readonly complexityMismatchPenalty?: number; // 复杂度每差一档扣分
}

const DEFAULT_WEIGHTS: Required<ScoreWeights> = {
  keywordHit: 18,
  scenarioHit: 10,
  complexityMismatchPenalty: 12
};

function normalizeText(value: string): string {
  return value.toLowerCase();
}

/**
 * Sprint 2：自学习权重加成（FI-V-01 落地）。
 * 权重缺省/越界归一为 [0.5, 2.0]（默认 1.0），乘性作用于原始得分：
 *   weighted = score × (0.5 + weight / 2)
 * weight=1 → 1.0 倍（原分不变）；weight=2 → 1.5 倍；weight=0.5 → 0.75 倍。
 * 输出保持 0–100 裁剪与整数舍入，确定性可复现。
 */
export function applyPatternWeight(score: number, weight: number | undefined): number {
  const w = weight === undefined ? 1 : Math.min(2, Math.max(0.5, weight));
  const weighted = score * (0.5 + w / 2);
  return Math.max(0, Math.min(100, Math.round(weighted)));
}

/**
 * 对单个模式评分（原始 0-100，随后乘性叠加自学习权重）。
 * 场景短语命中：需求侧关键词拼接后的文本包含模式适用场景短语即命中。
 * @param pattern 目标模式
 * @param query 需求侧关键词/复杂度
 * @param weights 评分维度权重（可注入）
 * @param learnedWeight Sprint 2：该模式的自学习权重（缺省 1.0，不改变原分）
 */
export function scorePattern(
  pattern: ArchitecturePattern,
  query: PatternQuery,
  weights: ScoreWeights = {},
  learnedWeight?: number
): PatternCandidateScore {
  const w: Required<ScoreWeights> = { ...DEFAULT_WEIGHTS, ...weights };
  const corpus = normalizeText(
    [pattern.id, pattern.name, pattern.description, ...pattern.applicable_scenarios].join(' ')
  );
  const queryText = normalizeText(query.keywords.join(' '));

  const matchedKeywords: string[] = [];
  for (const keyword of query.keywords) {
    const kw = normalizeText(keyword);
    if (kw.length > 0 && corpus.includes(kw)) {
      matchedKeywords.push(keyword);
    }
  }
  const scenarioHits = pattern.applicable_scenarios.filter((scenario) =>
    queryText.includes(normalizeText(scenario))
  ).length;

  let score = matchedKeywords.length * w.keywordHit + scenarioHits * w.scenarioHit;
  if (query.complexity !== undefined) {
    const expectedRank = COMPLEXITY_ORDER[query.complexity];
    const patternRank = COMPLEXITY_ORDER[pattern.complexity];
    const gap = Math.abs(expectedRank - patternRank);
    if (gap > 0) {
      score -= gap * w.complexityMismatchPenalty;
    } else {
      score += 4; // 复杂度吻合奖励
    }
  }

  return {
    pattern_id: pattern.id,
    score: applyPatternWeight(Math.max(0, Math.round(score)), learnedWeight),
    matched_keywords: matchedKeywords
  };
}
