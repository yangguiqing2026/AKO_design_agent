// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/fixtures/cordis-probe-report.fixture.ts
// 用途: 固化 Sprint 1 真包探针调研结论为“准真包”形态快照（Sprint 3 D1 决策证据基线）。
//   - 依据：.ako-compliance-report §P1 —— 真实 Harness 为 Cordis-4 + ESM-only，
//     导出 ctx.agents.register/create 与 Agent handle（inbox/followup/steer），
//     不含 openSession/close/info；公开 npm 无法闭环安装。
//   - 用法：loader/归一化单测以本快照为准；真实私有源环境实测导出后以 probe 报告校准。

import type { CordisCompatibilityProbe } from '../../src/interfaces/cordis-agent.interface';

/** 探针结论快照（inferred；标注 shape 来源） */
export const CORDIS_PROBE_REPORT_FIXTURE: CordisCompatibilityProbe = {
  package_name: '@deepseek-ai/dsh-agent',
  present: false, // 公开 npm 不可闭环（peer 链缺口），标记为未安装/不可安装
  surface: 'not-installed',
  exported_keys: [],
  reason: '公开 npm 无法闭环安装（peer 依赖缺口）；真实形态推断自官方调研：Cordis-4 + ESM-only'
};

/** 推断形态快照（用于构造 FakeCordis 与 loader 鸭子归一化测试） */
export const CORDIS_INFERRED_SHAPE = {
  runtime_name: '@deepseek-ai/dsh-agent',
  runtime_version: 'cordis-4',
  api_version: '0.1.x',
  surface_keys: ['default', 'ctx', 'agents', 'Agent'],
  // Cordis-4 ctx.agents 注册/创建入口（探针结论：register/create）
  agents_api: ['create', 'register'] as const,
  // Agent handle 能力（探针结论：inbox/followup/steer）
  agent_handle_keys: ['send', 'followup', 'steer', 'abort'] as const
} as const;
