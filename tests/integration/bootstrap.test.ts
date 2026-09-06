// AKO_studio - Design Agent v1.0.0
// 文件名: tests/integration/bootstrap.test.ts
// 覆盖: 组合根装配全链路（env/版本闸门/沙箱/成本/DSH 探测）、注入假运行时、
//       配置缺失与版本漂移的阻断路径。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  assembleRuntime,
  BootstrapError,
  runBootstrap,
  type BootstrapReport
} from '../../src/bootstrap';
import { createLogger } from '../../src/core/logger';
import { FakeDshRuntime } from '../fixtures/fake-dsh-runtime';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function quietLogger(): ReturnType<typeof createLogger> {
  return createLogger({ level: 'error', sinks: [] });
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-bootstrap-'));
  copyDir(path.join(REPO_ROOT, 'config'), path.join(fixtureRoot, 'config'));
  fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(fixtureRoot, 'package.json'));
});

afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

const TEST_ENV: NodeJS.ProcessEnv = { DEEPSEEK_API_KEY: 'sk-integration-test' };

function phaseOf(report: BootstrapReport, name: string): BootstrapReport['phases'][number] {
  const phase = report.phases.find((p) => p.name === name);
  if (!phase) {
    throw new Error(`报告缺少阶段 ${name}`);
  }
  return phase;
}

describe('runBootstrap 默认装配（真实 DSH 包未安装）', () => {
  it('version_guard=ok、dsh=degraded(runtime-missing)、overall=ok', async () => {
    const report = await runBootstrap({ rootDir: fixtureRoot, env: TEST_ENV, logger: quietLogger() });
    expect(phaseOf(report, 'env').status).toBe('ok');
    expect(phaseOf(report, 'version_guard').status).toBe('ok');
    expect(phaseOf(report, 'sandbox').status).toBe('ok');
    expect(phaseOf(report, 'cost_circuit').status).toBe('ok');
    expect(phaseOf(report, 'dsh_runtime').status).toBe('degraded');
    expect(report.overall).toBe('ok');
    expect(report.trace_id).toMatch(/^ako-dsg-/);
  });

  it('创建账本与沙箱目录', async () => {
    await runBootstrap({ rootDir: fixtureRoot, env: TEST_ENV, logger: quietLogger() });
    expect(fs.existsSync(path.join(fixtureRoot, 'sandbox', 'logs', 'cost-ledger.json'))).toBe(true);
    expect(fs.existsSync(path.join(fixtureRoot, 'sandbox', 'simulate'))).toBe(true);
  });

  it('缺少 API Key → env 阶段 degraded 但不阻断整体', async () => {
    const report = await runBootstrap({ rootDir: fixtureRoot, env: {}, logger: quietLogger() });
    expect(phaseOf(report, 'env').status).toBe('degraded');
    expect(report.overall).toBe('ok');
  });
});

describe('runBootstrap 注入假运行时', () => {
  it('runtime-ready → dsh_runtime=ok', async () => {
    const fake = new FakeDshRuntime();
    const report = await runBootstrap({
      rootDir: fixtureRoot,
      env: TEST_ENV,
      runtimeLoader: async () => fake,
      logger: quietLogger()
    });
    expect(phaseOf(report, 'dsh_runtime').status).toBe('ok');
    expect(report.overall).toBe('ok');
    expect(fake.closeCount).toBeGreaterThanOrEqual(0);
  });
});

describe('runBootstrap 配置与版本阻断路径', () => {
  it('dsh-lock.yml 缺失 → assemble 抛 BootstrapError', async () => {
    fs.rmSync(path.join(fixtureRoot, 'config', 'dsh-lock.yml'), { force: true });
    await expect(
      runBootstrap({ rootDir: fixtureRoot, env: TEST_ENV, logger: quietLogger() })
    ).rejects.toThrow(BootstrapError);
    await expect(
      assembleRuntime({ rootDir: fixtureRoot })
    ).rejects.toThrow(/dsh-lock.yml/);
  });

  it('package.json 版本漂移 → version_guard=blocked 且 overall=blocked', async () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'package.json'), 'utf8')
    ) as Record<string, unknown>;
    const peer = packageJson.peerDependencies as Record<string, unknown>;
    peer['@deepseek-ai/dsh-agent'] = '0.2.0';
    fs.writeFileSync(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify(packageJson, null, 2),
      'utf8'
    );
    const report = await runBootstrap({ rootDir: fixtureRoot, env: TEST_ENV, logger: quietLogger() });
    expect(phaseOf(report, 'version_guard').status).toBe('blocked');
    expect(report.overall).toBe('blocked');
  });
});
