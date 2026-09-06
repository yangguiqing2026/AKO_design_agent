// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/prompts/assembler.ts
// 职责: 动态 Prompt 运行时组装器（Sprint 2 核心）。
//   - 确定性组合 System Prompt = identity + persona + tool-guidance + middleware + runtime-context
//   - 解析 config/default.yml（runtime/llm/memory 段）与 config/llm.backends.yml（路由表）
//   - 按复杂度路由模型（simple_pattern/complex_design），缺省回退 default.yml llm.model
//   - 分节去重（key 唯一）与顺序固定，便于测试与审计
//   - 无 any：yaml 的 unknown 输入经本文件解析函数收敛为显式类型

import type { PatternComplexity } from '../interfaces/pattern.interface';
import type { TaskType } from '../interfaces/design-context.interface';
import { buildIdentity, IDENTITY_SECTION_KEY } from './identity';
import { buildPersona, PERSONA_SECTION_KEY } from './persona';
import { buildToolGuidance, TOOL_GUIDANCE_SECTION_KEY } from './tool-guidance';
import { buildMiddleware, MIDDLEWARE_SECTION_KEY } from './middleware';
import { buildRuntimeContext, RUNTIME_CONTEXT_SECTION_KEY } from './runtime-context';
import type { PromptSection } from './sections';

/** 运行时配置（config/default.yml 的规范化形态） */
export interface RuntimeSettings {
  readonly max_steps: number;
  readonly tool_call_limit: number;
  readonly timeout: number;
  /** Sprint 3：会话墙钟熔断上限（毫秒，缺省 60s 语义） */
  readonly session_timeout_ms: number;
  /** Sprint 3：单次调用 TTFT/时延上限（毫秒） */
  readonly ttft_timeout_ms: number;
  readonly llm_model: string;
  readonly llm_temperature: number;
  readonly memory: {
    readonly short_term: boolean;
    readonly long_term: boolean;
    readonly episodic: boolean;
  };
}

/** 默认运行时设置（与 config/default.yml 当前值一致；注入优先级更高） */
export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  max_steps: 20,
  tool_call_limit: 30,
  timeout: 60,
  session_timeout_ms: 60000,
  ttft_timeout_ms: 30000,
  llm_model: 'deepseek-v4-pro',
  llm_temperature: 0.3,
  memory: { short_term: true, long_term: true, episodic: true }
};

/** LLM 后端定义（config/llm.backends.yml） */
export interface LlmBackendDef {
  readonly name: string;
  readonly model: string;
  readonly endpoint: string;
}

/** LLM 后端配置（含路由表） */
export interface LlmBackendsConfig {
  readonly backends: readonly LlmBackendDef[];
  readonly routing: { readonly simple_pattern: string; readonly complex_design: string };
}

/** 默认 LLM 后端（与 config/llm.backends.yml 当前值一致） */
export const DEFAULT_LLM_BACKENDS: LlmBackendsConfig = {
  backends: [
    { name: 'v4-pro', model: 'deepseek-v4-pro', endpoint: 'https://api.deepseek.com/v1' },
    { name: 'v3-small', model: 'deepseek-v3-small', endpoint: 'https://api.deepseek.com/v1' }
  ],
  routing: { simple_pattern: 'v3-small', complex_design: 'v4-pro' }
};

