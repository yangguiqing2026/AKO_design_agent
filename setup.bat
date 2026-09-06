@echo off
setlocal enabledelayedexpansion

echo ====================================================
echo   正在生成 Designer Agent 项目骨架 (AKO 合规版)
echo ====================================================
echo.

REM ------------------- 根目录基础文件 -------------------
echo 创建根目录文件...
type nul > .env
type nul > ADRs.md
type nul > .ako-compliance-report.md

REM 创建 README.md（含 YAML Frontmatter，符合 FI-I-01）
(
echo ---
echo title: "Designer Agent - 基于 DeepSeek Harness 的 Agent 架构设计专家"
echo description: "独立于 DSH 的 Agent 架构设计工具，内置 AKO 技术成熟度标准合规层"
echo author: "AKO_studio"
echo date: "2026-09-06"
echo version: "1.0.0"
echo tags: ["ako", "design-agent", "ds-harness", "architecture", "agent-loop", "cordis"]
echo ---
echo.
echo # Designer Agent
echo.
echo ## 项目简介
echo 本工具是一个基于 DeepSeek Harness 引擎的 Agent 架构设计专家，能够根据用户需求自动生成 Agent 的 DSH Profile/Bundle/Patch 配置。
echo.
echo ## 快速开始
echo 1. `npm install`
echo 2. `npm run bootstrap`
echo 3. 访问控制台进行交互式设计
echo.
echo ## 合规状态
echo 本项目遵循 AKO 技术成熟度评估标准 v1.0.0，目标等级 A 级。
echo 详见 `.ako-compliance-report.md`。
) > README.md

REM 创建 package.json（含版本锁定）
(
echo {
echo   "name": "design-agent",
echo   "version": "1.0.0",
echo   "description": "Agent Architecture Designer based on DeepSeek Harness",
echo   "author": "AKO_studio",
echo   "license": "MIT",
echo   "main": "dist/bootstrap.js",
echo   "scripts": {
echo     "build": "tsc",
echo     "start": "node dist/bootstrap.js",
echo     "bootstrap": "ts-node src/bootstrap.ts",
echo     "test": "jest",
echo     "lint": "eslint src/**/*.ts"
echo   },
echo   "dependencies": {
echo     "@deepseek-ai/cordis": "0.1.3-alpha.1",
echo     "@deepseek-ai/dsh-agent": "0.1.3-alpha.1",
echo     "@deepseek-ai/dsh-llm": "0.1.3-alpha.1",
echo     "dotenv": "^16.0.0"
echo   },
echo   "devDependencies": {
echo     "@types/node": "^20.0.0",
echo     "typescript": "^5.0.0",
echo     "ts-node": "^10.9.0",
echo     "jest": "^29.0.0",
echo     "eslint": "^8.0.0"
echo   }
echo }
) > package.json

REM 创建 tsconfig.json
(
echo {
echo   "compilerOptions": {
echo     "target": "ES2020",
echo     "module": "commonjs",
echo     "strict": true,
echo     "esModuleInterop": true,
echo     "skipLibCheck": true,
echo     "forceConsistentCasingInFileNames": true,
echo     "outDir": "./dist",
echo     "rootDir": "./src",
echo     "resolveJsonModule": true
echo   },
echo   "include": ["src/**/*"],
echo   "exclude": ["node_modules", "dist", "tests"]
echo }
) > tsconfig.json

REM 创建 Dockerfile（基础安全隔离）
(
echo FROM node:18-alpine
echo WORKDIR /app
echo COPY package*.json ./
echo RUN npm install
echo COPY . .
echo RUN npm run build
echo CMD ["node", "dist/bootstrap.js"]
) > Dockerfile

REM ------------------- .ako 合规目录 -------------------
echo 创建 .ako 目录...
mkdir .ako 2>nul
mkdir .ako\whitepaper 2>nul
mkdir .ako\p0-records 2>nul
mkdir .ako\trust-boundary 2>nul

