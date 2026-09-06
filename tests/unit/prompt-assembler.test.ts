// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/unit/prompt-assembler.test.ts
// 覆盖: PromptAssembler 确定性组装（顺序/去重/上下文注入/记忆提示/模型路由）、
//       default.yml 与 llm.backends.yml 的解析函数（合法/非法输入）。

import {
  DEFAULT_LLM_BACKENDS,
  DEFAULT_RUNTIME_SETTINGS,
  parseLlmBackends,
  parseRuntimeSettings,
  PromptAssembler,
  PromptConfigError
} from '../../src/prompts/assembler';

const FIXED_NOW = '2026-09-06T00:00:00.000Z';

describe('PromptAssembler 确定性组装', () => {
  const assembler = new PromptAssembler();

  it('分节顺序固定且去重：身份→角色→工具→中间层→运行时上下文', () => {
    const result = assembler.assemble({ trace_id: 't-1', now: FIXED_NOW });
    expect(result.sections).toEqual([
      '系统身份与职责',
      '角色风格',
      '工具使用引导',
      '安全与诚实约束',
      '运行时上下文'
    ]);
  });

  it('上下文注入：trace_id / 时间 / 模型路由出现在 System Prompt 中', () => {
    const result = assembler.assemble({
      trace_id: 'ako-dsg-abc',
      now: FIXED_NOW,
      complexity: 'simple'
    });
    expect(result.system_prompt).toContain('ako-dsg-abc');
    expect(result.system_prompt).toContain(FIXED_NOW);
    expect(result.system_prompt).toContain('deepseek-v3-small');
  });

  it('模型路由映射：complex → complex_design（v4-pro），simple/medium → simple_pattern（v3-small）', () => {
    expect(assembler.routeFor('complex')).toEqual({
      model: 'deepseek-v4-pro',
      endpoint: 'https://api.deepseek.com/v1'
    });
    expect(assembler.routeFor('simple')).toEqual({
      model: 'deepseek-v3-small',
      endpoint: 'https://api.deepseek.com/v1'
    });
    expect(assembler.routeFor('medium').model).toBe('deepseek-v3-small');
    expect(assembler.routeFor(undefined).model).toBe('deepseek-v3-small');
  });

  it('路由名缺失 → 回退 default.yml llm.model，endpoint 为空', () => {
    const fallback = new PromptAssembler({
      runtime: { ...DEFAULT_RUNTIME_SETTINGS, llm_model: 'deepseek-v4-pro' },
      backends: {
        backends: [{ name: 'other', model: 'x', endpoint: 'http://x' }],
        routing: { simple_pattern: 'missing-route', complex_design: 'missing-route' }
      }
    });
    expect(fallback.routeFor('simple')).toEqual({ model: 'deepseek-v4-pro', endpoint: '' });
  });

  it('确定性：相同输入两次组装产出完全一致的 system_prompt', () => {
    const input = {
      trace_id: 't-det',
      now: FIXED_NOW,
      task_type: 'coding' as const,
      complexity: 'complex' as const
    };
    const first = assembler.assemble(input).system_prompt;
    const second = assembler.assemble(input).system_prompt;
    expect(first).toBe(second);
    expect(first).toContain('# 系统身份与职责');
    expect(first).toContain('# 运行时上下文');
  });

  it('记忆提示（memory_hints）以只读旁注注入且上限 8 条', () => {
    const hints = Array.from({ length: 12 }, (_, i) => `hint-${i}`);
    const result = assembler.assemble({
      trace_id: 't-mem',
      now: FIXED_NOW,
      memory_hints: hints
    });
    expect(result.system_prompt).toContain('【记忆提示（只读）】');
    expect(result.system_prompt).toContain('hint-0');
    expect(result.system_prompt).not.toContain('hint-9');
  });

  it('角色分节随任务类型变化（coding 含“架构师”引导）', () => {
    const result = assembler.assemble({ trace_id: 't-role', task_type: 'coding', now: FIXED_NOW });
    expect(result.system_prompt).toContain('软件架构师');
  });

  it('meta 携带 trace_id/assembled_at/model/endpoint 审计字段', () => {
    const result = assembler.assemble({ trace_id: 't-meta', now: FIXED_NOW, complexity: 'complex' });
    expect(result.meta).toEqual({
      trace_id: 't-meta',
      assembled_at: FIXED_NOW,
      model: 'deepseek-v4-pro',
      endpoint: 'https://api.deepseek.com/v1'
    });
    expect(result.model_route).toBe('deepseek-v4-pro');
  });
});

describe('default.yml / llm.backends.yml 解析', () => {
  it('解析合法配置（对齐 config/default.yml 形态）', () => {
    const settings = parseRuntimeSettings({
      runtime: { max_steps: 20, tool_call_limit: 30, timeout: 60 },
      llm: { model: 'deepseek-v4-pro', temperature: 0.3 },
      memory: { short_term: true, long_term: true, episodic: true }
    });
    expect(settings.max_steps).toBe(20);
    expect(settings.llm_temperature).toBe(0.3);
    expect(settings.memory.episodic).toBe(true);
  });

  it('解析合法 LLM 后端（对齐 config/llm.backends.yml 形态）', () => {
    const backends = parseLlmBackends({
      backends: [
        { name: 'v4-pro', model: 'deepseek-v4-pro', endpoint: 'https://api.deepseek.com/v1' }
      ],
      routing: { simple_pattern: 'v3-small', complex_design: 'v4-pro' }
    });
    expect(backends.backends[0].model).toBe('deepseek-v4-pro');
    expect(backends.routing.complex_design).toBe('v4-pro');
  });

  it('非法输入抛 PromptConfigError（字段缺失/类型错误）', () => {
    expect(() => parseRuntimeSettings({ runtime: {}, llm: {}, memory: {} })).toThrow(
      PromptConfigError
    );
    expect(() => parseRuntimeSettings({ runtime: { max_steps: 'x' } })).toThrow(PromptConfigError);
    expect(() => parseLlmBackends({ backends: 'nope', routing: {} })).toThrow(PromptConfigError);
    expect(() => parseLlmBackends({ backends: [], routing: {} })).toThrow(PromptConfigError);
  });

  it('默认常量与 config 当前值对齐（作为缺省 fallback）', () => {
    expect(DEFAULT_RUNTIME_SETTINGS.max_steps).toBe(20);
    expect(DEFAULT_LLM_BACKENDS.backends.length).toBe(2);
  });
});
