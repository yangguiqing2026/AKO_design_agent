// AKO_studio - Design Agent v1.0.0
// 文件名: tests/integration/dsh-adapter.test.ts
// 覆盖: 防腐层完整链路（探测/版本闸门/会话/类型化降级），真实 DSH 包未安装场景
//       通过注入 FakeDshRuntime 验证就绪路径。

import { DshAdapter, DshRuntimeError } from '../../src/core/dsh-adapter';
import { VersionGuardian } from '../../src/core/version-guardian';
import { createLogger } from '../../src/core/logger';
import type { DshMessage, DshToolDefinition } from '../../src/interfaces/dsh.interface';
import type { VersionGuardConfig } from '../../src/interfaces/version.interface';
import { FakeDshRuntime } from '../fixtures/fake-dsh-runtime';

function quietLogger(): ReturnType<typeof createLogger> {
  return createLogger({ level: 'error', sinks: [] });
}

const LOCK: VersionGuardConfig = {
  locked_versions: { '@deepseek-ai/dsh-agent': '0.1.3-alpha.1' },
  fallback_mode: false,
  pin_strategy: 'exact'
};

function guardianFor(declared: Record<string, string>): VersionGuardian {
  return new VersionGuardian(LOCK, declared);
}

const greeting: readonly DshMessage[] = [{ role: 'user', content: '请设计一个 ReAct Agent' }];

describe('DshAdapter 就绪路径（假运行时）', () => {
  it('探测成功 → runtime-ready；可执行会话并获得助手消息', async () => {
    const fake = new FakeDshRuntime();
    const adapter = new DshAdapter(
      {
        runtimeLoader: async () => fake,
        lockGuardian: guardianFor({ '@deepseek-ai/dsh-agent': '0.1.3-alpha.1' })
      },
      quietLogger()
    );
    const status = await adapter.initialize();
    expect(status.state).toBe('runtime-ready');
    expect(status.runtime?.version).toBe('0.1.3-alpha.1');

    const result = await adapter.runSession(greeting);
    expect(result.session_id).toMatch(/^fake-session-/);
    expect(result.messages[0]).toMatchObject({ role: 'assistant' });
    expect(result.runtime.name).toBe('@deepseek-ai/dsh-agent');
    await adapter.close();
    expect(fake.closeCount).toBe(1);
  });

  it('注入的工具表原样下发给运行时', async () => {
    const fake = new FakeDshRuntime();
    const tools: readonly DshToolDefinition[] = [
      { name: 'query-patterns', description: '查模式库', input_schema: { type: 'object' } }
    ];
    const adapter = new DshAdapter(
      { runtimeLoader: async () => fake, tools },
      quietLogger()
    );
    await adapter.initialize();
    await adapter.runSession(greeting);
    expect(fake.receivedTools).toHaveLength(1);
    expect(fake.receivedTools[0][0].name).toBe('query-patterns');
    await adapter.close();
  });
});

describe('DshAdapter 类型化降级路径', () => {
  it('包未安装 → runtime-missing，runSession 抛 DSH_NOT_INSTALLED', async () => {
    const adapter = new DshAdapter(
      {
        runtimeLoader: async () => {
          throw new DshRuntimeError('DSH_NOT_INSTALLED', '@deepseek-ai/dsh-agent 未安装');
        }
      },
      quietLogger()
    );
    const status = await adapter.initialize();
    expect(status.state).toBe('runtime-missing');
    expect(status.error_code).toBe('DSH_NOT_INSTALLED');

    await expect(adapter.runSession(greeting)).rejects.toMatchObject({
      code: 'DSH_NOT_INSTALLED'
    });
  });

  it('加载器抛普通错误 → faulted（不泄露未分类异常）', async () => {
    const adapter = new DshAdapter(
      { runtimeLoader: async () => { throw new Error('boom'); } },
      quietLogger()
    );
    const status = await adapter.initialize();
    expect(status.state).toBe('faulted');
    expect(status.error_code).toBe('DSH_RUNTIME_FAULT');
  });

  it('API 漂移 → surface-mismatch', async () => {
    const adapter = new DshAdapter(
      {
        runtimeLoader: async () => {
          throw new DshRuntimeError('DSH_SURFACE_MISMATCH', '缺少 openSession/close/info');
        }
      },
      quietLogger()
    );
    const status = await adapter.initialize();
    expect(status.state).toBe('surface-mismatch');
  });

  it('未 initialize 直接 runSession → DSH_RUNTIME_FAULT', async () => {
    const adapter = new DshAdapter({}, quietLogger());
    await expect(adapter.runSession(greeting)).rejects.toMatchObject({
      code: 'DSH_RUNTIME_FAULT'
    });
  });

  it('会话执行失败 → DSH_SESSION_FAILED', async () => {
    const fake = new FakeDshRuntime({ failSend: true });
    const adapter = new DshAdapter({ runtimeLoader: async () => fake }, quietLogger());
    await adapter.initialize();
    await expect(adapter.runSession(greeting)).rejects.toMatchObject({
      code: 'DSH_SESSION_FAILED'
    });
    await adapter.close();
  });
});

describe('DshAdapter 版本闸门集成', () => {
  it('运行时版本与锁定不一致 → version-blocked，并释放被拒运行时', async () => {
    const fake = new FakeDshRuntime({ version: '0.2.0' });
    const adapter = new DshAdapter(
      {
        runtimeLoader: async () => fake,
        lockGuardian: guardianFor({ '@deepseek-ai/dsh-agent': '0.2.0' })
      },
      quietLogger()
    );
    const status = await adapter.initialize();
    expect(status.state).toBe('version-blocked');
    expect(status.error_code).toBe('DSH_VERSION_BLOCKED');
    await expect(adapter.runSession(greeting)).rejects.toMatchObject({
      code: 'DSH_VERSION_BLOCKED'
    });
    // 版本被拒 → 运行时被关闭，不再占用资源
    expect(fake.closeCount).toBe(1);
  });

  it('运行时版本与锁定一致时通过闸门', async () => {
    const fake = new FakeDshRuntime({ version: '0.1.3-alpha.1' });
    const adapter = new DshAdapter(
      {
        runtimeLoader: async () => fake,
        lockGuardian: guardianFor({ '@deepseek-ai/dsh-agent': '0.1.3-alpha.1' })
      },
      quietLogger()
    );
    const status = await adapter.initialize();
    expect(status.state).toBe('runtime-ready');
    await adapter.close();
  });
});
