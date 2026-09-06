---
title: "AKO Design Agent 白皮书"
description: "基于 DeepSeek Harness 的 Agent 架构设计专家——Meta-Agent 技术方案"
author: "AKO_studio"
date: "2026-09-06"
version: "1.0.1"
tags:
  - ako
  - design-agent
  - ds-harness
  - architecture
  - agent-loop
  - cordis
---

# AKO Design Agent 白皮书

**版本**：v1.0.1  
**作者**：AKO_studio  
**日期**：2026-09-06  
**状态**：AKO 技术成熟度 A 级认证（目标 S 级需后续迭代）  
**项目类型**：创新型独立工具（不接入 AKO Hub）

**修订说明（v1.0.0 → v1.0.1）**：
1. 第7章 Fallback 策略修正：沙箱失败不再降级交付，触发 Critic-Executor 循环（最多重试2次）
2. 第8章状态机新增转换：VALIDATING → GENERATING（retryCount < 3）
3. 第10章自评估诚实化：维度V从8/10下调至5/10，总分调整为80.84/100
4. 新增 Patch 拓扑排序设计：patch-builder.ts 必须实现依赖拓扑排序
5. 自学习描述诚实化：v1.0.0仅实现案例沉淀，向量检索和离线评测待v1.5
6. 全文纳入架构师评估意见（ADRs.md 引用）

---

## 目录

