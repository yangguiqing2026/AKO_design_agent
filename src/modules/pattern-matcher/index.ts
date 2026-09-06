// AKO_studio - Design Agent v1.0.0
// 文件名: src/modules/pattern-matcher/index.ts
// 职责: 架构模式匹配引擎（Sprint 1 P0）。
//   - 内建五类模式（ReAct / Plan-Execute / Reflection / Hierarchical / PTC）
//   - 基于 scoring.ts 对候选打分并排序；无强匹配时回退 ReAct（白皮书 §7 降级策略）
//   - 模式库可注入（内建或从 JSON 加载），关键词/复杂度来自需求分析结果

import type {
  ArchitecturePattern,
  PatternCandidateScore,
  PatternMatchResult,
  PatternComplexity
} from '../../interfaces/pattern.interface';
import type { StructuredRequirement, TaskType } from '../../interfaces/design-context.interface';

import { scorePattern, type PatternQuery } from './scoring';

export * from './scoring';

/** 内建模式库（对应 knowledge/patterns/* 的主题；字段满足 ArchitecturePattern） */
export const DEFAULT_PATTERNS: readonly ArchitecturePattern[] = [
  {
    id: 'react',
    name: 'ReAct',
    description: '推理-行动-观察循环，标准工具调用，适合通用问答与简单自动化',
    applicable_scenarios: ['标准工具调用', '问答', '通用助手', '简单自动化', '查询与检索'],
    harness_components: ['默认 Agent Loop', '工具注册', '单 Agent'],
    complexity: 'simple'
  },
  {
    id: 'plan-execute',
    name: 'Plan-Execute',
    description: '先规划后执行的计划-执行双阶段循环',
    applicable_scenarios: ['复杂多步任务', '分阶段执行', '端到端流程', '规划与执行', '流水线'],
    harness_components: ['自定义 Loop', '规划工具', '执行工具', '检查点'],
    complexity: 'medium'
  },
  {
    id: 'reflection',
    name: 'Reflection',
    description: '生成后自我评估与纠错的反思循环',
    applicable_scenarios: ['复杂推理', '自我纠错', '评估改进', '长难任务', '质量敏感'],
    harness_components: ['反思循环', '评估器', '重试策略'],
    complexity: 'medium'
  },
  {
    id: 'hierarchical',
    name: 'Hierarchical',
    description: '父 Agent 协调子 Agent 的层级多 Agent 架构',
    applicable_scenarios: ['多agent', '子agent委派', '层级组织', '任务分解', '团队协作'],
    harness_components: ['父 Agent', '子 Agent 工厂', '委派传输', '作用域隔离'],
    complexity: 'complex'
  },
  {
    id: 'ptc',
    name: 'Plan-then-Code',
    description: '面向软件开发的计划先行-编码执行模式',
    applicable_scenarios: ['写代码规划', '计划先行编码', '编码实现', '软件开发任务'],
    harness_components: ['自定义 Loop', '代码工具', '静态检查', '沙箱模拟'],
    complexity: 'medium'
  }
];

/** 任务类型 → 代表性意图词（用于从结构化需求构造查询） */
const TASK_SYNONYMS: Readonly<Record<TaskType, readonly string[]>> = {
  coding: ['代码', '开发', '编程', '实现', '脚本', '工具调用', 'agent'],
  data_analysis: ['数据分析', '报表', '可视化', '统计', '数据集'],
  document_processing: ['文档', '总结', '翻译', '报告', '提取'],
  multi_step_planning: ['多步', '编排', '端到端', '规划', '流水线'],
  other: []
};

export interface PatternMatcherOptions {
  readonly patterns?: readonly ArchitecturePattern[];
  readonly fallbackPatternId?: string;
  readonly minMatchScore?: number;
  /** Sprint 2：自学习权重表（pattern_id → 权重 [0.5,2.0]），消费于 scorePattern */
  readonly weightMap?: Readonly<Record<string, number>>;
}

export class PatternMatcher {
  private readonly patterns: readonly ArchitecturePattern[];
  private readonly fallbackId: string;
  private readonly minScore: number;
  private readonly weightMap: Readonly<Record<string, number>>;

  constructor(options: PatternMatcherOptions = {}) {
    this.patterns = options.patterns ?? DEFAULT_PATTERNS;
    this.fallbackId = options.fallbackPatternId ?? 'react';
    this.minScore = options.minMatchScore ?? 12;
    this.weightMap = options.weightMap ?? {};
  }

  /** 读取模式的生效权重：显式权重表 > 模式自带 weight > 1.0 */
  weightOf(pattern: ArchitecturePattern): number {
    const fromMap = this.weightMap[pattern.id];
    return fromMap !== undefined ? fromMap : (pattern.weight ?? 1);
  }

  /** 直接从结构化需求匹配（关键词 = 任务类型同义词 + 附加说明词） */
  matchStructured(
    structured: StructuredRequirement,
    complexity?: PatternComplexity
  ): PatternMatchResult {
    const synonyms = TASK_SYNONYMS[structured.task_type] ?? [];
    const notes = structured.additional_notes ?? '';
    const noteWords = notes
      .split(/[\s,，。;；、/]+/)
      .map((token) => token.trim())
      .filter((token) => (isAsciiWord(token) ? token.length >= 3 : token.length >= 2));
    return this.match({ keywords: [...synonyms, ...noteWords], complexity });
  }

  match(query: PatternQuery): PatternMatchResult {
    if (query.keywords.length === 0 && query.complexity === undefined) {
      return this.fallbackResult([]);
    }
    const candidates = this.patterns
      .map((pattern) => scorePattern(pattern, query, {}, this.weightOf(pattern)))
      .sort((a, b) => b.score - a.score || a.pattern_id.localeCompare(b.pattern_id));

    const best = candidates[0];
    if (best !== undefined && best.score >= this.minScore) {
      return {
        candidates,
        selected_pattern: this.patternById(best.pattern_id),
        fallback_used: false
      };
    }
    return this.fallbackResult(candidates);
  }

  /** 按模式 id 查找模式（不存在返回 undefined） */
  patternById(id: string): ArchitecturePattern | undefined {
    return this.patterns.find((pattern) => pattern.id === id);
  }

  private fallbackResult(candidates: readonly PatternCandidateScore[]): PatternMatchResult {
    const fallback = this.patternById(this.fallbackId);
    if (fallback !== undefined) {
      return {
        candidates,
        selected_pattern: fallback,
        fallback_used: true
      };
    }
    return { candidates, fallback_used: false };
  }

}

function isAsciiWord(token: string): boolean {
  return /^[A-Za-z]/.test(token);
}
