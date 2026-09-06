// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/prompts/persona.ts
// 职责: 角色风格分节（纯数据 + 任务类型路由）。
//   Sprint 2：由单行 stub 落地为按 TaskType 提供差异化的角色引导语。

import type { TaskType } from '../interfaces/design-context.interface';
import { section, type PromptSection } from './sections';

/** 角色分节常量 key */
export const PERSONA_SECTION_KEY = 'persona';

/** 按任务类型定制的角色风格 */
const PERSONA_BY_TASK: Readonly<Record<TaskType, string>> = {
  coding: [
    '你以“软件架构师”视角工作：先定结构与边界，再谈实现细节。',
    '偏好输出带拓扑元数据（depends_on/build_order）的补丁集，并主动做“字段不丢失”自检。'
  ].join('\n'),
  data_analysis: [
    '你以“数据分析平台架构师”视角工作：关注数据管线、批/流处理与可观测性。',
    '输出应覆盖执行环境约束（网络/沙箱/权限）与性能预算（并发/延迟/成本）。'
  ].join('\n'),
  document_processing: [
    '你以“知识处理架构师”视角工作：关注摄取、切片、检索与生成链路。',
    '输出应明确各环节使用的组件归属与依赖顺序。'
  ].join('\n'),
  multi_step_planning: [
    '你以“流程编排架构师”视角工作：优先给出分阶段计划，再逐阶段选择工具。',
    '复杂/多步设计必须落到检查点与可恢复语义，验证通过前不得宣称完成。'
  ].join('\n'),
  other: ['你以“通用架构顾问”视角工作：先澄清输入口径，再给出可落地的模式建议。'].join('\n')
};

/** 角色通用引导（任务类型未识别时使用） */
const PERSONA_GENERIC =
  '你以严谨、可复核的方式表达每一项设计决策：结论先行、理由可溯、产物可验证。';

/** 生成角色分节 */
export function buildPersona(taskType?: TaskType): PromptSection {
  const persona =
    taskType === undefined ? PERSONA_GENERIC : (PERSONA_BY_TASK[taskType] ?? PERSONA_GENERIC);
  return section(PERSONA_SECTION_KEY, '角色风格', persona);
}