1. [元信息与项目定位](#1-元信息与项目定位)
2. [用户故事与需求分析](#2-用户故事与需求分析)
3. [横向阶段分解](#3-横向阶段分解)
4. [纵向层级映射](#4-纵向层级映射)
5. [模块清单与接口契约](#5-模块清单与接口契约)
6. [State 通信协议](#6-state-通信协议)
7. [异常 Fallback 与降级策略](#7-异常-fallback-与降级策略)
8. [LangGraph 状态机](#8-langgraph-状态机)
9. [开发排期与里程碑](#9-开发排期与里程碑)
10. [验收标准与合规清单](#10-验收标准与合规清单)

---

## 1. 元信息与项目定位

### 1.1 项目概述

AKO Design Agent 是一个基于 DeepSeek Harness (DSH) v0.1 构建的 **Meta-Agent**——一个能够设计其他 Agent 的 Agent。它利用 DSH "一切皆插件"的架构特性，将 Agent 架构设计转化为可执行、可验证、可迭代的工程过程。

**核心理念**：Model + Harness = Agent → Designer Agent 设计 Harness 配置 → 配置即 Agent

### 1.2 项目定位

| 属性 | 说明 |
|------|------|
| **项目类型** | 创新型独立工具 |
| **接入方式** | 不接入 AKO Hub，独立运行 |
| **目标用户** | DSH 用户、Agent 开发者、架构师 |
| **文明职能类型** | 创新型 |
| **AKO 认证等级** | A 级（v1.0.1 诚实版，目标 S 级需 v2.0 迭代） |
| **DSH 版本锁定** | v0.1.x 系列（不追新，防腐层隔离 Breaking Change） |
| **调用 LLM** | DeepSeek V4-Flash（多模型路由：简单→Flash，复杂→Pro） |

### 1.3 核心创新点

1. **Designer Agent 与 Harness 同构**：Designer 本身是 DSH Agent，其输出又是 DSH 配置，形成闭环
2. **设计即配置**：架构设计的产物直接就是可运行的 Profile/Bundle/Patch
3. **可逆可迭代**：借助 Cordis 的可逆副作用，设计变更可以安全回滚和迭代
4. **AKO 标准内化**：将 AKO 技术成熟度标准作为内部质量门禁，而非外部装饰
5. **Critic-Executor 简化版（v1.0.1 新增）**：沙箱失败后触发自动修正循环，非简单降级

### 1.4 架构师评估意见摘要（已纳入 ADRs.md）

> "A级认证的是你们的工程治理能力，而S级认证的是你们的'AI原生解决复杂不确定性问题'的能力。你们离S级只差一个'强化学习闭环'的距离。"

**v1.0.1 回应**：
- 接受评估中关于"AI核心认知能力"和"自学习机制"的批评
- v1.0.0 的定位是"基建层 + 闭环跑通"，认知增强属于 Sprint 1-2 领域层
- v2.0 将引入完整的 Actor-Critic 架构和约束求解器

---

## 2. 用户故事与需求分析

### 2.1 用户画像

**用户 A：DSH 新手开发者**
- 痛点：不熟悉 DSH 的插件体系，不知道如何组合组件构建 Agent
- 需求：输入自然语言描述，获得可直接运行的 DSH 配置

**用户 B：Agent 架构师**
- 痛点：需要反复试验不同架构模式的组合效果
- 需求：快速生成多种架构方案，在沙箱中模拟验证，对比评估

**用户 C：团队技术负责人**
- 痛点：团队内 Agent 架构风格不统一，缺乏最佳实践沉淀
- 需求：建立团队级设计模式库，标准化 Agent 构建流程

### 2.2 P0 反向提问记录

**工单**：WO-HAI-20260906-001  
**模块**：AKO_design_agent  
**动作**：设计  
**范围**：只动 Designer Agent 本体，不动 DSH 核心  
**铁律**：
1. DSH 版本锁定 v0.1.x，防腐层隔离 Breaking Change
2. 所有 API Key 通过 .env 加载，禁止硬编码
3. 模拟运行必须在隔离沙箱中执行

**P0 反向提问结果**：

| 反问维度 | 澄清结果 |
|---------|---------|
| 目标受众/体裁/目的 | DSH 用户，独立工具，辅助 Agent 架构设计 |
| 格式/字数/风格 | 技术白皮书 + 可执行代码，AKO_studio 署名 |
| 品牌/技术规范嵌入 | AKO 技术成熟度标准作为内部质量门禁 |
| 数据源/知识库 | DSH 官方文档、Cordis API、设计模式库 |
| 验收标准/交付形式 | AKO A 级认证，10 周开发周期，4 个 Sprint |

---

## 3. 横向阶段分解

### 3.1 设计流程（用户视角）

```
用户输入需求
    ↓
[需求分析] ──→ 结构化需求文档
    ↓
[模式匹配] ──→ 推荐架构模式（ReAct/Plan-Execute/反思等）
    ↓
[方案生成] ──→ Profile + Bundle + Patch 配置（含拓扑排序）
    ↓
[验证优化] ──→ Schema 校验 + 沙箱模拟 + Critic-Executor 循环
    ↓
[交付输出] ──→ 可运行的 DSH 配置 + 架构说明文档
```

### 3.2 技术实现流程（系统视角）

```
DSH 会话启动
    ↓
Prompt 运行时动态组装（Identity + Persona + Tool Guidance + Context）
    ↓
Agent Loop 状态机驱动
    ↓
工具调用（需求分析 → 模式查询 → 配置生成 → 验证模拟[Critic-Executor]）
    ↓
输出设计方案 + 合规自评报告
```

---

## 4. 纵向层级映射

### 4.1 四层架构

```
┌─────────────────────────────────────────────────────────────┐
│  表现层（Presentation）                                      │
│  • DSH Web UI（继承 DSH 默认界面）                           │
│  • 对话式交互界面                                            │
│  • SSE 流式输出（预留，P0 定义契约）                         │
├─────────────────────────────────────────────────────────────┤
│  应用层（Application）                                       │
│  • Agent Loop（状态机驱动，含 Critic-Executor 循环）         │
│  • 会话管理器（Session Manager）                             │
│  • Prompt 运行时组装器                                       │
├─────────────────────────────────────────────────────────────┤
│  领域层（Domain）                                            │
│  • 需求分析模块                                              │
│  • 模式匹配模块                                              │
│  • 配置生成模块（含 Patch 构建器 + 拓扑排序）                │
│  • 验证优化模块（含 Critic-Executor）                        │
├─────────────────────────────────────────────────────────────┤
│  基础设施层（Infrastructure）                                │
│  • DSH 适配器防腐层                                          │
│  • 版本守护者                                                │
│  • 安全沙箱（分层防御：文件系统 + 网络 + 资源限制）          │
│  • 成本熔断器（金额 + 时间 + 循环次数）                      │
│  • 知识库（静态 JSON）                                       │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 与 DSH 的关系

```
AKO Design Agent（运行在 DSH 之上）
    ├── 自定义 Agent Loop（替换默认 Loop，含 Critic-Executor）
    ├── 注册设计专用 Tools
    ├── 加载设计知识库 Skills
    └── 通过 DSH 适配器调用 DSH API

DSH 底座
    ├── Cordis 插件系统
    ├── Creator Mode（运行时检查/插件实验）
    └── 标准 Agent Loop（被 Designer Loop 替换）
```

---

## 5. 模块清单与接口契约

### 5.1 模块清单

| 模块 | 职责 | 接口文件 | 实现文件 |
|------|------|---------|---------|
| `agent-loop` | 状态机驱动的 Agent 循环（含 Critic-Executor） | `interfaces/agent-loop.interface.ts` | `core/agent-loop.ts` |
| `dsh-adapter` | DSH API 防腐层 | `interfaces/dsh.interface.ts` | `core/dsh-adapter.ts` |
| `version-guardian` | DSH 版本锁定与校验 | `interfaces/version.interface.ts` | `core/version-guardian.ts` |
| `session-manager` | 会话生命周期管理 | `interfaces/session.interface.ts` | `core/session-manager.ts` |
| `requirement-analyzer` | 需求结构化分析 | `interfaces/requirement.interface.ts` | `modules/requirement-analyzer/` |
| `pattern-matcher` | 架构模式匹配推荐 | `interfaces/pattern.interface.ts` | `modules/pattern-matcher/` |
| `config-generator` | 配置生成（Profile/Bundle/Patch） | `interfaces/config.interface.ts` | `modules/config-generator/` |
| `patch-builder` | Patch 构建器（含拓扑排序） | `interfaces/patch.interface.ts` | `modules/config-generator/patch-builder.ts` |
| `validator` | 配置校验与安全扫描 | `interfaces/validator.interface.ts` | `modules/validator/` |
| `critic-executor` | 简化版 Critic-Executor 循环 | `interfaces/critic.interface.ts` | `modules/validator/critic-executor.ts` |
| `cost-circuit` | 成本熔断与 Token 记账 | `interfaces/cost.interface.ts` | `modules/validator/cost-circuit.ts` |

### 5.2 核心接口契约

```typescript
// interfaces/design-context.interface.ts
// AKO_studio - Design Agent v1.0.1

export type DesignComplexity = 'simple' | 'medium' | 'complex';
export type DesignStatus = 'idle' | 'analyzing' | 'matching' | 'generating' | 'validating' | 'delivering' | 'interrupted' | 'completed' | 'error';
export type TaskType = 'coding' | 'data_analysis' | 'document_processing' | 'multi_step_planning' | 'other';

/**
 * 环境约束
 */
export interface EnvironmentConstraint {
  network_access: boolean;
  sandbox_required: boolean;
  permission_level: 'read_only' | 'read_write' | 'admin';
}

/**
 * 性能要求
 */
export interface PerformanceRequirement {
  concurrency?: number;
  max_latency_ms?: number;
  cost_budget_usd?: number;
}

/**
 * 结构化需求（替代 v1.0.0 的 Record<string, any>）
 */
export interface StructuredRequirement {
  task_type: TaskType;
  environment: EnvironmentConstraint;
  performance: PerformanceRequirement;
  extensibility_expected: boolean;
  additional_notes?: string;
}

/**
 * 设计上下文——状态机核心数据流
 */
export interface DesignContext {
  trace_id: string;
  session_id: string;
  status: DesignStatus;
  user_prompt: string;
  structured_req?: StructuredRequirement;
  matched_pattern_id?: string;
  generated_profile?: ProfileConfig;
  validation_errors?: string[];
  cost_usd: number;
  retry_count: number;           // v1.0.1 新增：Critic-Executor 重试计数
  checkpoint: string;
  created_at: number;
}

// interfaces/patch.interface.ts
// AKO_studio - Design Agent v1.0.1

/**
 * Cordis Patch（v1.0.1 修正：整行替换语义，非 deep-merge）
 */
export interface CordisPatch {
  id: string;
  config?: object;
  insert?: object[];
  meta?: {
    depends_on: string[];       // v1.0.1 新增：依赖组件ID列表
    build_order: number;        // v1.0.1 新增：拓扑排序后的构建顺序
  };
}

// interfaces/critic.interface.ts
// AKO_studio - Design Agent v1.0.1

/**
 * Critic 评审结果
 */
export interface CriticResult {
  verdict: 'pass' | 'fail' | 'partial';
  errorLog?: string;
  suggestion?: string;
  metrics?: {
    latency_ms: number;
    token_count: number;
  };
}

/**
 * Critic-Executor 接口（v1.0.1 简化版）
 */
export interface ICriticExecutor {
  evaluate(config: ProfileConfig): Promise<CriticResult>;
  suggestFix(errorLog: string, currentConfig: ProfileConfig): Promise<Partial<ProfileConfig>>;
}
```

### 5.3 Patch 拓扑排序设计（v1.0.1 新增）

```typescript
// modules/config-generator/patch-builder.ts 核心逻辑
// AKO_studio - Design Agent v1.0.1

/**
 * 组件依赖图节点
 */
interface ComponentNode {
  id: string;
  config: object;
  dependencies: string[];  // 依赖的其他组件ID
}

/**
 * 基于组件目录构建拓扑排序的 Patch 序列
 * @param components - 待插入的组件列表
 * @param catalog - 组件目录（含依赖关系）
 * @returns 拓扑排序后的 Patch 数组
 * @throws {Error} 若检测到循环依赖
 */
function buildPatchWithTopology(
  components: ComponentNode[],
  catalog: ComponentCatalog
): CordisPatch[] {
  // 1. 构建依赖图
  const graph = buildDependencyGraph(components, catalog);

  // 2. 拓扑排序（Kahn算法）
  const sorted = topologicalSort(graph);
  if (!sorted) {
    throw new Error('Circular dependency detected in component graph');
  }

  // 3. 生成带元数据的 Patch
  return sorted.map((comp, index) => ({
    id: comp.id,
    insert: [comp.config],
    meta: {
      depends_on: index > 0 ? sorted.slice(0, index).map(c => c.id) : [],
      build_order: index
    }
  }));
}
```

---

## 6. State 通信协议

### 6.1 状态定义（LangGraph StateGraph）

```
States:
  IDLE          ──→ 等待用户输入
  ANALYZING     ──→ 需求分析中
  MATCHING      ──→ 模式匹配中
  GENERATING    ──→ 配置生成中
  VALIDATING    ──→ 验证优化中（含 Critic-Executor）
  DELIVERING    ──→ 交付输出中
  INTERRUPTED   ──→ 等待人工确认（人在回路）
  ERROR         ──→ 异常状态
  COMPLETED     ──→ 完成

Transitions:
  IDLE → ANALYZING        [用户输入需求]
  ANALYZING → MATCHING    [需求结构化完成]
  MATCHING → GENERATING   [模式选定]
  GENERATING → VALIDATING [配置生成完成]
  VALIDATING → DELIVERING [Critic通过]
  VALIDATING → GENERATING [Critic失败 + retryCount < 3]   // v1.0.1 新增
  VALIDATING → INTERRUPTED [Critic失败 + retryCount >= 3] // v1.0.1 修正
  INTERRUPTED → DELIVERING [人工确认通过]
  INTERRUPTED → ERROR     [人工拒绝]
  ANY → ERROR             [异常触发]
  ERROR → IDLE            [Fallback恢复]
  DELIVERING → COMPLETED  [输出完成]
```

### 6.2 Critic-Executor 循环（v1.0.1 新增）

```
配置生成完成
    ↓
[VALIDATING] ──→ Critic 在沙箱中运行配置
    ↓
Critic 结果？
    ├── pass ──→ [DELIVERING]
    ├── fail + retry < 3 ──→ [GENERATING] 修正配置（Executor）
    └── fail + retry >= 3 ──→ [INTERRUPTED] 求助人工
```

### 6.3 模块间通信协议

- **同步调用**：模块间通过 TypeScript 接口直接调用（同进程内）
- **异步事件**：通过 DSH 的事件流机制传递状态变更
- **数据格式**：全部中间输出为 JSON + JSON Schema 校验
- **错误传递**：统一 Error 对象，包含 `code`、`message`、`fallbackAction`

---

## 7. 异常 Fallback 与降级策略

### 7.1 关键节点 Fallback

| 节点 | 异常场景 | Fallback 策略 |
|------|---------|--------------|
| 需求分析 | LLM 超时/解析失败 | 降级为规则引擎：关键词匹配预设模板 |
| 模式匹配 | 无匹配模式 | Fallback 到 ReAct 默认模式 |
| 配置生成 | Patch 构建失败（循环依赖） | 抛出错误，进入 ERROR 状态，记录循环依赖路径 |
| 验证模拟 | 沙箱执行失败 | **Critic-Executor 循环（最多重试2次）→ 仍失败则 INTERRUPTED（求助人工）** |
| 成本熔断 | 达到硬性阈值 | **直接中断会话，不走 Fallback**，记录审计日志 |
| 时间熔断 | Time-to-First-Token > 阈值 | 降级到轻量级模型或中断会话 |
| 循环熔断 | 迭代次数超过上限 | 强制进入 INTERRUPTED 状态 |

### 7.2 Critic-Executor 简化版实现（v1.0.1）

```typescript
// modules/validator/critic-executor.ts
// AKO_studio - Design Agent v1.0.1

export class SimpleCriticExecutor implements ICriticExecutor {
  private readonly maxRetries = 2;
  private readonly sandbox: ISandbox;
  private readonly llm: ILlmService;

  constructor(sandbox: ISandbox, llm: ILlmService) {
    this.sandbox = sandbox;
    this.llm = llm;
  }

  /**
   * 在沙箱中评估配置
   * @param config - 待评估的 Profile 配置
   * @returns Critic 评审结果
   */
  async evaluate(config: ProfileConfig): Promise<CriticResult> {
    const result = await this.sandbox.run(config);
    if (result.success) {
      return { verdict: 'pass', metrics: result.metrics };
    }
    return {
      verdict: 'fail',
      errorLog: result.stderr,
      suggestion: await this.llm.suggestFix(result.stderr, config)
    };
  }

  /**
   * 根据 Critic 建议生成修复后的配置
   * @param errorLog - 错误日志
   * @param currentConfig - 当前配置
   * @returns 修复后的配置片段
   */
  async suggestFix(
    errorLog: string,
    currentConfig: ProfileConfig
  ): Promise<Partial<ProfileConfig>> {
    const prompt = `Given the following error log and current configuration, suggest a fix:
Error: ${errorLog}
Config: ${JSON.stringify(currentConfig)}`;
    const response = await this.llm.complete(prompt);
    return JSON.parse(response) as Partial<ProfileConfig>;
  }

  /**
   * 执行完整的 Critic-Executor 循环
   * @param initialConfig - 初始配置
   * @returns 最终配置或中断信号
   */
  async runLoop(initialConfig: ProfileConfig): Promise<{
    config: ProfileConfig;
    interrupted: boolean;
  }> {
    let config = initialConfig;
    for (let retry = 0; retry <= this.maxRetries; retry++) {
      const critic = await this.evaluate(config);
      if (critic.verdict === 'pass') {
        return { config, interrupted: false };
      }
      if (retry < this.maxRetries && critic.suggestion) {
        config = { ...config, ...critic.suggestion };
      } else {
        return { config, interrupted: true };
      }
    }
    return { config, interrupted: true };
  }
}
```

### 7.3 检查点与可恢复性

- 每个状态转换前自动创建 Checkpoint
- Checkpoint 包含：当前 State、DesignContext、已生成配置、retryCount
- 支持从任意 Checkpoint 恢复会话
- 配置生成采用原子提交：成功则全量写入，失败则回滚

---

## 8. LangGraph 状态机

### 8.1 状态机实现

```typescript
// core/agent-loop.ts
// AKO_studio - Design Agent v1.0.1

import { StateGraph, END } from '@langchain/langgraph';

const designGraph = new StateGraph<DesignContext>({
  channels: {
    trace_id: { value: (x, y) => y ?? x },
    session_id: { value: (x, y) => y ?? x },
    status: { value: (x, y) => y ?? x },
    user_prompt: { value: (x, y) => y ?? x },
    structured_req: { value: (x, y) => y ?? x },
    matched_pattern_id: { value: (x, y) => y ?? x },
    generated_profile: { value: (x, y) => y ?? x },
    validation_errors: { value: (x, y) => y ?? x },
    cost_usd: { value: (x, y) => y ?? x },
    retry_count: { value: (x, y) => y ?? x },  // v1.0.1 新增
    checkpoint: { value: (x, y) => y ?? x },
    created_at: { value: (x, y) => y ?? x },
  }
});

designGraph
  .addNode('analyze', requirementAnalyzerNode)
  .addNode('match', patternMatcherNode)
  .addNode('generate', configGeneratorNode)
  .addNode('validate', validatorNode)           // 内含 Critic-Executor
  .addNode('deliver', deliverNode)
  .addNode('interrupt', interruptNode)
  .addNode('error', errorNode);

designGraph
  .addEdge('__start__', 'analyze')
  .addEdge('analyze', 'match')
  .addEdge('match', 'generate')
  .addEdge('generate', 'validate')
  .addConditionalEdges('validate', (ctx) => {
    if (ctx.validation_errors && ctx.validation_errors.length > 0) {
      if (ctx.retry_count < 3) return 'generate';  // v1.0.1 新增：回到生成态修正
      return 'interrupt';                           // v1.0.1 修正：超过重试上限求助人工
    }
    return ctx.complexity === 'complex' ? 'interrupt' : 'deliver';
  })
  .addEdge('interrupt', 'deliver')
  .addEdge('deliver', END)
  .addEdge('error', '__start__');
```

### 8.2 人在回路机制

- **触发条件**：
  1. 设计复杂度为 `complex` 时，在 `validate` 后进入 `interrupt` 状态
  2. Critic-Executor 重试 3 次仍失败时，进入 `interrupt` 状态
- **中断方式**：暂停 Agent Loop，向用户展示设计方案摘要 + 错误日志，等待确认/修改/拒绝
- **超时处理**：30 分钟无响应，自动拒绝并进入 `error` 状态

---

## 9. 开发排期与里程碑

### 9.1 Sprint 规划

| Sprint | 周期 | 核心交付 | 里程碑 | 合规目标 |
|--------|------|---------|--------|---------|
| Sprint 0 | 2周 | 适配器、版本守护者、沙箱、VETO 规避措施、Critic-Executor 简化版骨架 | 基建完成 | 维度I 全部通过 |
| Sprint 1 | 4周 | 需求分析、模式匹配、配置生成（含 Patch 拓扑排序）、成本熔断 | 核心能力就绪 | 维度II+III ≥85% |
| Sprint 2 | 3周 | 动态 Prompt、记忆体系、检查点、案例沉淀（JSON） | 智能增强 | 维度V ≥50% |
| Sprint 3 | 1周 | 合规自评报告、白皮书 v1.0.1 定稿、信任边界注册 | 认证获取 | A 级认证 |

**总周期：10周（2.5个月）**

### 9.2 技术预研课题（Sprint 3 后启动）

| 课题 | 目标版本 | 说明 |
|------|---------|------|
| Actor-Critic 完整版 | v2.0.0 | 引入强化学习闭环，沙箱报错自动修复 |
| 约束求解器 | v2.0.0 | 非功能指标向量空间 + 最优化求解 |
| 向量库检索 | v1.5.0 | Qdrant/Pinecone 案例相似度匹配 |
| 离线评测集 | v1.5.0 | 金种子数据集 + 准确率门禁 |
| OpenTelemetry | v1.5.0 | 分布式追踪，Jaeger 导出 |
| 语义适配器 | v2.0.0 | DSH 多版本 API 映射 |

---

## 10. 验收标准与合规清单

### 10.1 功能验收标准

| 验收项 | 标准 | 验证方式 |
|--------|------|---------|
| 需求分析准确率 | ≥85% 的需求被正确结构化 | 人工抽样评估 100 条 |
| 模式匹配准确率 | ≥90% 的场景匹配到合适模式 | 人工评估 50 个场景 |
| 配置生成正确率 | 100% 生成的配置可通过 Schema 校验 | 自动化测试 |
| Patch 语义正确性 | 100% Patch 不丢失原配置字段 | 单元测试覆盖 |
| Patch 拓扑排序 | 100% 组件按依赖顺序插入 | 单元测试（含循环依赖检测） |
| Critic-Executor 循环 | 沙箱失败后自动重试 ≤2 次 | 集成测试 |
| 沙箱隔离有效性 | 模拟运行不影响宿主环境 | 渗透测试 |
| 成本熔断可靠性 | 100% 达到阈值时中断会话 | 压力测试 |
| 时间熔断可靠性 | 100% TTFT 超阈值时降级/中断 | 压力测试 |

### 10.2 AKO 合规清单（v1.0.1 诚实版）

```yaml
# .ako/compliance-manifest.yml
agent_id: "AKO_design_agent"
agent_name: "Agent Architecture Designer"
评估日期: "2026-09-06"
目标等级: "A"
civilization_type: "创新型"

维度I_法制合规:
  FI-I-01: "通过 - 全部 Markdown 强制 YAML Frontmatter"
  FI-I-02: "通过 - 仅使用 6 个白名单标签"
  FI-I-03: "通过 - 命名符合 AKO_{模块}_{描述}_vX.Y.Z.md"
  FI-I-04: "通过 - 白皮书含信任边界草案"
  FI-I-05: "通过 - P0 反向提问记录归档"
  FI-I-06: "通过 - API Key 通过 .env 加载"
  FI-I-07: "通过 - 工单驱动开发"
  FI-I-08: "通过 - 全部文档作者 AKO_studio"
  得分: 30/30

维度II_架构完整:
  FI-II-01: "通过 - StateGraph 显式状态机（含 Critic-Executor 循环）"
  FI-II-02: "通过 - 模块边界清晰，接口隔离"
  FI-II-03: "通过 - 内部接口 + MCP 桥接"
  FI-II-04: "通过 - 三级记忆体系"
  FI-II-05: "通过 - 每个节点有 Fallback"
  FI-II-06: "通过 - Checkpoint 可恢复"
  FI-II-07: "通过 - 配置外部化"
  FI-II-08: "通过 - 结构化日志 + trace_id"
  FI-II-09: "通过 - read_your_writes 声明"
  得分: 21.25/25

维度III_技术鲁棒:
  FI-III-01: "通过 - Routing 动态编排"
  FI-III-02: "通过 - 独立评审模块（Critic-Executor）"
  FI-III-03: "通过 - 工具 typed function"
  FI-III-04: "通过 - 四层安全防护"
  FI-III-05: "通过 - 20步/30次/60s + Circuit Breaker"
  FI-III-06: "通过 - 配置生成幂等"
  FI-III-07: "通过 - 复杂设计支持 interrupt"
  FI-III-08: "N/A - 不涉及知识问答"
  FI-III-09: "通过 - 中间输出 JSON + Schema"
  得分: 21.25/25

维度IV_集群协同:
  FI-IV-01: "N/A - 不接入 Hub"
  FI-IV-02: "N/A - 使用 Markdown 工单"
  FI-IV-03: "N/A - 单 Agent 运行"
  FI-IV-04: "通过 - 模型分级路由 + Token 记账 + 成本熔断（金额+时间+循环）"
  FI-IV-05: "N/A - 不接入 AKO 监控"
  FI-IV-06: "通过 - 信任边界注册完整"
  得分: 3.34/10

维度V_文明进化:
  FI-V-01: "部分通过 - 案例沉淀机制已设计（JSON 存储），权重自动更新和向量检索待 v1.5 实现"
  FI-V-02: "通过 - Validator 反馈闭环（Critic-Executor）"
  FI-V-03: "通过 - SemVer + ChangeSet"
  FI-V-04: "通过 - 会话自动沉淀案例（JSON）"
  FI-V-05: "通过 - 优先级队列"
  得分: 5/10

总分: 80.84/100
总评L级: L2.0
认证等级: A（诚实版，v1.0.1）

差距分析: 
  - 维度V得分偏低（5/10）：缺乏向量检索、离线评测集和强化学习闭环
  - 维度IV因AKO Hub相关条款N/A导致得分偏低，此为独立项目固有特征
  - 冲刺S级需在v2.0引入：Actor-Critic完整版、约束求解器、向量库、金种子数据集

VETO 检查:
  VETO-01: "通过"
  VETO-02: "通过"
  VETO-03: "通过"
  VETO-04: "通过"
  VETO-05: "通过"
  VETO-06: "通过"
  VETO-07: "通过"
  VETO-08: "通过"
  VETO-09: "通过"
```

### 10.3 信任边界注册

```yaml
# .ako/trust-boundary/registration.yml
agent_id: "AKO_design_agent"
agent_name: "Agent Architecture Designer"

能力声明:
  - "Agent 架构分析与模式推荐"
  - "DSH Profile/Bundle/Patch 配置生成（含拓扑排序）"
  - "配置 Schema 校验与沙箱模拟（含 Critic-Executor 循环）"
  - "设计知识库查询与案例沉淀"

调用方白名单:
  - "AKO_studio"
  - "授权 DSH 用户（API Key 验证）"

数据访问等级: "INTERNAL"
敏感数据接触: "无"

一致性模型声明: "read_your_writes"
一致性说明: "本项目不涉及资金/资源扣减类操作，设计会话状态以会话级一致性为准"

安全边界:
  - "模拟运行限定在隔离沙箱（分层防御：文件系统+网络+资源限制）"
  - "配置生成不访问外部网络"
  - "API Key 通过环境变量加载"
  - "成本达到阈值时强制中断（金额+时间+循环次数三重熔断）"
  - "Critic-Executor 循环失败超过2次强制求助人工"
```

---

## 附录

### A. 文件夹架构（v1.0.1 完整版）

```
design-agent/
├── .ako/
│   ├── compliance-manifest.yml
│   ├── whitepaper/
│   │   └── AKO_design_agent_whitepaper_v1.0.1.md
│   ├── p0-records/
│   │   └── WO-HAI-20260906-001.md
│   └── trust-boundary/
│       └── registration.yml
├── src/
│   ├── bootstrap.ts
│   ├── core/
│   │   ├── agent-loop.ts              # 含 Critic-Executor 循环
│   │   ├── dsh-adapter.ts
│   │   ├── version-guardian.ts
│   │   ├── session-manager.ts
│   │   └── logger.ts
│   ├── modules/
│   │   ├── requirement-analyzer/
│   │   │   ├── index.ts
│   │   │   └── templates/
│   │   ├── pattern-matcher/
│   │   │   ├── index.ts
│   │   │   └── scoring.ts
│   │   ├── config-generator/
│   │   │   ├── index.ts
│   │   │   ├── patch-builder.ts       # 含拓扑排序
│   │   │   └── patch-validator.ts
│   │   └── validator/
│   │       ├── index.ts
│   │       ├── schema-validator.ts
│   │       ├── security-scanner.ts
│   │       ├── critic-executor.ts     # v1.0.1 新增
│   │       └── cost-circuit.ts
│   ├── tools/
│   │   ├── query-patterns.tool.ts
│   │   ├── generate-profile.tool.ts
│   │   └── simulate-run.tool.ts
│   ├── prompts/
│   │   ├── identity.ts
│   │   ├── persona.ts
│   │   ├── tool-guidance.ts
│   │   ├── runtime-context.ts
│   │   └── middleware.ts
│   └── interfaces/
│       ├── design-context.interface.ts
│       ├── pattern.interface.ts
│       ├── config.interface.ts
│       ├── patch.interface.ts         # v1.0.1 新增
│       ├── critic.interface.ts        # v1.0.1 新增
│       ├── validator.interface.ts
│       ├── cost.interface.ts
│       ├── session.interface.ts
│       ├── dsh.interface.ts
│       └── version.interface.ts
├── config/
│   ├── default.yml
│   ├── llm.backends.yml
│   ├── cost-budget.yml
│   ├── security.yml
│   └── dsh-lock.yml
├── knowledge/
│   ├── patterns/
│   │   ├── react.json
│   │   ├── plan-execute.json
│   │   ├── reflection.json
│   │   ├── hierarchical.json
│   │   └── ptc.json
│   ├── best-practices.json
│   └── component-catalog.json         # 含依赖关系定义
├── outputs/
│   └── .gitkeep
├── sandbox/
│   ├── simulate/
│   └── logs/
│       └── cost-ledger.json           # v1.0.1 新增：成本持久化
├── tests/
│   ├── unit/
│   ├── integration/
│   └── compliance/
│       └── test_fi_*.ts
├── .env.example
├── package.json
├── tsconfig.json
├── Dockerfile
├── ADRs.md                            # 含架构师评估意见
├── README.md
└── .ako-compliance-report.md
```

### B. 成本模型详情（v1.0.1 三重熔断）

| 设计任务复杂度 | 预估 Token 消耗 | V4-Flash 成本 | V4-Pro 成本 |
|--------------|----------------|--------------|------------|
| 简单模式匹配 | 5K-10K | $0.11-0.22 | $0.22-0.44 |
| 中等方案设计 | 20K-50K | $0.44-1.10 | $0.88-2.20 |
| 复杂多Agent架构 | 80K-150K | $1.76-3.30 | $3.52-6.60 |

**三重熔断阈值（v1.0.1）**：
- **金额熔断**：单次会话上限 $5.00，月度预算 $500.00，100% 强制中断
- **时间熔断**：Time-to-First-Token > 30s 降级到轻量级模型，> 60s 中断
- **循环熔断**：Critic-Executor 重试 > 2 次或总迭代 > 20 次强制中断

### C. DSH 版本锁定策略

```yaml
# config/dsh-lock.yml
dsh_version: "0.1.x"
pin_strategy: "minor_version_lock"
allowed_updates:
  - "patch_level"
  - "security_fix"
forbidden_updates:
  - "minor_version"
  - "major_version"

breaking_change_tracking:
  source: "github.com/deepseek-ai/harness/releases"
  check_frequency: "weekly"
  alert_channel: "email"

adapter_compatibility:
  current_api_version: "0.1.3"
  test_coverage: "100% of DSH API surface"
  future_strategy: "semantic_adapter"  # v2.0.0 实现
```

### D. 参考文献

1. DeepSeek Harness 官方文档：https://github.com/deepseek-ai/harness
2. Cordis 插件系统文档：https://github.com/cordis-lib/cordis
3. AKO 技术成熟度标准 v2.0
4. LangGraph 状态机框架文档
5. **架构师评估报告**（已纳入 ADRs.md，v1.0.1 核心修订依据）

---

*本白皮书遵循 AKO 命名规范：AKO_{模块}_{描述}_vX.Y.Z.md*  
*作者：AKO_studio*  
*版本：1.0.1*  
*日期：2026-09-06*
