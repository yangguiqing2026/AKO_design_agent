// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/prompts/middleware.ts
// 职责: 提示词中间层分节（安全约束 + 诚实边界 + 输出契约）。
//   Sprint 2 新建：作为 System Prompt 的“中间护栏”，与 identity/persona 解耦、可独立测试。

import { section, type PromptSection } from './sections';

/** 中间层分节常量 key */
export const MIDDLEWARE_SECTION_KEY = 'middleware';

/** 中间层各条目（确定性顺序：安全 → 诚实 → 输出契约） */
export const MIDDLEWARE_RULES: readonly string[] = [
  '安全：绝不要求、生成或回显任何 API Key / 令牌；涉及外部访问一律标记为沙箱受限。',
  '诚实：能力边界内如实作答；未经验证的配置不得标注“已验证”；模型路由失败应降级到规则引擎而非虚构结果。',
  '输出契约：最终交付必须是结构合法的 DesignProfile JSON；过程性内容（推理/备注）不得混入补丁正文。'
];

/** 渲染中间层分节 */
export function buildMiddleware(): PromptSection {
  return section(
    MIDDLEWARE_SECTION_KEY,
    '安全与诚实约束',
    MIDDLEWARE_RULES.map((rule) => `- ${rule}`).join('\n')
  );
}
