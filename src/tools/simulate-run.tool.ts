// AKO_studio - Design Agent v1.0.0
// 文件名: src/tools/simulate-run.tool.ts
// 职责: 沙箱内模拟运行工具（Sprint 1 P2）。
//   流水线：Profile 结构校验 → 配置注入扫描(L4) → 在沙箱中执行静态自检 runner
//   → 解析结果。所有文件写入/执行被 SecurityScanner 的 L1/L3 边界约束。
//
// 注意：生成物内允许出现端点配置等“网络字段”，因此本工具的注入扫描使用
// 专用规则集（剔除 network-exfil / resource-abuse 等对配置内容过度告警的规则）。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  SecurityScanner,
  DEFAULT_FORBIDDEN_PATTERNS,
  type SandboxConfig,
  type SecurityFinding
} from '../modules/validator/security-scanner';
import {
  assertValidProfile,
  duplicatePatchIds,
  validateProfile
} from '../modules/config-generator/patch-validator';
import type { DesignProfile } from '../interfaces/config.interface';

/** 静态自检脚本（无网络、无外链，仅校验 manifest 结构） */
export function buildStaticCheckRunner(): string {
  return [
    "'use strict';",
    "const fs = require('fs');",
    'const manifestPath = process.argv[2];',
    'let manifest;',
    "try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }",
    "catch (err) { console.log('RUNNER_RESULT=' + JSON.stringify({ status: 'error', reason: 'manifest unreadable: ' + err.message })); process.exit(2); }",
    'const issues = [];',
    "if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) issues.push('profile.name 缺失');",
    "if (!Array.isArray(manifest.bundles) || !manifest.bundles.every((b) => typeof b === 'string')) issues.push('profile.bundles 非法');",
    'const patches = Array.isArray(manifest.patches) ? manifest.patches : [];',
    'const ids = patches.map((p) => (p && typeof p === \'object\' ? p.id : undefined));',
    "if (new Set(ids).size !== ids.length) issues.push('patch id 重复');",
    'for (const p of patches) {',
    "  if (!p || typeof p !== 'object') { issues.push('patch 非对象'); continue; }",
    "  if (typeof p.id !== 'string' || p.id.trim().length === 0) issues.push('patch.id 缺失');",
    "  if (p.config !== undefined && (typeof p.config !== 'object' || p.config === null || Array.isArray(p.config))) issues.push('patch.config 非法');",
    '}',
    'if (issues.length === 0) {',
    "  console.log('RUNNER_RESULT=' + JSON.stringify({ status: 'ok', profile_name: manifest.name, bundle_count: manifest.bundles.length, patch_count: patches.length }));",
    '  process.exit(0);',
    '}',
    "console.log('RUNNER_RESULT=' + JSON.stringify({ status: 'failed', reason: issues.join(';') }));",
    'process.exit(1);'
  ].join('\n');
}

export interface SimulateRunRequest {
  readonly profile: DesignProfile;
  readonly timeout_ms?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface SimulateStaticSummary {
  readonly status: string;
  readonly profile_name?: string;
  readonly reason?: string;
  readonly bundle_count?: number;
  readonly patch_count?: number;
}

export interface SimulateRunOutcome {
  readonly ok: boolean;
  readonly blocked: boolean;                 // 被注入扫描拦截（未进入沙箱执行）
  readonly findings: readonly SecurityFinding[];
  readonly summary?: SimulateStaticSummary;
  readonly stdout: string;
  readonly stderr: string;
  readonly exit_code: number | null;
  readonly timed_out: boolean;
}

export class SimulateRunToolError extends Error {
  readonly code = 'SIMULATE_RUN_TOOL_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'SimulateRunToolError';
  }
}

/** 模拟运行专用扫描规则：忽略网络/死循环噪音，聚焦越权与破坏性指令 */
const SIMULATE_SCAN_RULES = DEFAULT_FORBIDDEN_PATTERNS.filter(
  (rule) => rule.id !== 'network-exfil' && rule.id !== 'resource-abuse'
);

export class SimulateRunTool {
  private readonly guard: SecurityScanner;
  private readonly baseDir: string;

  constructor(config: SandboxConfig = {}, baseDir: string = process.cwd()) {
    this.guard = new SecurityScanner(config, SIMULATE_SCAN_RULES);
    this.baseDir = baseDir;
  }

  /**
   * 执行模拟运行。
   * @throws SimulateRunToolError 结构非法 / patch id 重复 / 沙箱边界异常
   */
  async run(request: SimulateRunRequest): Promise<SimulateRunOutcome> {
    const profileValidation = validateProfile(request.profile);
    if (!profileValidation.valid) {
      throw new SimulateRunToolError(`profile 结构非法：${profileValidation.issues.join('; ')}`);
    }
    assertValidProfile(request.profile);
    const duplicates = duplicatePatchIds(request.profile);
    if (duplicates.length > 0) {
      throw new SimulateRunToolError(`patch id 重复：${duplicates.join(', ')}`);
    }

    // L4 注入扫描（专用规则）
    const serialized = JSON.stringify(request.profile, null, 2);
    const findings = this.guard.scanText(serialized);
    const severe = findings.filter((f) => f.severity === 'high' || f.severity === 'critical');
    if (severe.length > 0) {
      return {
        ok: false,
        blocked: true,
        findings,
        stdout: '',
        stderr: '',
        exit_code: null,
        timed_out: false
      };
    }

    // 在沙箱临时子目录落地 runner + manifest（路径经 L1 断言）
    const sandboxRoot = path.resolve(
      this.baseDir,
      this.guard.configSnapshot.temp_dir ?? './sandbox/simulate'
    );
    const workDir = path.join(sandboxRoot, `sim-${randomUUID()}`);
    fs.mkdirSync(workDir, { recursive: true });
    this.guard.assertSandboxCwd(workDir, this.baseDir);

    const runnerPath = path.join(workDir, 'static-runner.js');
    const manifestPath = path.join(workDir, 'profile.json');
    fs.writeFileSync(runnerPath, buildStaticCheckRunner(), 'utf8');
    fs.writeFileSync(manifestPath, serialized, 'utf8');

    const result = await this.guard.runInSandbox(
      'node',
      [runnerPath, manifestPath],
      {
        cwd: workDir,
        timeout_ms: request.timeout_ms,
        env: request.env
      }
    );

    const parsed = this.parseRunnerResult(result.stdout);
    const ok = result.exit_code === 0 && parsed?.status === 'ok';
    return {
      ok,
      blocked: false,
      findings: [],
      summary: parsed,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      timed_out: result.timed_out
    };
  }

  private parseRunnerResult(stdout: string): SimulateStaticSummary | undefined {
    const line = stdout.split('\n').find((entry) => entry.startsWith('RUNNER_RESULT='));
    if (line === undefined) {
      return undefined;
    }
    const payload = line.slice('RUNNER_RESULT='.length);
    try {
      return JSON.parse(payload) as SimulateStaticSummary;
    } catch {
      return undefined;
    }
  }
}
