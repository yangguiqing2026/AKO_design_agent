// AKO_studio - Design Agent v1.0.0
// 文件名: tests/unit/simulate-run.tool.test.ts
// 覆盖: 合法 Profile 模拟运行 / 恶意配置被注入扫描拦截 / 结构非法与重复 id 抛错

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SimulateRunTool, SimulateRunToolError } from '../../src/tools/simulate-run.tool';
import type { DesignProfile } from '../../src/interfaces/config.interface';

let sandboxDir: string;

beforeEach(() => {
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-simulate-'));
});

afterEach(() => {
  fs.rmSync(sandboxDir, { recursive: true, force: true });
});

function tool(): SimulateRunTool {
  return new SimulateRunTool(
    {
      temp_dir: sandboxDir,
      allowed_paths: [sandboxDir],
      max_cpu_time_ms: 15000
    },
    sandboxDir
  );
}

function validProfile(): DesignProfile {
  return {
    name: 'web-coder',
    description: '生成代码的编码 Agent（含合法端点配置）',
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    patches: [
      { id: 'loop', config: { loop: 'default' } },
      { id: 'endpoint', config: { endpoint: 'https://api.deepseek.com/v1' } }
    ]
  };
}

describe('SimulateRunTool：正常路径', () => {
  it('合法 Profile 在沙箱中运行静态自检并通过', async () => {
    const outcome = await tool().run({ profile: validProfile() });
    expect(outcome.ok).toBe(true);
    expect(outcome.blocked).toBe(false);
    expect(outcome.exit_code).toBe(0);
    expect(outcome.summary).toMatchObject({
      status: 'ok',
      profile_name: 'web-coder',
      bundle_count: 2,
      patch_count: 2
    });
    expect(outcome.findings).toHaveLength(0);
  });

  it('端点配置不被误判为网络外联（专用规则集）', async () => {
    const outcome = await tool().run({
      profile: {
        ...validProfile(),
        patches: [
          { id: 'endpoint', config: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro' } }
        ]
      }
    });
    expect(outcome.blocked).toBe(false);
    expect(outcome.ok).toBe(true);
  });
});

describe('SimulateRunTool：安全拦截', () => {
  it('配置内含破坏性指令 → blocked 且不进入沙箱执行', async () => {
    const outcome = await tool().run({
      profile: {
        ...validProfile(),
        patches: [{ id: 'evil', config: { command: 'child_process.exec("rm -rf /")' } }]
      }
    });
    expect(outcome.blocked).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.exit_code).toBeNull();
    const ids = outcome.findings.map((f) => f.id);
    expect(ids).toContain('command-exec');
  });
});

describe('SimulateRunTool：结构校验', () => {
  it('bundles 非字符串数组 → 抛 SimulateRunToolError', async () => {
    const badProfile = {
      name: 'bad',
      bundles: [123],
      patches: []
    } as unknown as DesignProfile;
    await expect(tool().run({ profile: badProfile })).rejects.toThrow(SimulateRunToolError);
  });

  it('patch id 重复 → 抛 SimulateRunToolError', async () => {
    const duplicateProfile: DesignProfile = {
      name: 'dup',
      bundles: [],
      patches: [
        { id: 'p', config: { a: 1 } },
        { id: 'p', config: { b: 2 } }
      ]
    };
    await expect(tool().run({ profile: duplicateProfile })).rejects.toThrow(/重复/);
  });
});
