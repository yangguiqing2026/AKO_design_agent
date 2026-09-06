// AKO_studio - Design Agent v1.0.1
// 文件名: src/interfaces/design-context.interface.ts
// 职责: 设计会话上下文（状态机核心数据），无 any
//
// v1.0.1 修正记录：
//   - DesignContext 新增 retry_count 字段（Critic-Executor 重试计数，初始 0）
//   - 新增 createDesignContext 工厂函数（生成初始状态，供状态机/会话层复用）
//   - 新增 complexity?: PatternComplexity（分析与匹配节点回写，供 VALIDATING 条件边
//     判断「复杂设计需人工确认」——白皮书 §6.1/修正 4）

import type { ProfileConfig } from './config.interface';
import type { PatternComplexity } from './pattern.interface';

/** 状态机状态（与白皮书 §6.1 状态定义对齐） */
export type DesignStatus =
  | 'idle'
  | 'analyzing'
  | 'matching'
  | 'generating'
  | 'validating'
  | 'delivering'
  | 'interrupted'
  | 'error'
  | 'completed';

/** 任务类型枚举 */
export type TaskType =
  | 'coding'
  | 'data_analysis'
  | 'document_processing'
  | 'multi_step_planning'
  | 'other';

/** 环境约束 */
export interface EnvironmentConstraint {
  readonly network_access: boolean;
  readonly sandbox_required: boolean;
  readonly permission_level: 'read_only' | 'read_write' | 'admin';
}

/** 性能要求 */
export interface PerformanceRequirement {
  readonly concurrency?: number;      // 并发数
  readonly max_latency_ms?: number;   // 最大延迟
  readonly cost_budget_usd?: number;  // 成本预算
}

/**
 * 结构化需求（以显式字段替代宽松 Record 索引签名，保证类型安全）
 */
export interface StructuredRequirement {
  readonly task_type: TaskType;
  readonly environment: EnvironmentConstraint;
  readonly performance: PerformanceRequirement;
  readonly extensibility_expected: boolean;
  readonly additional_notes?: string;
}

/** 设计上下文（状态机核心数据） */
export interface DesignContext {
  readonly trace_id: string;
  readonly session_id: string;
  readonly status: DesignStatus;
  readonly user_prompt: string;
  readonly structured_req?: StructuredRequirement;
  /** v1.0.1 新增：复杂度判断结果（simple/medium/complex），由分析/匹配节点回写 */
  readonly complexity?: PatternComplexity;
  readonly matched_pattern_id?: string;
  readonly generated_profile?: ProfileConfig;
  readonly validation_errors?: readonly string[];
  readonly cost_usd: number;
  /** v1.0.1 新增：Critic-Executor 重试计数（初始 0，>= 上限后转人工） */
  readonly retry_count: number;
  readonly checkpoint: string;
  readonly created_at: number;
}

/**
 * 创建初始 DesignContext 的工厂函数。
 * @param params.session_id 会话 ID
 * @param params.user_prompt 用户原始需求
 * @param params.trace_id 可选；缺省生成 ako-dsg-{时间戳}-{随机段} 便于日志过滤
 */
export function createDesignContext(params: {
  readonly session_id: string;
  readonly user_prompt: string;
  readonly trace_id?: string;
}): DesignContext {
  return {
    trace_id:
      params.trace_id ?? `ako-dsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    session_id: params.session_id,
    status: 'idle',
    user_prompt: params.user_prompt,
    cost_usd: 0,
    retry_count: 0,
    checkpoint: '',
    created_at: Date.now()
  };
}
