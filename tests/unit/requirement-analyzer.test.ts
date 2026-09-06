// AKO_studio - Design Agent v1.0.0
// 文件名: tests/unit/requirement-analyzer.test.ts
// 覆盖: 任务分类 / 环境约束 / 性能数字抽取 / 复杂度 / 扩展性 / 备注提取 / 空输入 / 自定义规则

import {
  RequirementAnalyzer,
  RequirementAnalysisError
} from '../../src/modules/requirement-analyzer';

describe('任务类型分类', () => {
  const analyzer = new RequirementAnalyzer();

  it('编码类需求识别为 coding，并默认进入沙箱执行', () => {
    const result = analyzer.analyze('请编写一个 python 脚本，在沙箱中执行单元测试');
    expect(result.structured.task_type).toBe('coding');
    expect(result.structured.environment.sandbox_required).toBe(true);
    expect(result.structured.environment.network_access).toBe(false);
    expect(result.structured.environment.permission_level).toBe('read_write');
    expect(result.matched_keywords.length).toBeGreaterThan(0);
  });

  it('数据分析需求识别为 data_analysis（无需写入权限）', () => {
    const result = analyzer.analyze('对这份数据集做数据分析并生成可视化报表');
    expect(result.structured.task_type).toBe('data_analysis');
    expect(result.structured.environment.permission_level).toBe('read_only');
  });

  it('多步编排识别为 multi_step_planning 且复杂度 medium', () => {
    const result = analyzer.analyze('设计多步编排的端到端流程，分阶段执行');
    expect(result.structured.task_type).toBe('multi_step_planning');
    expect(result.complexity).toBe('medium');
  });

  it('生产级多 Agent 架构 → complexity=complex', () => {
    const result = analyzer.analyze('面向生产级的复杂多Agent架构设计，需要扩展插件');
    expect(result.complexity).toBe('complex');
  });

  it('无关键词时归为 other', () => {
    const result = analyzer.analyze('随便聊聊');
    expect(result.structured.task_type).toBe('other');
    expect(result.confidence).toBeLessThan(0.5);
  });
});

describe('环境与权限约束', () => {
  const analyzer = new RequirementAnalyzer();

  it('联网 + 部署 → network=true, permission=admin', () => {
    const result = analyzer.analyze('部署到服务器，需要调用外部 API 联网爬取公开数据');
    expect(result.structured.environment.network_access).toBe(true);
    expect(result.structured.environment.permission_level).toBe('admin');
  });

  it('隔离沙箱 + 网络限制提示被识别', () => {
    const result = analyzer.analyze('必须在隔离沙箱中模拟运行，禁止访问外部网络');
    expect(result.structured.environment.sandbox_required).toBe(true);
    expect(result.structured.environment.network_access).toBe(false);
  });
});

describe('性能数字抽取', () => {
  const analyzer = new RequirementAnalyzer();

  it('并发 / 延迟 / 预算被正则结构化', () => {
    const result = analyzer.analyze('需要 10 并发，延迟控制在 500ms 以内，预算 $20');
    expect(result.structured.performance.concurrency).toBe(10);
    expect(result.structured.performance.max_latency_ms).toBe(500);
    expect(result.structured.performance.cost_budget_usd).toBe(20);
  });
});

describe('扩展性与备注', () => {
  const analyzer = new RequirementAnalyzer();

  it('可扩展提示 → extensibility_expected=true', () => {
    const result = analyzer.analyze('架构要支持插件扩展，方便二次开发接入更多工具');
    expect(result.structured.extensibility_expected).toBe(true);
  });

  it('备注标记后的内容进入 additional_notes', () => {
    const result = analyzer.analyze('生成一份架构方案。备注：需要周末交付中文文档');
    expect(result.structured.additional_notes).toContain('周末交付');
  });
});

describe('健壮性', () => {
  const analyzer = new RequirementAnalyzer();

  it('空输入抛出 RequirementAnalysisError', () => {
    expect(() => analyzer.analyze('   ')).toThrow(RequirementAnalysisError);
    try {
      analyzer.analyze('');
    } catch (err) {
      expect((err as RequirementAnalysisError).code).toBe('REQUIREMENT_ANALYZE_FAILED');
    }
  });

  it('自定义规则可注入', () => {
    const custom = new RequirementAnalyzer({
      customRules: [{ type: 'document_processing', keywords: ['合同审查'] }]
    });
    const result = custom.analyze('对这份合同做合同审查并给出意见');
    expect(result.structured.task_type).toBe('document_processing');
  });
});
