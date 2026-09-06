// AKO_studio - Design Agent v1.0.0
// 文件名: src/bootstrap.ts
// 职责: 组合根（Composition Root）。加载 .env / config/*.yml / package.json，
//       装配 Logger / VersionGuardian / SecurityScanner / CostCircuit / DshAdapter，
//       输出引导报告。逻辑与副作用分离，便于集成测试注入 temp root 与假运行时。

import * as fs from 'node:fs';
import * as path from 'node:path';

import dotenv from 'dotenv';
import { load as loadYaml } from 'js-yaml';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { BudgetConfig, BudgetSnapshot } from './interfaces/cost.interface';
import type { SandboxConfig } from './modules/validator/security-scanner';
import type { VersionAuditSummary, VersionGuardConfig } from './interfaces/version.interface';
import type { DshAdapterStatus, DshRuntimeLoader } from './interfaces/dsh.interface';
import type { CordisAdapterState, CordisRuntimeLoader } from './interfaces/cordis-agent.interface';
import type { CostCircuit } from './modules/validator/cost-circuit';
import type { SecurityScanner } from './modules/validator/security-scanner';
import type { DshAdapter } from './core/dsh-adapter';
import type { Logger } from './core/logger';

import { createLogger, generateTraceId } from './core/logger';
import { VersionGuardian } from './core/version-guardian';
import { SecurityScanner as SecurityScannerImpl } from './modules/validator/security-scanner';
import { CostCircuit as CostCircuitImpl, parseBudgetConfig } from './modules/validator/cost-circuit';
import {
  CRITIC_EXECUTOR_MAX_RETRY,
  SimpleCriticExecutor as SimpleCriticExecutorImpl
} from './modules/validator/critic-executor';
import { buildPipelineEvaluator } from './modules/validator/validation-pipeline';
import { DshAdapter as DshAdapterImpl } from './core/dsh-adapter';
import { CordisAdapter as CordisAdapterImpl } from './core/cordis-adapter';
import type { CordisAdapter } from './core/cordis-adapter';
import { RequirementAnalyzer as RequirementAnalyzerImpl } from './modules/requirement-analyzer';
import { PatternMatcher as PatternMatcherImpl } from './modules/pattern-matcher';
import { SimulateRunTool as SimulateRunToolImpl } from './tools/simulate-run.tool';
import { QueryPatternsTool as QueryPatternsToolImpl } from './tools/query-patterns.tool';
import { GenerateProfileTool as GenerateProfileToolImpl } from './tools/generate-profile.tool';
import { buildLocalToolBridge } from './modules/tool-bridge';
import type { IToolBridge } from './interfaces/tool-bridge.interface';
import {
  parseLlmBackends,
  parseRuntimeSettings,
  PromptAssembler as PromptAssemblerImpl
} from './prompts/assembler';
import { MemoryHub as MemoryHubImpl } from './modules/memory/memory-hub';
import { CheckpointStore as CheckpointStoreImpl } from './modules/session-manager/checkpoint-store';
import { SessionManager as SessionManagerImpl } from './modules/session-manager/session-manager';
import { TimeCircuit as TimeCircuitImpl } from './modules/validator/time-circuit';
import type { TimeCircuit } from './modules/validator/time-circuit';
import { CaseStore as CaseStoreImpl } from './modules/learning/case-store';
import { PatternWeightStore as PatternWeightStoreImpl } from './modules/learning/pattern-weight';
import { LearningHub as LearningHubImpl } from './modules/learning/learning-hub';
import { SessionOrchestrator as SessionOrchestratorImpl } from './core/session-orchestrator';
import type { RequirementAnalyzer } from './modules/requirement-analyzer';
import type { PatternMatcher } from './modules/pattern-matcher';
import type { SimulateRunTool } from './tools/simulate-run.tool';
import type { QueryPatternsTool } from './tools/query-patterns.tool';
import type { GenerateProfileTool } from './tools/generate-profile.tool';
import type { PromptAssembler, LlmBackendsConfig, RuntimeSettings } from './prompts/assembler';
import type { IMemoryHub } from './interfaces/memory.interface';
import type { ICheckpointStore } from './interfaces/checkpoint.interface';
import type { ILearningHub } from './interfaces/learning.interface';
import type { SessionManager } from './modules/session-manager/session-manager';
import type { SessionOrchestrator } from './core/session-orchestrator';
import type { ICriticExecutor } from './interfaces/critic.interface';
import type { ProfileGenerator } from './interfaces/session.interface';

