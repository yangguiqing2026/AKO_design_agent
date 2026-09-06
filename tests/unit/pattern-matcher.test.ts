// AKO_studio - Design Agent v1.0.0
// 文件名: tests/unit/pattern-matcher.test.ts
// 覆盖: 内建模式库 / 关键词+复杂度评分 / 选择与排序 / ReAct fallback / 结构化需求匹配

import {
  DEFAULT_PATTERNS,
  PatternMatcher,
  scorePattern
} from '../../src/modules/pattern-matcher';
import type { ArchitecturePattern } from '../../src/interfaces/pattern.interface';
import type { StructuredRequirement } from '../../src/interfaces/design-context.interface';

describe('内建模式库', () => {
  it('包含 ReAct / Plan-Execute / Reflection / Hierarchical / PTC', () => {
    const ids = DEFAULT_PATTERNS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['react', 'plan-execute', 'reflection', 'hierarchical', 'ptc'])
    );
  });
});

describe('scorePattern 评分', () => {
  const react = DEFAULT_PATTERNS.find((p) => p.id === 'react');
  const plan = DEFAULT_PATTERNS.find((p) => p.id === 'plan-execute');

  it('关键词命中 + 复杂度吻合得到更高分', () => {
    expect(react).toBeDefined();
    const reactScore = scorePattern(react as ArchitecturePattern, {
      keywords: ['工具调用', '问答'],
      complexity: 'simple'
    });
    const planScore = scorePattern(plan as ArchitecturePattern, {
      keywords: ['工具调用', '问答'],
      complexity: 'simple'
    });
    expect(reactScore.score).toBeGreaterThan(planScore.score);
    expect(reactScore.matched_keywords).toContain('工具调用');
  });

  it('复杂度不匹配产生扣分', () => {
    const reactScore = scorePattern(react as ArchitecturePattern, {
      keywords: ['多agent', '编排'],
      complexity: 'complex'
    });
    const hierarchical = DEFAULT_PATTERNS.find((p) => p.id === 'hierarchical');
    const hierScore = scorePattern(hierarchical as ArchitecturePattern, {
      keywords: ['多agent', '编排'],
      complexity: 'complex'
    });
    expect(hierScore.score).toBeGreaterThan(reactScore.score);
  });

  it('得分被裁剪在 0-100', () => {
    const many = scorePattern(react as ArchitecturePattern, {
      keywords: ['工具调用', '问答', '通用助手', '查询', '检索', 'agent', '循环'],
      complexity: 'simple'
    });
    expect(many.score).toBeLessThanOrEqual(100);
    const none = scorePattern(react as ArchitecturePattern, { keywords: ['无关词xyz'] });
    expect(none.score).toBeGreaterThanOrEqual(0);
  });
});

describe('PatternMatcher 选择逻辑', () => {
  it('复杂多 Agent 需求选中 hierarchical（无 fallback 标记）', () => {
    const matcher = new PatternMatcher();
    const result = matcher.match({
      keywords: ['多agent', '子agent委派', '团队协作'],
      complexity: 'complex'
    });
    expect(result.selected_pattern?.id).toBe('hierarchical');
    expect(result.fallback_used).toBe(false);
    expect(result.candidates[0].pattern_id).toBe('hierarchical');
  });

  it('计划执行需求选中 plan-execute', () => {
    const matcher = new PatternMatcher();
    const result = matcher.match({ keywords: ['多步', '端到端', '规划'], complexity: 'medium' });
    expect(result.selected_pattern?.id).toBe('plan-execute');
    expect(result.fallback_used).toBe(false);
  });

  it('无有效匹配 → 回退 ReAct 且 fallback_used=true', () => {
    const matcher = new PatternMatcher();
    const result = matcher.match({ keywords: ['香蕉', '榴莲'] });
    expect(result.selected_pattern?.id).toBe('react');
    expect(result.fallback_used).toBe(true);
  });

  it('空查询直接回退 ReAct', () => {
    const matcher = new PatternMatcher();
    const result = matcher.match({ keywords: [] });
    expect(result.selected_pattern?.id).toBe('react');
    expect(result.fallback_used).toBe(true);
    expect(result.candidates).toHaveLength(0);
  });

  it('自定义模式库缺少 fallback 时返回无选中', () => {
    const custom = new PatternMatcher({ patterns: [DEFAULT_PATTERNS[1]] });
    const result = custom.match({ keywords: ['香蕉'] });
    expect(result.selected_pattern).toBeUndefined();
    expect(result.fallback_used).toBe(false);
  });

  it('从结构化需求构造查询并匹配', () => {
    const structured: StructuredRequirement = {
      task_type: 'multi_step_planning',
      environment: { network_access: false, sandbox_required: true, permission_level: 'read_write' },
      performance: {},
      extensibility_expected: false
    };
    const matcher = new PatternMatcher();
    const result = matcher.matchStructured(structured, 'medium');
    expect(result.selected_pattern?.id).toBe('plan-execute');
  });
});