/** 配置解析异常 */
export class PromptConfigError extends Error {
  readonly code = 'PROMPT_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PromptConfigError';
  }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PromptConfigError(`${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PromptConfigError(`${field} 必须是非 NaN 有限数字`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PromptConfigError(`${field} 必须是布尔值`);
  }
  return value;
}

/** 可选有限数字：缺省/未定义使用 fallback（Sprint 3 熔断阈值向后兼容） */
function optionalFiniteNumber(value: unknown, fallback: number, field: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PromptConfigError(`${field} 必须是非 NaN 有限数字`);
  }
  return value;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new PromptConfigError(`${field} 必须是字符串`);
  }
  return value;
}

/** 解析 config/default.yml（unknown 收敛，非法即抛 PromptConfigError） */
export function parseRuntimeSettings(raw: unknown): RuntimeSettings {
  const root = asRecord(raw, 'default.yml 根节点');
  const runtime = asRecord(root.runtime, 'runtime');
  const llm = asRecord(root.llm, 'llm');
  const memory = asRecord(root.memory, 'memory');
  return {
    max_steps: asFiniteNumber(runtime.max_steps, 'runtime.max_steps'),
    tool_call_limit: asFiniteNumber(runtime.tool_call_limit, 'runtime.tool_call_limit'),
    timeout: asFiniteNumber(runtime.timeout, 'runtime.timeout'),
    session_timeout_ms: optionalFiniteNumber(
      runtime.session_timeout_ms,
      DEFAULT_RUNTIME_SETTINGS.session_timeout_ms,
      'runtime.session_timeout_ms'
    ),
    ttft_timeout_ms: optionalFiniteNumber(
      llm.ttft_timeout_ms,
      DEFAULT_RUNTIME_SETTINGS.ttft_timeout_ms,
      'llm.ttft_timeout_ms'
    ),
    llm_model: asString(llm.model, 'llm.model'),
    llm_temperature: asFiniteNumber(llm.temperature, 'llm.temperature'),
    memory: {
      short_term: asBoolean(memory.short_term, 'memory.short_term'),
      long_term: asBoolean(memory.long_term, 'memory.long_term'),
      episodic: asBoolean(memory.episodic, 'memory.episodic')
    }
  };
}

/** 解析 config/llm.backends.yml（unknown 收敛，非法即抛 PromptConfigError） */
export function parseLlmBackends(raw: unknown): LlmBackendsConfig {
  const root = asRecord(raw, 'llm.backends.yml 根节点');
  const routing = asRecord(root.routing, 'routing');
  const simplePattern = asString(routing.simple_pattern, 'routing.simple_pattern');
  const complexDesign = asString(routing.complex_design, 'routing.complex_design');
  const backendList = root.backends;
  if (!Array.isArray(backendList)) {
    throw new PromptConfigError('backends 必须是数组');
  }
  const backends: LlmBackendDef[] = [];
  for (const [index, item] of backendList.entries()) {
    const backend = asRecord(item, `backends[${index}]`);
    backends.push({
      name: asString(backend.name, `backends[${index}].name`),
      model: asString(backend.model, `backends[${index}].model`),
      endpoint: asString(backend.endpoint, `backends[${index}].endpoint`)
    });
  }
  return { backends, routing: { simple_pattern: simplePattern, complex_design: complexDesign } };
}

/** Prompt 组装输入 */
export interface PromptAssemblyInput {
  readonly trace_id: string;
  readonly task_type?: TaskType;
  readonly complexity?: PatternComplexity;
  /** 注入的确定性时间点；缺省使用 new Date().toISOString() */
  readonly now?: string;
  /** 记忆提示（来自 MemoryHub 召回），作为只读引导旁注 */
  readonly memory_hints?: readonly string[];
}

/** 组装产物 */
export interface AssembledSystemPrompt {
  readonly system_prompt: string;
  /** 分节标题（保持组装顺序，供测试断言） */
  readonly sections: readonly string[];
  /** 解析出的模型路由（模型名，如 deepseek-v4-pro） */
  readonly model_route: string;
  /** 路由元信息（端点等，供审计） */
  readonly meta: {
    readonly trace_id: string;
    readonly assembled_at: string;
    readonly model: string;
    readonly endpoint: string;
  };
}

export interface PromptAssemblerOptions {
  readonly runtime?: RuntimeSettings;
  readonly backends?: LlmBackendsConfig;
}

/** 分节装配顺序（identity 恒为第一节，runtime-context 恒为最后一节） */
const DEFAULT_SECTION_ORDER: readonly string[] = [
  IDENTITY_SECTION_KEY,
  PERSONA_SECTION_KEY,
  TOOL_GUIDANCE_SECTION_KEY,
  MIDDLEWARE_SECTION_KEY,
  RUNTIME_CONTEXT_SECTION_KEY
];

/**
 * 动态 Prompt 运行时组装器。
 * assemble() 为确定性纯函数（除未显式传入 now 时读取时钟外），顺序/去重/注入均可测。
 */
export class PromptAssembler {
  private readonly runtime: RuntimeSettings;
  private readonly backends: LlmBackendsConfig;

  constructor(options: PromptAssemblerOptions = {}) {
    this.runtime = options.runtime ?? DEFAULT_RUNTIME_SETTINGS;
    this.backends = options.backends ?? DEFAULT_LLM_BACKENDS;
  }

  /** 按复杂度解析模型路由（simple/medium→simple_pattern，complex→complex_design） */
  routeFor(
    complexity: PatternComplexity | undefined
  ): { readonly model: string; readonly endpoint: string } {
    const routeName =
      complexity === 'complex' ? this.backends.routing.complex_design : this.backends.routing.simple_pattern;
    const backend = this.backends.backends.find((b) => b.name === routeName);
    if (backend !== undefined) {
      return { model: backend.model, endpoint: backend.endpoint };
    }
    return { model: this.runtime.llm_model, endpoint: '' };
  }

  /** 确定性组装 System Prompt */
  assemble(input: PromptAssemblyInput): AssembledSystemPrompt {
    const fragments: readonly PromptSection[] = [
      buildIdentity(),
      buildPersona(input.task_type),
      buildToolGuidance(),
      buildMiddleware(),
      buildRuntimeContext({
        trace_id: input.trace_id,
        now: input.now,
        model_route: this.routeFor(input.complexity).model,
        complexity: input.complexity
      })
    ];

    const seen = new Set<string>();
    const ordered: PromptSection[] = [];
    for (const key of DEFAULT_SECTION_ORDER) {
      const fragment = fragments.find((f) => f.key === key);
      if (fragment !== undefined && !seen.has(fragment.key)) {
        seen.add(fragment.key);
        ordered.push(fragment);
      }
    }
    for (const fragment of fragments) {
      if (!seen.has(fragment.key)) {
        seen.add(fragment.key);
        ordered.push(fragment);
      }
    }

    const route = this.routeFor(input.complexity);
    const memoryLines = (input.memory_hints ?? []).slice(0, 8);
    const memoryBlock =
      memoryLines.length === 0
        ? []
        : ['', '【记忆提示（只读）】', ...memoryLines.map((hint) => `- ${hint}`)];

    const body = ordered.map((fragment) => `# ${fragment.title}\n${fragment.text}`).join('\n\n');
    const assembledAt = input.now ?? new Date().toISOString();
    const systemPrompt = `${body}${memoryBlock.length > 0 ? `\n\n${memoryBlock.join('\n')}` : ''}`;

    return {
      system_prompt: systemPrompt,
      sections: ordered.map((fragment) => fragment.title),
      model_route: route.model,
      meta: {
        trace_id: input.trace_id,
        assembled_at: assembledAt,
        model: route.model,
        endpoint: route.endpoint
      }
    };
  }
}
