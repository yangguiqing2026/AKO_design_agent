// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/unit/generate-profile.tool.test.ts
// 覆盖: GenerateProfileTool——确定性生成、拓扑 meta/build_order、结构校验、PromptAssembler 消费。

import type { DesignContext } from '../../src/interfaces/design-context.interface';
import { createDesignContext } from '../../src/interfaces/design-context.interface';
import { PromptAssembler } from '../../src/prompts/assembler';
import { PatternMatcher } from '../../src/modules/pattern-matcher';
import { GenerateProfileTool } from '../../src/tools/generate-profile.tool';
import { validateProfile } from '../../src/modules/config-generator/patch-validator';

const FIXED_NOW = '2026-09-06T00:00:00.000Z';

function baseCtx(overrides: Partial<DesignContext> = {}): DesignContext {
  return {
    ...createDesignContext({ session_id: 'g-1', user_prompt: 'Design a coding agent with pipeline' }),
    complexity: 'medium',
    structured_req: {
      task_type: 'coding',
      environment: { network_access: false, sandbox_required: true, permission_level: 'read_write' },
      performance: {},
      extensibility_expected: true
    },
    ...overrides
  };
}

describe('GenerateProfileTool 确定性生成', () => {
  const assembler = new PromptAssembler();
  const matcher = new PatternMatcher();
  const tool = new GenerateProfileTool({ assembler, matcher, now: () => FIXED_NOW });

  it('生成合法 DesignProfile：结构校验通过、补丁 id 唯一、build_order 注解完整', async () => {
    const result = await tool.generate({ ctx: baseCtx(), user_prompt: 'Design a coding agent with pipeline' });
    expect(validateProfile(result.profile).valid).toBe(true);
    const ids = result.profile.patches.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const patch of result.profile.patches) {
      expect(patch.meta?.build_order).toBeGreaterThanOrEqual(0);
    }
    expect(result.profile.name).toBe('design-a-coding-agent-with-pipeline');
  });

  it('确定性：同输入两次生成结果完全一致；bundles 恒含 dsh-base', async () => {
    const input = { ctx: baseCtx(), user_prompt: 'Design a coding agent with pipeline' };
    const first = await tool.generate(input);
    const second = await tool.generate(input);
    expect(second).toEqual(first);
    expect(first.profile.bundles).toContain('@deepseek-ai/dsh-base');
  });

  it('消费 PromptAssembler：System Prompt 含身份分节、路由按复杂度解析', async () => {
    const result = await tool.generate({ ctx: baseCtx(), user_prompt: 'Design a coding agent with pipeline' });
    expect(result.system_prompt).toContain('# 系统身份与职责');
    expect(result.system_prompt).toContain('ako-dsg-');
    expect(result.route.model).toBe('deepseek-v3-small'); // medium → simple_pattern
  });

  it('按模式生成：hierarchical 产物描述与组件补丁归属该模式', async () => {
    const ctx = baseCtx({ matched_pattern_id: 'hierarchical', complexity: 'complex' });
    const result = await tool.generate({ ctx, user_prompt: 'Design a hierarchical multi agent' });
    expect(result.profile.description).toContain('hierarchical');
    expect(result.profile.patches[0].id).toMatch(/^hierarchical-harness-/);
    expect(result.route.model).toBe('deepseek-v4-pro'); // complex → complex_design
  });

  it('纯中文提示词回退固定 profile 名（确定性）', async () => {
    const ctx = createDesignContext({ session_id: 'g-2', user_prompt: '请设计一个高可用的编码代理' });
    const result = await tool.generate({ ctx, user_prompt: '请设计一个高可用的编码代理' });
    expect(result.profile.name).toBe('design-profile');
  });
});
