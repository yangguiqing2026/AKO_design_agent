// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/interfaces/memory.interface.ts
// 职责: 三级记忆体系契约（FI-II-04/FI-V-04，无 any）。
//   - short_term ：进程内会话窗口（受 max_steps 约束，超窗淘汰）
//   - long_term  ：用户偏好 / 最佳实践（知识文件加载 + 可追加持久化）
//   - episodic   ：会话情景记忆（与 learning 案例库呼应，此处为轻量检索索引）

/** 记忆层级 */
export type MemoryKind = 'short_term' | 'long_term' | 'episodic';

/** 记忆作用域 */
export type MemoryScope = 'session' | 'global';

/** 单条记忆 */
export interface MemoryEntry {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly session_id: string;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly created_at: number;
}

/** 写入记忆的输入（id / created_at 由实现生成） */
export interface NewMemoryEntry {
  readonly kind: MemoryKind;
  readonly session_id: string;
  readonly scope?: MemoryScope;
  readonly content: string;
  readonly tags?: readonly string[];
}

/** 读取 / 召回选项 */
export interface MemoryQueryOptions {
  readonly limit?: number;
  readonly min_score?: number;
  /** 限定会话（缺省全量） */
  readonly session_id?: string;
}

/** 单条召回命中（含分数） */
export interface MemoryRecallHit {
  readonly entry: MemoryEntry;
  readonly score: number;
}

/** 记忆中枢接口 */
export interface IMemoryHub {
  /** 写入一条记忆（返回带 id / created_at 的落库条目） */
  write(entry: NewMemoryEntry): MemoryEntry;
  /** 按层级读取（缺省按创建时间倒序） */
  read(kind: MemoryKind, options?: MemoryQueryOptions): readonly MemoryEntry[];
  /** 关键词召回：确定性打分（命中内容/标签计分），降序返回 */
  recall(kind: MemoryKind, query: string, options?: MemoryQueryOptions): readonly MemoryRecallHit[];
  /** 清空某会话的进程内/情景记忆（长期全局记忆不受影响） */
  clearSession(sessionId: string): void;
}
