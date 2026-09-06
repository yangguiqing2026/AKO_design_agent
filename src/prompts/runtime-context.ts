// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/prompts/runtime-context.ts
// 职责: 运行时上下文分节（trace_id / 时间 / 模型路由 / 复杂度上下文注入）。
//   Sprint 2：由单行 stub 落地为确定性运行时上下文渲染函数。

import type { PatternComplexity } from '../interfaces/pattern.interface';
import { section, type PromptSection } from './sections';

/** 运行时上下文分节常量 key */
export const RUNTIME_CONTEXT_SECTION_KEY = 'runtime-context';

/** 运行时上下文输入 */
export interface RuntimeContextInput {
  readonly trace_id: string;
  /** 当前时间（ISO）；不传则使用 new Date().toISOString() */
  readonly now?: string;
  /** 模型路由（来自 config/llm.backends.yml 的解析结果） */
  readonly model_route?: string;
  /** 复杂度上下文（来自需求分析节点） */
  readonly complexity?: PatternComplexity;
}

/** 渲染运行时上下文分节 */
export function buildRuntimeContext(input: RuntimeContextInput): PromptSection {
  const assembledAt = input.now ?? new Date().toISOString();
  const lines = [
    `trace_id: ${input.trace_id}`,
    `时间: ${assembledAt}`,
    `模型路由: ${input.model_route ?? 'default'}`
  ];
  if (input.complexity !== undefined) {
    lines.push(`需求复杂度判定: ${input.complexity}`);
  }
  lines.push('以上上下文仅用于本次调用的审计与路由，禁止出现在交付产物内容中。');
  return section(RUNTIME_CONTEXT_SECTION_KEY, '运行时上下文', lines.join('\n'));
}
