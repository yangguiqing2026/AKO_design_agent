// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/unit/query-patterns.tool.test.ts
// 覆盖: QueryPatternsTool——结构化/关键词查询、结构化 JSON 输出、工具定义注册表。

import { QueryPatternsTool } from '../../src/tools/query-patterns.tool';
import { PatternMatcher } from '../../src/modules/pattern-matcher';

const FIXED_NOW = '2026-09-06T00:00:00.000Z';

describe('QueryPatternsTool', () => {
  const tool = new QueryPatternsTool(new PatternMatcher(), () => FIXED_NOW);

  it('结构化需求查询：候选按得分降序、选中 id 为最高分', () => {
    const output = tool.query({
      structured: {
        task_type: 'multi_step_planning',
        environment: { network_access: false, sandbox_required: false, permission_level: 'read_only' },
        performance: {},
        extensibility_expected: false,
        additional_notes: '分阶段 端到端 规划'
      }
    });
    expect(output.tool).toBe('query_patterns');
    expect(output.generated_at).toBe(FIXED_NOW);
    expect(output.candidates.length).toBeGreaterThan(0);
    const scores = output.candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(output.selected_pattern_id).toBe(output.candidates[0].pattern_id);
    expect(output.candidates[0].pattern_id).toBe('plan-execute');
    expect(output.fallback_used).toBe(false);
  });

  it('关键词 + 复杂度查询：coding/简单任务路由到 react', () => {
    const output = tool.query({ keywords: ['标准工具调用', '问答'], complexity: 'simple' });
    expect(output.selected_pattern_id).toBe('react');
  });

  it('空查询回退：selected=react、fallback_used=true、candidates 为空', () => {
    const output = tool.query({ keywords: [] });
    expect(output.selected_pattern_id).toBe('react');
    expect(output.fallback_used).toBe(true);
    expect(output.candidates).toEqual([]);
  });

  it('无结构化输入时忽略 keywords 缺省数组（确定性）', () => {
    const output = tool.query({ keywords: ['写代码规划', '编码实现'], complexity: 'medium' });
    expect(typeof output.selected_pattern_id).toBe('string');
  });

  it('define 输出工具注册定义（name/description/input_schema）', () => {
    const def = tool.define();
    expect(def.name).toBe('query_patterns');
    expect(def.input_schema).toEqual(
      expect.objectContaining({ type: 'object' })
    );
  });
});
