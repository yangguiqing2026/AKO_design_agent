// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/modules/session-manager/session-manager.ts
// 职责: 设计会话生命周期管理（包 DesignContext）。
//   - create：工厂创建初始上下文
//   - resume：按 session_id 取最新检查点还原（含 retry_count/complexity/generated_profile）
//   - checkpoint：状态推进前保存快照（label 标注阶段）
//   - 供 session-orchestrator 以“保存-推进-保存”节奏串行驱动状态机

import type { DesignCheckpoint, ICheckpointStore } from '../../interfaces/checkpoint.interface';
import type { DesignContext, DesignStatus } from '../../interfaces/design-context.interface';
import { createDesignContext } from '../../interfaces/design-context.interface';
import { nextStatus } from '../../core/agent-loop';

export interface SessionManagerOptions {
  readonly logger?: {
    readonly warn: (message: string, data?: unknown) => void;
    readonly info: (message: string, data?: unknown) => void;
  };
}

/** 会话生命周期管理（实现层薄封装 + 恢复语义） */
export class SessionManager {
  private readonly store: ICheckpointStore;
  private readonly logger: SessionManagerOptions['logger'];

  constructor(store: ICheckpointStore, options: SessionManagerOptions = {}) {
    this.store = store;
    this.logger = options.logger;
  }

  /** 创建新会话初始上下文（status=idle） */
  create(sessionId: string, userPrompt: string): DesignContext {
    const ctx = createDesignContext({ session_id: sessionId, user_prompt: userPrompt });
    this.logger?.info(`会话创建：${sessionId}`, { trace_id: ctx.trace_id });
    return ctx;
  }

  /**
   * 按 session_id 恢复最新检查点。
   * 若最新检查点已是 completed，视为无未完成任务返回 null（幂等不重放）。
   */
  resume(sessionId: string): DesignContext | null {
    const latest = this.store.latest(sessionId);
    if (latest === null) {
      return null;
    }
    if (latest.ctx.status === 'completed') {
      this.logger?.warn(`会话 ${sessionId} 已完成，不重复续跑`);
      return null;
    }
    this.logger?.info(`会话恢复：${sessionId} @ ${latest.ctx.status}（检查点 ${latest.checkpoint_id}）`);
    return latest.ctx;
  }

  /** 保存检查点（状态推进前调用），返回落库检查点 */
  checkpoint(ctx: DesignContext, label: string): DesignCheckpoint {
    const saved = this.store.save(ctx, label);
    this.logger?.info(`检查点已保存：${saved.checkpoint_id}（${label}）`, {
      session_id: ctx.session_id,
      status: ctx.status
    });
    return saved;
  }

  /** 静态推进到下一状态（复用 agent-loop 状态机判路） */
  next(ctx: DesignContext): DesignStatus | null {
    return nextStatus(ctx);
  }

  /** 该会话最近一次检查点状态 */
  latestStatus(sessionId: string): DesignStatus | null {
    const latest = this.store.latest(sessionId);
    return latest === null ? null : latest.status;
  }

  /** 清除会话检查点（会话终结后的归档/重置） */
  reset(sessionId: string): void {
    this.store.removeSession(sessionId);
  }
}
