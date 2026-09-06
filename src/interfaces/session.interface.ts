// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/interfaces/session.interface.ts
// 职责: 设计会话编排契约（无 any）。
//   - ProfileGenerator：可注入的配置生成 seam（默认 = generate-profile.tool；测试用 fake）
//   - DesignSessionOptions/Result：runDesignSession 的入参/产物（状态机端到端主线）
//   - SessionEvent：进度/检查点/恢复事件的只读流（供 UI/日志订阅）

import type { DesignContext, DesignStatus } from './design-context.interface';
import type { PatternComplexity } from './pattern.interface';
import type { ProfileConfig } from './config.interface';

/** 生成输入（来自设计上下文 + 组装好的 System Prompt） */
export interface ProfileGeneratorInput {
  readonly ctx: DesignContext;
  /** 组装后的 System Prompt（供 LLM seam / 审计；规则降级生成器可忽略） */
  readonly system_prompt?: string;
  /** 记忆提示（只读，来自 MemoryHub 召回） */
  readonly memory_hints?: readonly string[];
}

/** 配置生成器 seam */
export type ProfileGenerator = (input: ProfileGeneratorInput) => Promise<ProfileConfig>;

/** 会话结局分类 */
export type DesignSessionOutcome = 'delivered' | 'interrupted' | 'error';

/** 会话进度事件 */
export type SessionEvent =
  | {
      readonly kind: 'step';
      readonly session_id: string;
      readonly trace_id: string;
      readonly status: DesignStatus;
      readonly detail: string;
    }
  | {
      readonly kind: 'checkpoint';
      readonly session_id: string;
      readonly trace_id: string;
      readonly status: DesignStatus;
      readonly checkpoint_id: string;
      readonly detail: string;
    }
  | {
      readonly kind: 'resume';
      readonly session_id: string;
      readonly trace_id: string;
      readonly status: DesignStatus;
      readonly detail: string;
    }
  | {
      readonly kind: 'critic_round';
      readonly session_id: string;
      readonly trace_id: string;
      readonly status: DesignStatus;
      readonly retry_count: number;
      readonly detail: string;
    };

/** runDesignSession 选项 */
export interface DesignSessionOptions {
  /** 会话 id；提供且存在未完成检查点时自动 resume */
  readonly session_id?: string;
  /** 人工决策：interrupted 时 approve=放行交付 / reject=终断 */
  readonly human_decision?: 'approve' | 'reject';
  /** 最大步数（缺省取 runtime.max_steps） */
  readonly max_steps?: number;
  /** 进度订阅 */
  readonly on_event?: (event: SessionEvent) => void;
  /** 复杂度覆盖（测试/人工指定，缺省由分析器判定） */
  readonly complexity_override?: PatternComplexity;
}

/** runDesignSession 结果 */
export interface DesignSessionResult {
  readonly session_id: string;
  readonly trace_id: string;
  readonly status: DesignStatus;
  readonly outcome: DesignSessionOutcome;
  readonly ctx: DesignContext;
  readonly steps_used: number;
  /** 是否为断点续跑 */
  readonly resumed: boolean;
  /** 最终检查点 id（有检查点存储时） */
  readonly final_checkpoint_id?: string;
}
