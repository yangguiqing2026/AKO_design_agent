// AKO_studio - Design Agent v1.0.0
// 文件名: src/modules/validator/security-scanner.ts
// 职责: 安全沙箱（分层防御）。
//    L1 文件系统隔离 —— 路径白名单/黑名单
//    L2 网络隔离     —— none/restricted/full + 域名白名单（运行时标记 + 校验）
//    L3 资源限制     —— child_process timeout / maxBuffer（容器级内存/CPU 强隔离由 isolated-vm/Docker 承担，P1）
//    L4 系统调用过滤 —— 指令/配置注入扫描（seccomp-bpf 容器级预留）
// 所有沙箱模拟路径必须带 sandbox 前缀（默认 ./sandbox/simulate）。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import * as path from 'node:path';

/** 安全错误码 */
export type SecurityErrorCode =
  | 'SANDBOX_PATH_OUT_OF_BOUNDS'
  | 'SANDBOX_FORBIDDEN_PATH'
  | 'SANDBOX_COMMAND_BLOCKED'
  | 'SANDBOX_NETWORK_CONFIG_INVALID'
  | 'SANDBOX_EXEC_FAILED'
  | 'INPUT_BLOCKED';

export class SecurityError extends Error {
  readonly code: SecurityErrorCode;

  constructor(code: SecurityErrorCode, message: string) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

/** 沙箱配置（对应 config/security.yml 的 sandbox 段 + P0 默认值） */
export interface SandboxConfig {
  readonly enabled?: boolean;
  readonly allowed_paths?: readonly string[];
  readonly forbidden_paths?: readonly string[];
  readonly network_mode?: 'none' | 'restricted' | 'full';
  readonly allowed_hosts?: readonly string[];
  readonly allowed_commands?: readonly string[];
  readonly max_memory_mb?: number;
  readonly max_cpu_time_ms?: number;
  readonly max_file_size_mb?: number;
  readonly max_output_bytes?: number;
  readonly syscall_filter?: boolean;
  readonly temp_dir?: string;
}

export interface SandboxRunOptions {
  readonly cwd?: string;
  readonly timeout_ms?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SandboxRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exit_code: number | null;
  readonly duration_ms: number;
  readonly timed_out: boolean;
  readonly output_limited: boolean;
}

export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DefenseLayer = 1 | 2 | 3 | 4;

/** 注入扫描发现 */
export interface SecurityFinding {
  readonly id: string;
  readonly layer: DefenseLayer;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly snippet: string;
}

/** 可注入的扫描规则 */
export interface ScanRule {
  readonly id: string;
  readonly layer: DefenseLayer;
  readonly severity: FindingSeverity;
  readonly re: RegExp;
  readonly message: string;
}

/** 默认注入/越权模式 */
export const DEFAULT_FORBIDDEN_PATTERNS: readonly ScanRule[] = [
  {
    id: 'path-traversal',
    layer: 1,
    severity: 'high',
    re: /(\.\.\/|\.\.\\)+/g,
    message: '检测到目录穿越（../）'
  },
  {
    id: 'sensitive-path',
    layer: 1,
    severity: 'high',
    re: /(^|\/|\\)(etc|root)(\/|$)|\.ssh(\/|$)|process\.env\.DEEPSEEK_API_KEY/g,
    message: '涉及敏感系统路径或凭据'
  },
  {
    id: 'network-exfil',
    layer: 2,
    severity: 'critical',
    re: /(fetch|axios|https?:\/\/)/g,
    message: '检测到外部网络请求'
  },
  {
    id: 'resource-abuse',
    layer: 3,
    severity: 'medium',
    re: /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/g,
    message: '检测到潜在死循环'
  },
  {
    id: 'command-exec',
    layer: 4,
    severity: 'critical',
    re: /child_process|\bexec(?:Sync)?\s*\(|\bspawn\s*\(|\beval\s*\(|new\s+Function\s*\(/g,
    message: '检测到进程/动态执行原语'
  },
  {
    id: 'destructive-command',
    layer: 4,
    severity: 'critical',
    re: /rm\s+-(?:rf|fr)|mkfs|dd\s+if=|\|\s*sh\b|chmod\s+777|sudo\s+/g,
    message: '检测到破坏性 shell 指令'
  }
];

const DEFAULT_ALLOWED_COMMANDS: readonly string[] = ['node', 'echo', 'printenv'];

/** 路径是否位于某根目录之下（含根本身） */
function isPathWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function expandUserDir(p: string): string {
  return p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p;
}

export class SecurityScanner {
  private readonly config: SandboxConfig;
  private readonly patterns: readonly ScanRule[];

  /**
   * @param config  沙箱配置（缺省即安全默认值）
   * @param patterns 自定义注入扫描规则（缺省用 DEFAULT_FORBIDDEN_PATTERNS，便于测试注入）
   */
  constructor(config: SandboxConfig = {}, patterns: readonly ScanRule[] = DEFAULT_FORBIDDEN_PATTERNS) {
    this.config = {
      allowed_paths: ['./sandbox/simulate'],
      forbidden_paths: [],
      network_mode: 'none',
      allowed_hosts: [],
      allowed_commands: DEFAULT_ALLOWED_COMMANDS,
      max_memory_mb: 512,
      max_cpu_time_ms: 30000,
      max_file_size_mb: 10,
      syscall_filter: false,
      temp_dir: './sandbox/simulate',
      ...config
    };
    this.patterns = patterns;
    this.validateNetworkMode();
  }

  get configSnapshot(): Readonly<SandboxConfig> {
    return this.config;
  }

  private validateNetworkMode(): void {
    const mode = this.config.network_mode ?? 'none';
    if (mode === 'restricted' && (this.config.allowed_hosts ?? []).length === 0) {
      throw new SecurityError(
        'SANDBOX_NETWORK_CONFIG_INVALID',
        'network_mode=restricted 时必须提供非空 allowed_hosts 白名单'
      );
    }
  }

  /** 可写根目录集合（allowed_paths ∪ temp_dir） */
  private allowedRoots(baseDir: string): string[] {
    const candidates = [...(this.config.allowed_paths ?? [])];
    if (this.config.temp_dir !== undefined) {
      candidates.push(this.config.temp_dir);
    }
    return [...new Set(candidates.map((p) => path.resolve(baseDir, p)))];
  }

  /** 禁止前缀（绝对路径解析，支持 ~ 展开） */
  private forbiddenRoots(baseDir: string): string[] {
    return (this.config.forbidden_paths ?? [])
      .filter((p) => p.trim().length > 0 && p !== '.')
      .map((p) => path.resolve(baseDir, expandUserDir(p)));
  }

  /**
   * L1：校验目标 cwd 位于允许根内且不落入禁止前缀。
   * @param baseDir 相对路径解析基准（默认进程 cwd）
   */
  assertSandboxCwd(cwd: string, baseDir: string = process.cwd()): void {
    const target = path.resolve(baseDir, cwd);
    const roots = this.allowedRoots(baseDir);
    if (roots.length === 0 || !roots.some((root) => isPathWithin(root, target))) {
      throw new SecurityError(
        'SANDBOX_PATH_OUT_OF_BOUNDS',
        `cwd ${target} 不在允许的沙箱路径内：${roots.join(', ') || '(空)'}`
      );
    }
    for (const forbidden of this.forbiddenRoots(baseDir)) {
      if (isPathWithin(forbidden, target) || isPathWithin(target, forbidden)) {
        throw new SecurityError('SANDBOX_FORBIDDEN_PATH', `cwd ${target} 命中禁止路径 ${forbidden}`);
      }
    }
  }

  /** 校验可执行命令：仅允许白名单命令或指向沙箱根内的可执行文件 */
  validateCommand(command: string, baseDir: string = process.cwd()): void {
    if (command.trim().length === 0) {
      throw new SecurityError('SANDBOX_COMMAND_BLOCKED', '命令不能为空');
    }
    const allowed = this.config.allowed_commands ?? DEFAULT_ALLOWED_COMMANDS;
    if (allowed.includes(command)) {
      return;
    }
    if (path.isAbsolute(command)) {
      const roots = this.allowedRoots(baseDir);
      if (roots.some((root) => isPathWithin(root, command))) {
        return;
      }
    }
    throw new SecurityError(
      'SANDBOX_COMMAND_BLOCKED',
      `命令 ${command} 不在允许列表 ${allowed.join(', ')} 内，也未指向沙箱根`
    );
  }

  /**
   * L4：指令/配置注入扫描（对 LLM 输出配置或 prompt 内容）。
   * 遍历规则并对每个规则重建全局正则以避免状态残留。
   */
  scanText(text: string): readonly SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    for (const rule of this.patterns) {
      const re = new RegExp(rule.re.source, 'g');
      const matches = text.match(re) ?? [];
      if (matches.length === 0) {
        continue;
      }
      const idx = text.search(re);
      const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 24), idx + 48) : text.slice(0, 64);
      findings.push({
        id: rule.id,
        layer: rule.layer,
        severity: rule.severity,
        message: `${rule.message}（命中 ${matches.length} 处）`,
        snippet
      });
    }
    return findings;
  }

  /** 内容安全断言：命中 high/critical 即抛 INPUT_BLOCKED */
  assertInputSafe(text: string): void {
    const findings = this.scanText(text).filter(
      (f) => f.severity === 'high' || f.severity === 'critical'
    );
    if (findings.length > 0) {
      throw new SecurityError(
        'INPUT_BLOCKED',
        `输入被安全策略拦截：${findings.map((f) => `[${f.id}]${f.message}`).join('; ')}`
      );
    }
  }

  /**
   * 在沙箱内执行命令。
   * - L1 前置：cwd 必须位于允许根内（runInSandbox 自动断言）
   * - 命令必须通过 validateCommand（shell=false，不经过 shell 解释）
   * - L2 标记：注入 DSH_CREATOR_MODE=readonly 与 AKO_NETWORK_MODE
   * - L3 资源：timeout（默认 max_cpu_time_ms）与 maxBuffer（上限由配置推导）
   * @throws SecurityError 启动失败/前置校验失败时抛错；命令自身非零退出不抛错，以结果返回
   */
  async runInSandbox(
    command: string,
    args: readonly string[] = [],
    options: SandboxRunOptions = {}
  ): Promise<SandboxRunResult> {
    const baseDir = process.cwd();
    const cwd = path.resolve(baseDir, options.cwd ?? this.config.temp_dir ?? process.cwd());
    this.assertSandboxCwd(cwd, baseDir);
    this.validateCommand(command, baseDir);

    const timeoutMs = options.timeout_ms ?? this.config.max_cpu_time_ms ?? 30000;
    const maxFileBytes = (this.config.max_file_size_mb ?? 10) * 1024 * 1024;
    const maxOutputBytes = this.config.max_output_bytes ?? maxFileBytes;

    const env: Record<string, string> = {
      ...process.env,
      ...(options.env ?? {}),
      DSH_CREATOR_MODE: 'readonly',
      AKO_NETWORK_MODE: this.config.network_mode ?? 'none'
    };

    return new Promise<SandboxRunResult>((resolve, reject) => {
      const started = Date.now();
      let timedOut = false;

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(command, [...args], {
          cwd,
          env,
          shell: false,
          windowsHide: true
        });
      } catch (err) {
        reject(new SecurityError('SANDBOX_EXEC_FAILED', `无法启动命令 ${command}: ${String(err)}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      let outputLimited = false;
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > maxOutputBytes) {
          outputLimited = true;
          child.kill('SIGKILL');
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(new SecurityError('SANDBOX_EXEC_FAILED', `执行失败：${err.message}`));
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exit_code: code,
          duration_ms: Date.now() - started,
          timed_out: timedOut,
          output_limited: outputLimited
        });
      });
    });
  }
}

