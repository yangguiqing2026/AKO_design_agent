// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/tools/query-patterns.tool.ts
// 职责: 架构模式检索/匹配工具（基于 pattern-matcher，结构化 JSON 输出）。
//   Sprint 2：由单行 stub 落地——供未来 LLM/loop 以工具形式调用；同时输出工具定义。

import type { PatternComplexity } from '../interfaces/pattern.interface';
import type { PatternMatchResult } from '../interfaces/pattern.interface';
import type { StructuredRequirement } from '../interfaces/design-context.interface';
import type { PatternMatcher } from '../modules/pattern-matcher';

/** 工具查询输入 */
export interface QueryPatternsInput {
  readonly structured?: StructuredRequirement;
  readonly keywords?: readonly string[];
  readonly complexity?: PatternComplexity;
}

/** 工具查询输出（确定性、可序列化） */
export interface QueryPatternsOutput {
  readonly tool: 'query_patterns';
  readonly selected_pattern_id?: string;
  readonly fallback_used: boolean;
  readonly candidates: readonly { readonly pattern_id: string; readonly score: number }[];
  readonly generated_at: string;
}

/** 工具注册定义（供未来 DSH 工具注册表使用） */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/** 查询模式库工具 */
export class QueryPatternsTool {
  private readonly matcher: PatternMatcher;
  private readonly nowProvider: () => string;

  constructor(matcher: PatternMatcher, now?: () => string) {
    this.matcher = matcher;
    this.nowProvider = now ?? ((): string => new Date().toISOString());
  }

  query(input: QueryPatternsInput): QueryPatternsOutput {
    let match: PatternMatchResult;
    if (input.structured !== undefined) {
      match = this.matcher.matchStructured(input.structured, input.complexity);
    } else {
      match = this.matcher.match({
        keywords: input.keywords ?? [],
        complexity: input.complexity
      });
    }
    return {
      tool: 'query_patterns',
      ...(match.selected_pattern !== undefined ? { selected_pattern_id: match.selected_pattern.id } : {}),
      fallback_used: match.fallback_used,
      candidates: match.candidates.map((candidate) => ({
        pattern_id: candidate.pattern_id,
        score: candidate.score
      })),
      generated_at: this.nowProvider()
    };
  }

  /** 工具定义（注册到运行环境时使用） */
  define(): ToolDefinition {
    return {
      name: 'query_patterns',
      description: '查询架构模式库：按结构化需求或关键词返回模式匹配结果与候选得分',
      input_schema: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' } },
          complexity: { type: 'string', enum: ['simple', 'medium', 'complex'] }
        }
      }
    };
  }
}
