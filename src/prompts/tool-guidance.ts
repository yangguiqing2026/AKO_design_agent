// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/prompts/tool-guidance.ts
// 职责: 工具使用引导分节（工具清单 + 使用纪律）。
//   Sprint 2 新建：工具集合与组装体系对齐（query-patterns / generate-profile / simulate-run）。

import { section, type PromptSection } from './sections';

/** 工具引导分节常量 key */
export const TOOL_GUIDANCE_SECTION_KEY = 'tool-guidance';

/** 已注册工具说明 */
export interface ToolGuidanceEntry {
  readonly name: string;
  readonly purpose: string;
  readonly guidance: string;
}

/** 当前注册工具集（与 src/tools/* 对齐；未来接 LLM/loop 前保持只读注册表） */
export const REGISTERED_TOOLS: readonly ToolGuidanceEntry[] = [
  {
    name: 'query_patterns',
    purpose: '按需求关键词/复杂度检索架构模式并返回结构化匹配结果',
    guidance: '生成配置文件前应调用一次，把 selected_pattern_id 写入设计上下文。'
  },
  {
    name: 'generate_profile',
    purpose: '消费 PromptAssembler 与组件目录产出 DesignProfile（含拓扑 meta）',
    guidance: '只调用一次并交给 Critic 校验；修改通过整行替换语义表达，禁止静默深合并。'
  },
  {
    name: 'simulate_run',
    purpose: '在沙箱中做 Profile 静态自检（结构校验 + 注入扫描）',
    guidance: '输出中任何 high/critical 发现都必须修复后重跑，不得在报告中忽略。'
  }
];

/** 渲染工具引导分节 */
export function buildToolGuidance(): PromptSection {
  const lines = [
    '可用工具（仅以下工具可被调用）：',
    ...REGISTERED_TOOLS.map((tool) => `- ${tool.name}：${tool.purpose}。纪律：${tool.guidance}`),
    '禁止编造未注册工具名；工具调用失败应如实上报错误码而非猜测原因。'
  ];
  return section(TOOL_GUIDANCE_SECTION_KEY, '工具使用引导', lines.join('\n'));
}