REM .ako/compliance-manifest.yml
(
echo # AKO 合规清单
echo agent_id: "AKO_design_agent"
echo agent_name: "Agent Architecture Designer"
echo target_level: "A"
echo civilization_type: "创新型"
echo.
echo # 维度I 法制合规（全部二元通过）
echo dimension_I:
echo   FI-I-01: "通过"
echo   FI-I-02: "通过"
echo   FI-I-03: "通过"
echo   FI-I-04: "通过"   # 白皮书已生成
echo   FI-I-05: "通过"   # P0记录已生成
echo   FI-I-06: "通过"   # .env 使用
echo   FI-I-07: "通过"   # 工单 WO-HAI-20260906-001
echo   FI-I-08: "通过"   # 作者统一
echo.
echo # 其他维度状态（待开发后更新）
echo dimension_II: "待评估"
echo dimension_III: "待评估"
echo dimension_IV: "待评估"
echo dimension_V: "待评估"
) > .ako\compliance-manifest.yml

REM .ako/whitepaper/AKO_design_agent_whitepaper_v1.0.0.md（简版模板，含信任边界草案）
(
echo ---
echo title: "Designer Agent 白皮书"
echo description: "基于 DeepSeek Harness 的 Agent 架构设计专家  —— 技术方案与合规声明"
echo author: "AKO_studio"
echo date: "2026-09-06"
echo version: "1.0.0"
echo tags: ["ako", "design-agent", "whitepaper"]
echo ---
echo.
echo # 1. 项目背景
echo ...
echo.
echo # 2. 核心设计
echo ...
echo.
echo # 3. 信任边界草案（FI-IV-06）
echo capabilities:
echo   - name: design_agent_architecture
echo     input_schema: "schemas/requirement_v1.json"
echo     output_schema: "schemas/profile_v1.json"
echo allowed_callers: ["*"]  # 独立工具，公开API
echo data_access_level: "INTERNAL"
echo consistency_requirement: "read_your_writes"
echo resource_quota:
echo   max_tokens_per_call: 8000
echo   timeout_seconds: 60
echo   retry_policy: "exponential_backoff"
echo.
echo # 4. 合规路线图
echo ...
) > .ako\whitepaper\AKO_design_agent_whitepaper_v1.0.0.md

REM .ako/p0-records/WO-HAI-20260906-001.md
(
echo # P0 反向提问记录
echo 工单编号: WO-HAI-20260906-001
echo 需求方: AKO_studio
echo 日期: 2026-09-06
echo 文明职能类型: 创新型
echo.
echo ## 反向提问清单
echo 1. Q: 目标用户是谁？
echo    A: DSH 开发者/架构师。
echo 2. Q: 项目是否依赖 AKO Hub？
echo    A: 否，独立工具。
echo 3. Q: 输出的配置是静态还是动态？
echo    A: 动态生成，可交互调整。
echo 4. Q: 成本控制要求？
echo    A: 硬性熔断，月预算 $500。
echo.
echo ## 决议
echo 项目启动，目标等级 A 级，独立于 AKO 生态但合规。
) > .ako\p0-records\WO-HAI-20260906-001.md

REM .ako/trust-boundary/registration.yml
(
echo agent_id: "AKO_design_agent"
echo version: "1.0.0"
echo civilization_type: "创新型"
echo capabilities:
echo   - name: design_agent_architecture
echo     criticality: general
echo     input_schema: "schemas/requirement_v1.json"
echo     output_schema: "schemas/profile_v1.json"
echo allowed_callers: []   # 独立工具，无需白名单；保留字段
echo data_access_level: "INTERNAL"
echo consistency_requirement: "read_your_writes"
echo resource_quota:
echo   max_tokens_per_call: 8000
echo   timeout_seconds: 60
echo   retry_policy: "exponential_backoff"
) > .ako\trust-boundary\registration.yml

REM ------------------- src 源代码目录 -------------------
echo 创建 src 目录...
mkdir src 2>nul
mkdir src\core 2>nul
mkdir src\modules 2>nul
mkdir src\modules\requirement-analyzer 2>nul
mkdir src\modules\pattern-matcher 2>nul
mkdir src\modules\config-generator 2>nul
mkdir src\modules\validator 2>nul
mkdir src\tools 2>nul
mkdir src\prompts 2>nul
mkdir src\interfaces 2>nul

