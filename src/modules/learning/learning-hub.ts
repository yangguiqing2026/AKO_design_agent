// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/modules/learning/learning-hub.ts
// 职责: 自学习中枢（case-store + pattern-weight 的组合门面）。
//   recordOutcome(input)：
//     - 无条件沉淀会话案例（episodic）
//     - 带 pattern_id 时按结局更新权重：accepted 且未中断 → win；否则 loss
//   作为 orchestrator / SimpleCriticExecutor 的 case sink 收口。

import type {
  CaseRecord,
  CaseRecordInput,
  ILearningHub,
  ICaseStore,
  IPatternWeightStore,
  OutcomeSettled,
  PatternWeightDelta
} from '../../interfaces/learning.interface';

export interface LearningHubOptions {
  readonly cases: ICaseStore;
  readonly weights: IPatternWeightStore;
}

/** 自学习中枢实现 */
export class LearningHub implements ILearningHub {
  readonly cases: ICaseStore;
  readonly weights: IPatternWeightStore;

  constructor(options: LearningHubOptions) {
    this.cases = options.cases;
    this.weights = options.weights;
  }

  recordOutcome(input: Readonly<CaseRecordInput>): OutcomeSettled {
    const record: CaseRecord = this.cases.append({ ...input });
    if (input.pattern_id === undefined) {
      return { record };
    }
    const outcome: 'win' | 'loss' =
      input.interrupted || input.verdict === 'rejected' ? 'loss' : 'win';
    const delta: PatternWeightDelta = this.weights.record(input.pattern_id, outcome);
    return { record, delta };
  }

  recall(sessionId?: string): readonly CaseRecord[] {
    return this.cases.list({ session_id: sessionId });
  }
}