export type PhaseStatus = 'ok' | 'degraded' | 'blocked' | 'failed';

export interface PhaseReport {
  readonly name: string;
  readonly status: PhaseStatus;
  readonly detail: string;
}

export interface BootstrapReport {
  readonly trace_id: string;
  readonly root_dir: string;
  readonly generated_at: string;
  readonly phases: readonly PhaseReport[];
  readonly overall: PhaseStatus;
}

export interface AssembledRuntime {
  readonly rootDir: string;
  readonly logger: Logger;
  readonly versionGuardian: VersionGuardian;
  readonly securityScanner: SecurityScanner;
  readonly costCircuit: CostCircuit;
  /** Sprint 3：时间熔断（会话墙钟 + TTFT 上限） */
  readonly timeCircuit: TimeCircuit;
  readonly dshAdapter: DshAdapter;
  /** Sprint 3：Cordis-4 运行时防腐层（新接入形态） */
  readonly cordisAdapter: CordisAdapter;
  readonly requirementAnalyzer: RequirementAnalyzer;
  readonly patternMatcher: PatternMatcher;
  readonly simulateRunTool: SimulateRunTool;
  readonly budget: BudgetConfig;
  readonly securityConfig: SandboxConfig;
  readonly lockConfig: VersionGuardConfig;
  readonly versionAudit: VersionAuditSummary;
  readonly budgetSnapshot: BudgetSnapshot;
  // Sprint 2：智能增强模块（动态 Prompt / 记忆 / 检查点 / 自学习 / 端到端编排）
  readonly runtimeSettings: RuntimeSettings;
  readonly llmBackends: LlmBackendsConfig;
  readonly promptAssembler: PromptAssembler;
  readonly memoryHub: IMemoryHub;
  readonly checkpointStore: ICheckpointStore;
  readonly sessionManager: SessionManager;
  readonly learningHub: ILearningHub;
  readonly critic: ICriticExecutor;
  readonly queryPatternsTool: QueryPatternsTool;
  readonly generateProfileTool: GenerateProfileTool;
  /** Sprint 3：工具桥接（MCP 预留；进程内默认绑定三个设计工具） */
  readonly toolBridge: IToolBridge;
  readonly orchestrator: SessionOrchestrator;
}

export interface BootstrapOptions {
  readonly rootDir?: string;
  readonly now?: () => Date;
  readonly runtimeLoader?: DshRuntimeLoader;
  /** Sprint 3：Cordis-4 归一化运行时加载器（测试/私有源注入） */
  readonly cordisRuntimeLoader?: CordisRuntimeLoader;
  readonly logger?: Logger;
  readonly env?: NodeJS.ProcessEnv;
}

export class BootstrapError extends Error {
  readonly code = 'BOOTSTRAP_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

/** 读取并解析 YAML（unknown 输出，交由各配置规范化函数收敛类型，避免 any） */
function loadYamlFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new BootstrapError(`配置文件不存在：${filePath}`);
  }
  return loadYaml(fs.readFileSync(filePath, 'utf8'));
}

function resolveRootDir(explicit: string | undefined): string {
  const raw = explicit ?? process.env.AKO_PROJECT_ROOT ?? process.cwd();
  return path.resolve(raw);
}