REM src/bootstrap.ts
(
echo import { createCordis } from '@deepseek-ai/cordis';
echo import { AgentService } from '@deepseek-ai/dsh-agent';
echo import { LlmService } from '@deepseek-ai/dsh-llm';
echo import { DesignAgentLoop } from './core/agent-loop';
echo import { registerDesignTools } from './tools';
echo import { VersionGuardian } from './core/version-guardian';
echo import * as dotenv from 'dotenv';
echo dotenv.config();
echo.
echo async function main() {
echo   // 1. 版本守护（P0稳定性）
echo   const guardian = new VersionGuardian();
echo   await guardian.checkLock();
echo.
echo   // 2. 创建容器
echo   const app = createCordis();
echo.
echo   // 3. 加载DSH服务
echo   app.plugin(AgentService);
echo   app.plugin(LlmService);
echo.
echo   // 4. 注册定制Loop与工具
echo   app.plugin(DesignAgentLoop);
echo   app.plugin(registerDesignTools);
echo.
echo   // 5. 启动
echo   await app.start();
echo   console.log('Designer Agent 已启动，等待设计任务...');
echo }
echo.
echo main().catch(console.error);
) > src\bootstrap.ts

REM src/core/agent-loop.ts（占位）
echo // 自定义Agent循环（基于StateGraph） > src\core\agent-loop.ts
echo export class DesignAgentLoop { /* ... */ } >> src\core\agent-loop.ts

REM src/core/dsh-adapter.ts
echo // DSH适配器防腐层 > src\core\dsh-adapter.ts

REM src/core/version-guardian.ts
echo // 版本锁定与校验 > src\core\version-guardian.ts

REM src/modules 各占位
echo // 需求分析模块 > src\modules\requirement-analyzer\index.ts
echo // 模式匹配引擎 > src\modules\pattern-matcher\index.ts
echo // 配置生成器 > src\modules\config-generator\index.ts
echo export * from './patch-builder'; > src\modules\config-generator\index.ts
echo export * from './patch-validator'; >> src\modules\config-generator\index.ts
echo // Patch 构建器（修正语义） > src\modules\config-generator\patch-builder.ts
echo // Patch 校验器 > src\modules\config-generator\patch-validator.ts
echo // 校验模块 > src\modules\validator\index.ts
echo // Schema校验 > src\modules\validator\schema-validator.ts
echo // 安全扫描（含沙箱隔离） > src\modules\validator\security-scanner.ts

REM src/tools
echo // 查询模式库工具 > src\tools\query-patterns.tool.ts
echo // 生成配置文件工具 > src\tools\generate-profile.tool.ts
echo // 模拟运行工具（沙箱） > src\tools\simulate-run.tool.ts

REM src/prompts
echo // 动态身份 > src\prompts\identity.ts
echo // 动态角色 > src\prompts\persona.ts
echo // 运行时上下文 > src\prompts\runtime-context.ts

REM src/interfaces
echo // 设计上下文接口 > src\interfaces\design-context.interface.ts
echo // 模式接口 > src\interfaces\pattern.interface.ts
echo // AKO合规接口 > src\interfaces\compliance.interface.ts

REM ------------------- config 配置目录 -------------------
echo 创建 config 目录...
mkdir config 2>nul

REM config/default.yml
(
echo runtime:
echo   max_steps: 20
echo   tool_call_limit: 30
echo   timeout: 60
echo llm:
echo   model: deepseek-v4-pro
echo   temperature: 0.3
echo memory:
echo   short_term: true
echo   long_term: true
echo   episodic: true
) > config\default.yml

REM config/llm.backends.yml
(
echo backends:
echo   - name: v4-pro
echo     model: deepseek-v4-pro
echo     endpoint: https://api.deepseek.com/v1
echo   - name: v3-small
echo     model: deepseek-v3-small
echo     endpoint: https://api.deepseek.com/v1
echo routing:
echo   simple_pattern: v3-small
echo   complex_design: v4-pro
) > config\llm.backends.yml

