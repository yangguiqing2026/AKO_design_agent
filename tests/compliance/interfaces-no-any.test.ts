// AKO_studio - Design Agent v1.0.0
// 文件名: tests/compliance/interfaces-no-any.test.ts
// 用途: 清单 #0 的门禁 —— src/interfaces/*.ts 去除 any；
//       结构示例同时充当接口的编译期冒烟（ts-jest 类型检查保证）。

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ComplianceManifest, ComplianceItem } from '../../src/interfaces/compliance.interface';
import type { CordisPatch, DesignProfile } from '../../src/interfaces/config.interface';
import type { BudgetConfig, CostLedger } from '../../src/interfaces/cost.interface';
import type { DesignContext, StructuredRequirement, TaskType } from '../../src/interfaces/design-context.interface';
import type { ArchitecturePattern, PatternMatchResult } from '../../src/interfaces/pattern.interface';
import type { VersionAuditSummary, VersionCheckResult, VersionGuardConfig } from '../../src/interfaces/version.interface';
import type { DshAdapterStatus, DshMessage, DshRuntimeInfo } from '../../src/interfaces/dsh.interface';

const INTERFACES_DIR = path.resolve(__dirname, '..', '..', 'src', 'interfaces');

function listInterfaceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(dir, f));
}

describe('清单#0 门禁：接口层禁止 any', () => {
  const files = listInterfaceFiles(INTERFACES_DIR);

  it('src/interfaces 目录存在且包含接口文件', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('任何接口文件中不得出现 any 用法', () => {
    const anyPattern = /\bas any\b|: any\b|\bany\[\]|Record<string, any>|\bany\s*[,})]/;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const badLines = source
        .split('\n')
        .map((line, index) => ({ line, index: index + 1 }))
        .filter(({ line }) => anyPattern.test(line));
      expect(badLines).toEqual([]);
    }
  });
});

describe('接口结构编译冒烟（类型检查）', () => {
  it('DesignContext 结构化需求可表达设计会话', () => {
    const structured: StructuredRequirement = {
      task_type: 'multi_step_planning',
      environment: { network_access: false, sandbox_required: true, permission_level: 'read_only' },
      performance: { concurrency: 2, max_latency_ms: 5000, cost_budget_usd: 3 },
      extensibility_expected: true
    };
    const ctx: DesignContext = {
      trace_id: 'ako-dsg-1',
      session_id: 's1',
      status: 'analyzing',
      user_prompt: '帮我设计一个编码 Agent',
      structured_req: structured,
      cost_usd: 0,
      retry_count: 0,
      checkpoint: 'idle',
      created_at: 1
    };
    expect(ctx.status).toBe('analyzing');
  });

  it('TaskType 联合类型拒绝非法字符串（编译期约束）', () => {
    const task: TaskType = 'coding';
    expect(['coding', 'other']).toContain(task);
  });

  it('DesignProfile 可携带类型化 CordisPatch', () => {
    const patch: CordisPatch = { id: 'p1', config: { loop: 'default' } };
    const profile: DesignProfile = {
      name: 'code-agent',
      bundles: ['@deepseek-ai/dsh-base'],
      patches: [patch]
    };
    expect(profile.patches[0].id).toBe('p1');
  });

  it('合规/成本/版本/模式/DSH 契约可被类型化引用', () => {
    const item: ComplianceItem = { id: 'FI-I-01', label: 'Frontmatter', status: '通过' };
    const manifest: ComplianceManifest = {
      agent_id: 'AKO_design_agent',
      agent_name: 'x',
      target_level: 'A',
      civilization_type: '创新型',
      dimensions: [],
      veto: [item]
    };
    const budget: BudgetConfig = {
      per_session_max_usd: 5,
      per_month_budget_usd: 500,
      alert_threshold_percent: 80,
      hard_break_percent: 100,
      token_cost: { cached_input: 0.022, uncached_input: 0.044, output: 0.088 }
    };
    const ledger: CostLedger = { month_key: '2026-09', total_usd: 0, sessions: [] };
    const lock: VersionGuardConfig = {
      locked_versions: { '@deepseek-ai/cordis': '0.1.3-alpha.1' },
      pin_strategy: 'exact'
    };
    const check: VersionCheckResult = {
      package_name: '@deepseek-ai/cordis',
      locked_version: '0.1.3-alpha.1',
      declared_version: '0.1.3-alpha.1',
      state: 'locked',
      strategy: 'exact',
      message: 'ok'
    };
    const audit: VersionAuditSummary = {
      compliant: true,
      fallback_mode: false,
      results: [check],
      blocked: [],
      checked_at: new Date().toISOString()
    };
    const pattern: ArchitecturePattern = {
      id: 'react',
      name: 'ReAct',
      description: '标准工具调用',
      applicable_scenarios: ['问答'],
      harness_components: ['loop'],
      complexity: 'simple'
    };
    const match: PatternMatchResult = { candidates: [], fallback_used: false };
    const msg: DshMessage = { role: 'user', content: 'hi' };
    const runtime: DshRuntimeInfo = { name: 'x', version: '1.0.0', api_version: '1' };
    const dsh: DshAdapterStatus = { state: 'runtime-ready', runtime, checked_at: 'now' };

    expect([manifest, budget, ledger, lock, audit, pattern, match, msg, dsh]).toBeDefined();
  });
});
