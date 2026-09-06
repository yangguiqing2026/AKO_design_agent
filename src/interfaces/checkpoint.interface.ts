// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/interfaces/checkpoint.interface.ts
// 职责: 检查点（Checkpoint）契约（FI-II-06 有据化，无 any）。
//   DesignCheckpoint 保存 DesignContext 全量快照（含 retry_count / complexity /
//   generated_profile / validation_errors / trace / session），支持断点续跑。

import type { DesignContext, DesignStatus } from './design-context.interface';

/** 检查点（JSON 可序列化快照） */
export interface DesignCheckpoint {
  readonly checkpoint_id: string;
  readonly session_id: string;
  /** 会话内序号（随保存单调递增，用于排序回放） */
  readonly seq: number;
  /** 保存时上下文状态 */
  readonly status: DesignStatus;
  /** 检查点标签（如 generating / validating->generate），便于人工审计 */
  readonly label: string;
  /** 设计上下文全量快照 */
  readonly ctx: DesignContext;
  readonly created_at: number;
}

/** 检查点存储接口（同步语义，原子落盘；list/latest/resume 供会话恢复） */
export interface ICheckpointStore {
  /** 保存上下文快照并返回检查点 */
  save(ctx: DesignContext, label: string): DesignCheckpoint;
  /** 按 checkpoint_id 加载；不存在或损坏返回 null */
  load(checkpointId: string): DesignCheckpoint | null;
  /** 某会话最新检查点（按 seq/created_at 判定） */
  latest(sessionId: string): DesignCheckpoint | null;
  /** 某会话全部检查点（按 seq 升序） */
  list(sessionId: string): readonly DesignCheckpoint[];
  /** 删除某会话全部检查点 */
  removeSession(sessionId: string): void;
}