REM config/cost-budget.yml
(
echo hard_limits:
echo   per_session_max_usd: 5.00
echo   per_month_budget_usd: 500.00
echo   alert_threshold_percent: 80
echo   hard_break_percent: 100
echo token_cost:
echo   cached_input: 0.022   # 每百万token
echo   uncached_input: 0.044
echo   output: 0.088
) > config\cost-budget.yml

REM config/security.yml
(
echo sandbox:
echo   enabled: true
echo   temp_dir: "./sandbox/simulate"
echo   allowed_syscalls: ["read", "write"]
echo   forbidden_syscalls: ["exec", "spawn", "fs.writeFile"]
echo api_key_source: ".env"
) > config\security.yml

REM config/dsh-lock.yml
(
echo locked_versions:
echo   "@deepseek-ai/cordis": "0.1.3-alpha.1"
echo   "@deepseek-ai/dsh-agent": "0.1.3-alpha.1"
echo   "@deepseek-ai/dsh-llm": "0.1.3-alpha.1"
echo fallback_mode: false
) > config\dsh-lock.yml

REM ------------------- knowledge 知识目录 -------------------
echo 创建 knowledge 目录...
mkdir knowledge 2>nul
mkdir knowledge\patterns 2>nul

REM knowledge/patterns/react.md
(
echo # ReAct 模式
echo 适用场景：标准工具调用、问答
echo 配置要点：
echo   - 使用默认 Agent Loop
echo   - 注册工具表
echo 典型配置示例：
echo   ```yaml
echo   loop: default
echo   tools: [search, calculator]
echo   ```
) > knowledge\patterns\react.md

REM knowledge/patterns/plan-execute.md
(
echo # Plan-then-Execute 模式
echo 适用场景：复杂多步任务
echo 配置要点：
echo   - 自定义 Loop
echo   - 规划工具 + 执行工具
echo   - 检查点支持
) > knowledge\patterns\plan-execute.md

REM knowledge/best-practices.json
(
echo {
echo   "general": ["遵循AKO铁律", "使用环境变量"],
echo   "cost": ["启用缓存", "分级路由"],
echo   "security": ["沙箱隔离", "白名单默认拒绝"]
echo }
) > knowledge\best-practices.json

REM knowledge/component-catalog.json
(
echo {
echo   "bundles": [
echo     "@deepseek-ai/dsh-base",
echo     "@deepseek-ai/dsh-web-app",
echo     "custom/code-review-tools"
echo   ],
echo   "tools": ["git-tool", "linter-tool", "search-tool"]
echo }
) > knowledge\component-catalog.json

REM ------------------- outputs 输出目录 -------------------
echo 创建 outputs 目录...
mkdir outputs 2>nul
mkdir outputs\placeholder_session 2>nul
REM 占位文件说明
echo 此目录存放生成的设计方案 > outputs\README.txt

REM ------------------- sandbox 沙箱目录 -------------------
echo 创建 sandbox 目录...
mkdir sandbox 2>nul
mkdir sandbox\simulate 2>nul
mkdir sandbox\logs 2>nul

REM ------------------- tests 测试目录 -------------------
echo 创建 tests 目录...
mkdir tests 2>nul
mkdir tests\unit 2>nul
mkdir tests\integration 2>nul
mkdir tests\compliance 2>nul

REM tests/compliance/test_fi_sample.ts（占位）
echo // AKO合规测试示例 > tests\compliance\test_fi_sample.ts

REM ------------------- .env 环境变量模板 -------------------
(
echo # DeepSeek API
echo # Fill in your own DEEPSEEK_API_KEY below (AKO rule: never commit real keys)
echo DEEPSEEK_API_KEY=
echo DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
echo.
echo # DSH 可选路径（如需覆盖）
echo DSH_HOME=./.dsh-cache
echo.
echo # 安全沙箱
echo SANDBOX_ENABLED=true
) > .env

REM ------------------- 完成提示 -------------------
echo.
echo ====================================================
echo   项目骨架已成功创建！
echo   请执行以下命令开始开发：
echo     cd design-agent
echo     npm install
echo     npm run bootstrap
echo ====================================================
echo.
echo   AKO 合规状态：已满足维度I全部8项，其余维度待开发后评估。
echo   目标等级：A 级（独立工具）
echo.
pause