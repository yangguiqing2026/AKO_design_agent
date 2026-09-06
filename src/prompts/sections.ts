// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/prompts/sections.ts
// 职责: Prompt 分节的共享类型与工厂（无 any 纯数据）。
//   - PromptSection：{ key, title, text } 确定性分节单元
//   - 各 prompts/* 模块只产出分节数据，组装/去重/排序收敛在 PromptAssembler

/** Prompt 分节（key 用于去重；title 用于排版与测试断言顺序） */
export interface PromptSection {
  readonly key: string;
  readonly title: string;
  readonly text: string;
}

/** 分节工厂：key 必须唯一且非空 */
export function section(key: string, title: string, text: string): PromptSection {
  const trimmedKey = key.trim();
  if (trimmedKey.length === 0) {
    throw new Error('Prompt 分节 key 不能为空');
  }
  if (title.trim().length === 0) {
    throw new Error(`Prompt 分节 ${trimmedKey} 的 title 不能为空`);
  }
  return { key: trimmedKey, title: title.trim(), text };
}
