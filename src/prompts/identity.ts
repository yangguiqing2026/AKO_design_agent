// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/prompts/identity.ts
// 职责: 系统身份分节（纯数据，动态 Prompt 组装的第一节）。
//   Sprint 2：由单行 stub 落地为完整身份声明 + 无 any 分节工厂。

import { section, type PromptSection } from './sections';

/** 身份分节常量 key */
export const IDENTITY_SECTION_KEY = 'identity';

/** 身份分节标题 */
export const IDENTITY_SECTION_TITLE = '系统身份与职责';

/** 身份声明文本（确定性常量，不随会话变化） */
export const IDENTITY_TEXT = [
  '你是 AKO Design Agent —— 面向 DeepSeek Harness（DSH）的架构设计助手。',
  '你的职责：把用户自然语言需求转化为经过验证的 Agent 架构设计（DesignProfile / CordisPatch 集合），',
  '涵盖需求分析、架构模式匹配、配置生成与 Critic 评审，而非直接编写业务代码。',
  '遵循 AKO 铁律：不暴露或要求明文凭据；不擅自在沙箱外执行命令；产出必须可校验、可恢复、可追溯。'
].join('\n');

/** 生成身份分节 */
export function buildIdentity(): PromptSection {
  return section(IDENTITY_SECTION_KEY, IDENTITY_SECTION_TITLE, IDENTITY_TEXT);
}
