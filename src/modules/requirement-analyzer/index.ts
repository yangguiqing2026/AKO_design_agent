// AKO_studio - Design Agent v1.0.0
// 文件名: src/modules/requirement-analyzer/index.ts
// 职责: 需求结构化分析（Sprint 1 P0）。
//   - 规则引擎把自然语言需求归一为 StructuredRequirement（LLM 超时/不可用时即此降级路径）
//   - 输出附带复杂度判断（simple/medium/complex）与关键词清单，供模式匹配与路由使用
//   - 关键词表可注入，便于按行业/语言扩展

import type { StructuredRequirement, TaskType } from '../../interfaces/design-context.interface';
import type { PatternComplexity } from '../../interfaces/pattern.interface';

/** 分析失败（输入为空等） */
export class RequirementAnalysisError extends Error {
  readonly code = 'REQUIREMENT_ANALYZE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'RequirementAnalysisError';
  }
}

/** 任务类型 → 触发关键词 */
export interface KeywordRule {
  readonly type: TaskType;
  readonly keywords: readonly string[];
}

/** 默认任务分类规则表 */
export const DEFAULT_TASK_RULES: readonly KeywordRule[] = [
  {
    type: 'coding',
    keywords: [
      '编写', '实现', '开发', '代码', '重构', '调试', '修bug', '修复', '函数', '算法',
      'python', 'javascript', 'typescript', '脚本', '写一个', '编程', '自动化脚本',
      'agent', 'prompt', '工作流', '单元测试'
    ]
  },
  {
    type: 'multi_step_planning',
    keywords: [
      '多步', '编排', '端到端', '规划', '流程', '分阶段', '管道', 'pipeline',
      '多agent', '协调', '流水线', '全流程', '递归', '反思迭代'
    ]
  },
  {
    type: 'data_analysis',
    keywords: [
      '数据分析', '报表', '可视化', '统计', '挖掘', '数据集', '表格', 'excel', 'csv',
      '图表', '洞察', '清洗数据', '模型训练', '指标'
    ]
  },
  {
    type: 'document_processing',
    keywords: [
      '文档', '总结', '翻译', '生成报告', '会议纪要', '提取', '整理成', 'markdown',
      'ppt', '白皮书', '问答对', '知识库文章'
    ]
  }
];

/** 类型判定的优先级（并列时取先者） */
const TASK_PRIORITY: readonly TaskType[] = [
  'coding',
  'multi_step_planning',
  'data_analysis',
  'document_processing',
  'other'
];

const NETWORK_HINTS = [
  '联网', '网络', '爬取', '抓取', 'api调用', '调用api', 'http', '请求接口', '拉取', '网页', '在线'
];
const SANDBOX_HINTS = [
  '沙箱', '隔离', '执行', '运行', '测试', '模拟', '危险', '只读环境', '容器'
];
const ADMIN_HINTS = ['部署', '安装', 'sudo', 'root', '系统级', '改配置', '运维', '启动服务'];
const EXTENSIBLE_HINTS = [
  '扩展', '可扩展', '插件', '模块化', '复用', '二次开发', '接入其他', '自定义工具'
];
const COMPLEX_HINTS = [
  '多agent', '架构设计', '生产级', '高可用', '多模块', '企业级', '复杂', '大规模'
];
const MULTI_STEP_HINTS = ['多步', '分阶段', '端到端', '规划', '流水线', '管道', 'pipeline', '编排'];
/** 网络否定表达（如“禁止访问外部网络/不可联网/离线”） */
const NETWORK_DENY_RE = /(禁止|不可|不能|不得|无需|不需要|无法|无)[^。，；]{0,10}?(联网|网络|访问外部|外网)/;
const NOTE_MARKERS = ['备注', '额外要求', '附加说明', '注意'];

export interface RequirementAnalysisResult {
  readonly structured: StructuredRequirement;
  readonly complexity: PatternComplexity;
  readonly matched_keywords: readonly string[];
  readonly confidence: number;
}

export interface RequirementAnalyzerOptions {
  readonly customRules?: readonly KeywordRule[];
}

function toLowerCaseSafe(text: string): string {
  return text.toLowerCase();
}

function countHits(text: string, keywords: readonly string[]): number {
  const lowered = toLowerCaseSafe(text);
  return keywords.reduce((acc, kw) => (lowered.includes(toLowerCaseSafe(kw)) ? acc + 1 : acc), 0);
}

