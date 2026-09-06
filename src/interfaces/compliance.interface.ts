// AKO_studio - Design Agent v1.0.0
// 文件名: src/interfaces/compliance.interface.ts
// 职责: AKO 合规清单的类型化表示（无 any）

/** 合规判定结果 */
export type ComplianceStatus = '通过' | '不通过' | 'N/A' | '待评估';

/** 单项合规检查 */
export interface ComplianceItem {
  readonly id: string;
  readonly label: string;
  readonly status: ComplianceStatus;
  readonly note?: string;
}

/** 单个合规维度 */
export interface ComplianceDimension {
  readonly code: string;                 // 例如 dimension_I
  readonly items: readonly ComplianceItem[];
  readonly score?: { readonly scored: number; readonly max: number };
}

/** AKO 合规清单 */
export interface ComplianceManifest {
  readonly agent_id: string;
  readonly agent_name: string;
  readonly target_level: string;
  readonly civilization_type: string;
  readonly dimensions: readonly ComplianceDimension[];
  readonly veto: readonly ComplianceItem[];
}