function readPackageJson(rootDir: string): unknown {
  const filePath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(filePath)) {
    throw new BootstrapError(`package.json 不存在：${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

/** 规范化 config/security.yml → SandboxConfig */
export function parseSecurityConfig(raw: unknown): SandboxConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new BootstrapError('security.yml 根节点必须是对象');
  }
  const record = raw as Record<string, unknown>;
  const sandbox = record.sandbox;
  if (typeof sandbox !== 'object' || sandbox === null) {
    throw new BootstrapError('security.yml 缺少 sandbox 段');
  }
  const box = sandbox as Record<string, unknown>;
  const tempDir = typeof box.temp_dir === 'string' ? box.temp_dir : './sandbox/simulate';
  const enabled = box.enabled !== false;
  const allowedSyscalls = Array.isArray(box.allowed_syscalls)
    ? box.allowed_syscalls.filter((v): v is string => typeof v === 'string')
    : [];
  const forbiddenSyscalls = Array.isArray(box.forbidden_syscalls)
    ? box.forbidden_syscalls.filter((v): v is string => typeof v === 'string')
    : [];
  return {
    enabled: enabled,
    temp_dir: tempDir,
    allowed_paths: [tempDir],
    allowed_commands: [...allowedSyscalls, 'node', 'echo', 'printenv'],
    syscall_filter: false
  };
}

export async function assembleRuntime(options: BootstrapOptions = {}): Promise<AssembledRuntime> {
  const rootDir = resolveRootDir(options.rootDir);
  const now = options.now ?? ((): Date => new Date());
  const configDir = path.join(rootDir, 'config');
  const sandboxLogsDir = path.join(rootDir, 'sandbox', 'logs');

  const budget = parseBudgetConfig(loadYamlFile(path.join(configDir, 'cost-budget.yml')));
  const securityConfig = parseSecurityConfig(loadYamlFile(path.join(configDir, 'security.yml')));
  const lockConfig = VersionGuardian.parseConfig(loadYamlFile(path.join(configDir, 'dsh-lock.yml')));

  // Sprint 2：解析 default.yml / llm.backends.yml（供动态 Prompt 与编排使用）
  const runtimeSettings = parseRuntimeSettings(loadYamlFile(path.join(configDir, 'default.yml')));
  const llmBackends = parseLlmBackends(loadYamlFile(path.join(configDir, 'llm.backends.yml')));

  const declared = VersionGuardian.readDeclaredVersions(readPackageJson(rootDir));
  const versionGuardian = new VersionGuardian(lockConfig, declared);
  const versionAudit = versionGuardian.audit();

  const securityScanner = new SecurityScannerImpl(securityConfig);
  const costCircuit = new CostCircuitImpl(path.join(sandboxLogsDir, 'cost-ledger.json'), budget, {
    now,
    warn: (msg: string): void => {
      options.logger?.warn(msg);
    }
  });

  const logger = options.logger ?? createLogger({ scope: 'bootstrap', trace_id: generateTraceId() });
  const dshAdapter = new DshAdapterImpl(
    {
      runtimeLoader: options.runtimeLoader,
      lockGuardian: versionGuardian,
      now
    },
    logger
  );

  // Sprint 3：Cordis-4 归一化防腐层（新接入形态；legacy openSession 由 dshAdapter 保留）
  const cordisAdapter = new CordisAdapterImpl({
    runtimeLoader: options.cordisRuntimeLoader,
    lockGuardian: versionGuardian,
    now,
    logger
  });

  const requirementAnalyzer = new RequirementAnalyzerImpl();
  const simulateRunTool = new SimulateRunToolImpl(securityScanner.configSnapshot, rootDir);

  // Sprint 2：记忆 / 检查点 / 自学习存储（统一可注入路径，目录纳入 sandbox/data）
  const warnSink = (msg: string): void => {
    logger.warn(msg);
  };
  const dataRoot = path.join(rootDir, 'sandbox', 'data');
  const memoryDir = path.join(dataRoot, 'memory');
  const checkpointDir = path.join(dataRoot, 'checkpoints');
  const learningDir = path.join(dataRoot, 'learning');
  for (const dir of [memoryDir, checkpointDir, learningDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const memoryHub = new MemoryHubImpl({
    memoryDir,
    bestPracticesPath: path.join(rootDir, 'knowledge', 'best-practices.json'),
    warn: warnSink
  });
  const checkpointStore = new CheckpointStoreImpl({ dir: checkpointDir, warn: warnSink });
  const sessionManager = new SessionManagerImpl(checkpointStore, { logger });

  // Sprint 3：时间熔断（会话墙钟上限 + TTFT 上限，来自 default.yml）
  const timeCircuit = new TimeCircuitImpl({
    maxSessionMs: runtimeSettings.session_timeout_ms,
    maxTtftMs: runtimeSettings.ttft_timeout_ms,
    warn: warnSink
  });
  const learningHub = new LearningHubImpl({
    cases: new CaseStoreImpl({ file: path.join(learningDir, 'cases.json'), warn: warnSink }),
    weights: new PatternWeightStoreImpl({ file: path.join(learningDir, 'weights.json'), warn: warnSink })
  });

  // Sprint 2：Prompt 运行时组装器 + 权重注入的模式匹配器
  const promptAssembler = new PromptAssemblerImpl({ runtime: runtimeSettings, backends: llmBackends });
  const weightMap: Record<string, number> = {};
  for (const [id, stats] of Object.entries(learningHub.weights.snapshot())) {
    weightMap[id] = stats.weight;
  }
  const patternMatcher = new PatternMatcherImpl({ weightMap });

  // Sprint 2：工具与 Critic（critic 挂 case sink → 学习中枢）
  const queryPatternsTool = new QueryPatternsToolImpl(patternMatcher);
  const generateProfileTool = new GenerateProfileToolImpl({
    assembler: promptAssembler,
    matcher: patternMatcher
  });

  // Sprint 3：工具桥接（MCP 预留；进程内默认绑定三个设计工具）
  const toolBridge = buildLocalToolBridge({
    queryPatternsTool,
    generateProfileTool,
    simulateRunTool
  });
  // Sprint 3：critic 默认走 validator E2E 管道（Schema→结构→沙箱 simulate）
  const critic = new SimpleCriticExecutorImpl({
    maxRetry: CRITIC_EXECUTOR_MAX_RETRY,
    evaluateProfile: buildPipelineEvaluator({ sandbox: simulateRunTool }),
    onCaseSink: (record) => {
      void learningHub.recordOutcome(record);
    }
  });

  // Sprint 2：端到端编排（generate seam 指向 generate-profile.tool）
  const generator: ProfileGenerator = async (input) => {
    const generated = await generateProfileTool.generate({
      ctx: input.ctx,
      user_prompt: input.ctx.user_prompt,
      memory_hints: input.memory_hints
    });
    return generated.profile;
  };
  const orchestrator = new SessionOrchestratorImpl({
    analyzer: requirementAnalyzer,
    matcher: patternMatcher,
    generator,
    critic,
    sessionManager,
    memoryHub,
    learningHub,
    costCircuit,
    costModel: runtimeSettings.llm_model,
    timeCircuit,
    logger
  });

  // 确保沙箱与日志目录就绪（沙箱为安全边界，必须真实存在）
  const simDir = path.resolve(rootDir, securityConfig.temp_dir ?? './sandbox/simulate');
  fs.mkdirSync(simDir, { recursive: true });
  fs.mkdirSync(sandboxLogsDir, { recursive: true });

  return {
    rootDir,
    logger,
    versionGuardian,
    securityScanner,
    costCircuit,
    dshAdapter,
    cordisAdapter,
    requirementAnalyzer,
    patternMatcher,
    simulateRunTool,
    budget,
    securityConfig,
    lockConfig,
    versionAudit,
    budgetSnapshot: costCircuit.snapshot(),
    runtimeSettings,
    llmBackends,
    promptAssembler,
    memoryHub,
    checkpointStore,
    sessionManager,
    learningHub,
    critic,
    timeCircuit,
    queryPatternsTool,
    generateProfileTool,
    toolBridge,
    orchestrator
  };
}

function phaseForState(state: DshAdapterStatus['state']): PhaseStatus {
  switch (state) {
    case 'runtime-ready':
      return 'ok';
    case 'runtime-missing':
    case 'surface-mismatch':
      return 'degraded';
    case 'version-blocked':
      return 'blocked';
    default:
      return 'failed';
  }
}

function phaseForCordis(state: CordisAdapterState): PhaseStatus {
  switch (state) {
    case 'cordis-ready':
      return 'ok';
    case 'runtime-missing':
    case 'surface-mismatch':
      return 'degraded';
    case 'version-blocked':
      return 'blocked';
    default:
      return 'failed';
  }
}

function reduceOverall(phases: readonly PhaseReport[]): PhaseStatus {
  if (phases.some((p) => p.status === 'failed')) {
    return 'failed';
  }
  if (phases.some((p) => p.status === 'blocked')) {
    return 'blocked';
  }
  return 'ok';
}

/** 执行引导并返回报告（不触碰 process.exit） */
export async function runBootstrap(options: BootstrapOptions = {}): Promise<BootstrapReport> {
  const rootDir = resolveRootDir(options.rootDir);
  const env = options.env ?? process.env;
  const traceId = generateTraceId();
  const phaseList: PhaseReport[] = [];
  const push = (name: string, status: PhaseStatus, detail: string): void => {
    phaseList.push({ name, status, detail });
  };

  // 阶段 1：环境（API Key 必须来自 .env/环境变量，禁止硬编码）
  const hasApiKey = typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.length > 0;
  push(
    'env',
    hasApiKey ? 'ok' : 'degraded',
    hasApiKey
      ? 'DEEPSEEK_API_KEY 已就绪（来源：.env 或进程环境变量）'
      : '未检测到 DEEPSEEK_API_KEY：LLM 调用将不可用，其他能力不受影响'
  );

  // 阶段 2-6：装配并逐模块体检
  const runtime = await assembleRuntime({ ...options, rootDir, logger: options.logger ?? createLogger({ scope: 'bootstrap', trace_id: traceId }) });

  // 版本闸门（配置已就绪才能走到这里；未通过属 blocked）
  const audit = runtime.versionAudit;
  const blockedCount = audit.blocked.length;
  push(
    'version_guard',
    audit.compliant ? 'ok' : 'blocked',
    blockedCount === 0
      ? `全部 ${audit.results.length} 个锁定包通过校验`
      : `版本锁定未通过：${audit.blocked
          .map((r) => `${r.package_name}=${r.declared_version ?? '(缺)'}(${r.state})`)
          .join(', ')}`
  );

  // 沙箱边界
  push(
    'sandbox',
    'ok',
    `沙箱目录已就绪：${path.resolve(rootDir, runtime.securityConfig.temp_dir ?? './sandbox/simulate')}（network_mode=${runtime.securityConfig.network_mode ?? 'none'}）`
  );

  // 成本熔断
  const snap = runtime.costCircuit.snapshot();
  push(
    'cost_circuit',
    snap.exceeded ? 'blocked' : 'ok',
    `本月(${snap.month_key})累计 $${snap.total_usd} / 上限 $${snap.per_month_budget_usd}（${snap.usage_percent}%）`
  );

  // Sprint 2：智能增强模块体检
  const simpleRoute = runtime.promptAssembler.routeFor('simple').model;
  const complexRoute = runtime.promptAssembler.routeFor('complex').model;
  push(
    'sprint2_modules',
    'ok',
    `Prompt 路由 ${simpleRoute}/${complexRoute}；记忆/检查点/自学习/编排已装配（max_steps=${runtime.runtimeSettings.max_steps}）`
  );

  // DSH 运行时（legacy openSession 防腐层探测）
  const dshStatus = await runtime.dshAdapter.initialize();
  const dshState = dshStatus.state;
  push(
    'dsh_runtime',
    phaseForState(dshState),
    dshStatus.reason ?? dshState
  );

  // Sprint 3：Cordis-4 运行时（新归一化形态探测；无真包时 degraded 不阻断）
  const cordisStatus = await runtime.cordisAdapter.initialize();
  push(
    'cordis_runtime',
    phaseForCordis(cordisStatus.state),
    cordisStatus.reason ?? cordisStatus.state
  );

  return {
    trace_id: traceId,
    root_dir: rootDir,
    generated_at: new Date().toISOString(),
    phases: phaseList,
    overall: reduceOverall(phaseList)
  };
}

/** ---- --serve 模式（Sprint 3 之后新增 HTTP API 层） ---- */

/** 默认服务端口 */
export const DEFAULT_SERVE_PORT = 3080;

/** 默认监听 host（安全默认：仅回环；需对外暴露时显式 --host 0.0.0.0） */
export const DEFAULT_SERVE_HOST = '127.0.0.1';

/** CLI 解析结果 */
export interface ServeCliOptions {
  readonly serve: boolean;
  readonly host: string;
  readonly port: number;
}

/**
 * 解析命令行参数（纯函数，便于测试）。
 * - `--serve`：启用 API Server
 * - `--host <addr>`：监听地址；`--host` 不带值等价 `0.0.0.0`（模板语义），缺省 127.0.0.1
 * - port：优先取 env.PORT，否则 3080
 */
export function parseCliArgs(
  argv: readonly string[] = process.argv.slice(2),
  portEnv: string | undefined = process.env.PORT
): ServeCliOptions {
  const serve = argv.includes('--serve');
  let host = DEFAULT_SERVE_HOST;
  const hostFlagIndex = argv.indexOf('--host');
  if (hostFlagIndex >= 0) {
    const next = argv[hostFlagIndex + 1];
    host =
      next !== undefined && next.length > 0 && !next.startsWith('--') ? next : '0.0.0.0';
  }
  const parsedPort = portEnv === undefined ? Number.NaN : Number(portEnv);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_SERVE_PORT;
  return { serve, host, port };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** /design/chat 请求体（宽松校验后收敛） */
export interface DesignChatBody {
  readonly prompt: string;
  readonly session_id?: string;
  readonly human_decision?: 'approve' | 'reject';
  readonly max_steps?: number;
}

function normalizeChatBody(value: unknown): DesignChatBody | null {
  if (!isRecord(value) || typeof value.prompt !== 'string' || value.prompt.trim().length === 0) {
    return null;
  }
  const humanDecision =
    value.human_decision === 'approve' || value.human_decision === 'reject'
      ? value.human_decision
      : undefined;
  return {
    prompt: value.prompt.trim(),
    ...(typeof value.session_id === 'string' && value.session_id.length > 0
      ? { session_id: value.session_id }
      : {}),
    ...(humanDecision !== undefined ? { human_decision: humanDecision } : {}),
    ...(typeof value.max_steps === 'number' && value.max_steps > 0
      ? { max_steps: value.max_steps }
      : {})
  };
}

/** HTTP 层仅依赖 runDesignSession（便于注入 stub 做 inject 测试） */
type OrchestratorLike = Pick<SessionOrchestrator, 'runDesignSession'>;

export interface ApiServerDeps {
  readonly orchestrator: OrchestratorLike;
  readonly version: string;
  readonly overall: PhaseStatus;
}

/** 构造 Fastify 实例（不监听；供 inject 测试与 startServe 复用） */
export function buildApiServer(deps: ApiServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // 健康检查
  app.get('/health', async () => ({
    status: 'ok',
    service: 'design-agent',
    version: deps.version,
    overall: deps.overall,
    ts: new Date().toISOString()
  }));

  // 核心接口：设计会话（SSE 流式进度）
  app.post('/design/chat', async (request, reply) => {
    const body = normalizeChatBody(request.body);
    if (body === null) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'prompt 必填且不能为空（JSON body）' }
      });
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (event: string, data: unknown): void => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await deps.orchestrator.runDesignSession(body.prompt, {
        ...(body.session_id !== undefined ? { session_id: body.session_id } : {}),
        ...(body.human_decision !== undefined ? { human_decision: body.human_decision } : {}),
        ...(body.max_steps !== undefined ? { max_steps: body.max_steps } : {}),
        on_event: (event) => send('progress', event)
      });
      send('result', {
        session_id: result.session_id,
        trace_id: result.trace_id,
        status: result.status,
        outcome: result.outcome,
        steps_used: result.steps_used,
        resumed: result.resumed,
        final_checkpoint_id: result.final_checkpoint_id,
        generated_profile: result.ctx.generated_profile,
        validation_errors: result.ctx.validation_errors
      });
      send('done', '[DONE]');
      raw.end();
    } catch (err) {
      send('error', {
        code: 'SESSION_FAILED',
        message: err instanceof Error ? err.message : String(err)
      });
      raw.end();
    }
  });

  return app;
}

/** 读取 package.json version（health 使用，避免硬编码漂移） */
function packageVersion(rootDir: string): string {
  const raw = readPackageJson(rootDir);
  if (isRecord(raw) && typeof raw.version === 'string') {
    return raw.version;
  }
  return '0.0.0';
}

/** 启动 API Server（listen 完成后返回 app 与访问 URL） */
export async function startServe(options: {
  readonly runtime: AssembledRuntime;
  readonly overall: PhaseStatus;
  readonly host: string;
  readonly port: number;
}): Promise<{ readonly app: FastifyInstance; readonly url: string }> {
  const app = buildApiServer({
    orchestrator: options.runtime.orchestrator,
    version: packageVersion(options.runtime.rootDir),
    overall: options.overall
  });
  await app.listen({ host: options.host, port: options.port });
  const address = app.server.address();
  const url =
    address !== null && typeof address === 'object'
      ? `http://${options.host}:${address.port}`
      : `http://${options.host}:${options.port}`;
  return { app, url };
}

/** 直接执行入口：npm run bootstrap / node dist/bootstrap.js（--serve 启动 API Server） */
async function main(): Promise<void> {
  const rootDir = resolveRootDir(undefined);
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
  }
  const logger = createLogger({ scope: 'bootstrap', trace_id: generateTraceId() });
  try {
    // CLI/环境解析须在 dotenv 加载之后（--serve / --host / PORT 支持来自 .env）
    const cli = parseCliArgs();
    const report = await runBootstrap({ rootDir, logger });
    logger.info('AKO Design Agent 引导完成', report);
    if (report.overall === 'blocked' || report.overall === 'failed') {
      process.exitCode = 1;
      return;
    }
    if (cli.serve) {
      // 引导已装配一次 runtime；serve 需要 orchestrator 等完整装配体
      const runtime = await assembleRuntime({ rootDir, logger });
      const { url } = await startServe({
        runtime,
        overall: report.overall,
        host: cli.host,
        port: cli.port
      });
      console.log(`🖥️  Designer Agent API Server running on ${url}`);
      logger.info('Designer Agent API Server 已启动', { url });
      return; // server 常驻：Fastify 句柄保活事件循环
    }
    process.exitCode = 0;
  } catch (err) {
    logger.error('引导失败', err instanceof Error ? err : new Error(String(err)));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