function extractNumber(pattern: RegExp, text: string): number | undefined {
  const match = toLowerCaseSafe(text).match(pattern);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function computeConfidence(matchedKeywords: readonly string[], promptLength: number): number {
  if (promptLength < 10) {
    return 0.3;
  }
  const base = 0.5 + Math.min(matchedKeywords.length, 5) * 0.08;
  return Math.min(0.95, base);
}

function pickTaskType(text: string, rules: readonly KeywordRule[]): TaskType {
  const scores = rules.map((rule) => ({ type: rule.type, hits: countHits(text, rule.keywords) }));
  const maxHits = Math.max(0, ...scores.map((s) => s.hits));
  if (maxHits === 0) {
    return 'other';
  }
  const winners = scores.filter((s) => s.hits === maxHits).map((s) => s.type);
  const picked = TASK_PRIORITY.find((type) => winners.includes(type));
  return picked ?? 'other';
}

function computeComplexity(prompt: string, taskType: TaskType): PatternComplexity {
  const lowered = toLowerCaseSafe(prompt);
  if (COMPLEX_HINTS.some((h) => lowered.includes(h))) {
    return 'complex';
  }
  if (
    taskType === 'multi_step_planning' ||
    MULTI_STEP_HINTS.some((h) => lowered.includes(h)) ||
    prompt.length > 180
  ) {
    return 'medium';
  }
  return 'simple';
}

function extractNotes(prompt: string): string | undefined {
  const lowered = toLowerCaseSafe(prompt);
  for (const marker of NOTE_MARKERS) {
    const idx = lowered.indexOf(marker);
    if (idx >= 0) {
      const raw = prompt.slice(idx + marker.length).replace(/^[：:\s]+/, '').trim();
      if (raw.length > 0) {
        return raw;
      }
    }
  }
  return undefined;
}

export class RequirementAnalyzer {
  private readonly rules: readonly KeywordRule[];

  constructor(options: RequirementAnalyzerOptions = {}) {
    this.rules = options.customRules ?? DEFAULT_TASK_RULES;
  }

  /**
   * 将自然语言需求结构化为 StructuredRequirement。
   * 输出为纯函数式决策，确定性可测；多义词/歧义通过 confidence 显式暴露。
   */
  analyze(prompt: string): RequirementAnalysisResult {
    const text = prompt.trim();
    if (text.length === 0) {
      throw new RequirementAnalysisError('需求输入为空，无法分析');
    }

    const taskType = pickTaskType(text, this.rules);
    const matchedKeywords = this.collectMatchedKeywords(text);
    const networkHint = NETWORK_HINTS.some((h) => toLowerCaseSafe(text).includes(h));
    const networkDenied = NETWORK_DENY_RE.test(toLowerCaseSafe(text));
    const networkAccess = networkHint && !networkDenied;
    const sandboxRequired = SANDBOX_HINTS.some((h) => toLowerCaseSafe(text).includes(h));
    const adminHint = ADMIN_HINTS.some((h) => toLowerCaseSafe(text).includes(h));
    const permissionLevel: 'read_only' | 'read_write' | 'admin' = adminHint
      ? 'admin'
      : networkAccess || sandboxRequired || taskType === 'coding'
        ? 'read_write'
        : 'read_only';

    const concurrency = extractNumber(/(\d+)\s*(?:并发|并发数|concurrency)/i, text);
    const maxLatencyMs = extractNumber(/(\d+)\s*(?:ms|毫秒|延迟|latency)/i, text);
    const costBudgetUsd = extractNumber(/\$\s*(\d+(?:\.\d+)?)/i, text);

    const extensibilityExpected = EXTENSIBLE_HINTS.some((h) => toLowerCaseSafe(text).includes(h));

    const structured: StructuredRequirement = {
      task_type: taskType,
      environment: {
        network_access: networkAccess,
        sandbox_required: sandboxRequired,
        permission_level: permissionLevel
      },
      performance: {
        ...(concurrency !== undefined ? { concurrency } : {}),
        ...(maxLatencyMs !== undefined ? { max_latency_ms: maxLatencyMs } : {}),
        ...(costBudgetUsd !== undefined ? { cost_budget_usd: costBudgetUsd } : {})
      },
      extensibility_expected: extensibilityExpected,
      ...(extractNotes(text) !== undefined ? { additional_notes: extractNotes(text) } : {})
    };

    return {
      structured,
      complexity: computeComplexity(text, taskType),
      matched_keywords: matchedKeywords,
      confidence: computeConfidence(matchedKeywords, text.length)
    };
  }

  /** 汇总命中的关键词（仅用于匹配回溯/日志），规则判定只依赖计数 */
  private collectMatchedKeywords(text: string): string[] {
    const lowered = toLowerCaseSafe(text);
    const all: string[] = [];
    const seen = new Set<string>();
    const addKeyword = (kw: string): void => {
      if (!seen.has(kw) && lowered.includes(toLowerCaseSafe(kw))) {
        seen.add(kw);
        all.push(kw);
      }
    };
    for (const rule of this.rules) {
      rule.keywords.forEach(addKeyword);
    }
    for (const group of [NETWORK_HINTS, SANDBOX_HINTS, ADMIN_HINTS, EXTENSIBLE_HINTS, COMPLEX_HINTS, MULTI_STEP_HINTS]) {
      group.forEach(addKeyword);
    }
    return all;
  }
}
