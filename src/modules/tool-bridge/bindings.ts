// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: src/modules/tool-bridge/bindings.ts
// 职责: 把既有设计工具绑定到 LocalToolBridge（进程内 MCP 桥接的默认注册）。
//   - query_patterns（general）：委托 QueryPatternsTool.query
//   - generate_profile（general）：委托 GenerateProfileTool.generate（内部构造最小 ctx）
//   - simulate_run（sandbox）：委托 SimulateRunTool.run（沙箱纪律由工具保证）
//   注册表与 prompts/tool-guidance REGISTERED_TOOLS 名称对齐。

import { createDesignContext } from '../../interfaces/design-context.interface';
import type { PatternComplexity } from '../../interfaces/pattern.interface';
import type { ProfileConfig } from '../../interfaces/config.interface';
import type { QueryPatternsTool } from '../../tools/query-patterns.tool';
import type { GenerateProfileTool } from '../../tools/generate-profile.tool';
import type { SimulateRunTool } from '../../tools/simulate-run.tool';
import { bridgeEntry, LocalToolBridge } from './tool-bridge';

export interface LocalBridgeBindings {
  readonly queryPatternsTool: QueryPatternsTool;
  readonly generateProfileTool: GenerateProfileTool;
  readonly simulateRunTool: SimulateRunTool;
}

const COMPLEXITIES: readonly string[] = ['simple', 'medium', 'complex'];

function isComplexity(value: unknown): value is PatternComplexity {
  return typeof value === 'string' && (COMPLEXITIES as readonly string[]).includes(value);
}

/** 构造本地工具桥接（含三个设计工具注册） */
export function buildLocalToolBridge(bindings: LocalBridgeBindings): LocalToolBridge {
  const qpDef = bindings.queryPatternsTool.define();

  const queryPatternsEntry = bridgeEntry(
    qpDef.name,
    qpDef.description,
    qpDef.input_schema,
    'general',
    (args) => {
      const keywords = Array.isArray(args.keywords)
        ? args.keywords.filter((k): k is string => typeof k === 'string')
        : [];
      return bindings.queryPatternsTool.query({
        ...(keywords.length > 0 ? { keywords } : {}),
        ...(isComplexity(args.complexity) ? { complexity: args.complexity } : {})
      });
    }
  );

  const generateProfileEntry = bridgeEntry(
    'generate_profile',
    '按用户需求（user_prompt）经 PromptAssembler + 模式库生成 DesignProfile（含拓扑 meta）',
    {
      type: 'object',
      properties: { user_prompt: { type: 'string' }, session_id: { type: 'string' } },
      required: ['user_prompt']
    },
    'general',
    async (args) => {
      const userPrompt = args.user_prompt as string;
      const sessionId =
        typeof args.session_id === 'string' && args.session_id.length > 0
          ? args.session_id
          : `bridge-${Date.now()}`;
      const ctx = createDesignContext({ session_id: sessionId, user_prompt: userPrompt });
      const generated = await bindings.generateProfileTool.generate({ ctx, user_prompt: userPrompt });
      return { profile: generated.profile, route: generated.route };
    }
  );

  const simulateRunEntry = bridgeEntry(
    'simulate_run',
    '在沙箱内对 DesignProfile 做静态自检（结构校验 + 注入扫描），返回 RUNNER 结论',
    {
      type: 'object',
      properties: { profile: { type: 'object' }, timeout_ms: { type: 'number' } },
      required: ['profile']
    },
    'sandbox',
    async (args) => {
      const profile = args.profile as Record<string, unknown>;
      if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
        throw new Error('simulate_run 参数 profile 必须是对象');
      }
      const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined;
      const result = await bindings.simulateRunTool.run({
        profile: profile as unknown as ProfileConfig,
        ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {})
      });
      return {
        ok: result.ok,
        blocked: result.blocked,
        summary: result.summary,
        exit_code: result.exit_code
      };
    }
  );

  return new LocalToolBridge({
    entries: [queryPatternsEntry, generateProfileEntry, simulateRunEntry]
  });
}
