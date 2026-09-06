// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/integration/cordis-adapter.test.ts
// 覆盖: CordisAdapter——FakeCordis 注入下 initialize/createAgent/send/followup/steer/abort、
//       工具默认注入、create 失败回退 register、版本闸门、未就绪调用报错。

import { CordisAdapter, CordisRuntimeError } from '../../src/core/cordis-adapter';
import { FakeCordisRuntime } from '../fixtures/fake-cordis-runtime';
import type { VersionGuardianLike } from '../../src/interfaces/dsh.interface';
import { createLogger } from '../../src/core/logger';

function quietLogger(): ReturnType<typeof createLogger> {
  return createLogger({ level: 'error', sinks: [] });
}

const TOOLS = [
  { name: 'query_patterns', description: '查询模式', input_schema: { type: 'object' } }
];

describe('CordisAdapter：FakeCordis 就绪路径', () => {
  it('initialize → cordis-ready，status 携带运行时元信息', async () => {
    const fake = new FakeCordisRuntime();
    const adapter = new CordisAdapter({ runtimeLoader: async () => fake, logger: quietLogger() });
    const status = await adapter.initialize();
    expect(status.state).toBe('cordis-ready');
    expect(status.runtime?.name).toBe('@deepseek-ai/dsh-agent');
  });

  it('createAgent 使用适配器级工具定义并执行 send 轮次', async () => {
    const fake = new FakeCordisRuntime({ latencyMs: 12 });
    const adapter = new CordisAdapter({
      runtimeLoader: async () => fake,
      tools: TOOLS,
      logger: quietLogger()
    });
    await adapter.initialize();
    const handle = await adapter.createAgent({ id: 'designer', system_prompt: '你是架构师' });
    expect(handle.id).toBe('designer');
    const turn = await handle.send({ text: '设计一个 Agent' });
    expect(turn.content).toContain('设计一个 Agent');
    expect(turn.latency_ms).toBe(12);
    const created = fake.lastCreated();
    expect(created?.lastTools).toEqual(TOOLS);
  });

  it('followup / steer / abort 在 handle 上可用', async () => {
    const fake = new FakeCordisRuntime();
    const adapter = new CordisAdapter({ runtimeLoader: async () => fake });
    await adapter.initialize();
    const handle = await adapter.createAgent({ id: 'a1' });
    expect((await handle.followup?.('追问'))?.content).toContain('追问');
    expect((await handle.steer?.('转向'))?.content).toContain('转向');
    await handle.abort();
    expect(fake.lastCreated()?.aborted).toBe(true);
  });

  it('create 失败时回退 register（均失败则抛 CORDIS_AGENT_FAILED）', async () => {
    const fake = new FakeCordisRuntime();
    const adapter = new CordisAdapter({ runtimeLoader: async () => fake });
    await adapter.initialize();
    // 注入 create 抛错的运行时变体
    const failing = new FakeCordisRuntime({ failCreate: true });
    const failingAdapter = new CordisAdapter({ runtimeLoader: async () => failing });
    await failingAdapter.initialize();
    await expect(failingAdapter.createAgent({ id: 'x' })).rejects.toMatchObject({
      code: 'CORDIS_AGENT_FAILED'
    });
    await expect(adapter.createAgent({ id: 'ok' })).resolves.toBeDefined();
  });
});

describe('CordisAdapter：故障与闸门路径', () => {
  it('未 initialize 就 createAgent → 类型化报错', async () => {
    const fake = new FakeCordisRuntime();
    const adapter = new CordisAdapter({ runtimeLoader: async () => fake });
    await expect(adapter.createAgent({ id: 'x' })).rejects.toBeInstanceOf(CordisRuntimeError);
  });

  it('版本闸门：runtime 版本被锁拦截 → version-blocked', async () => {
    const fake = new FakeCordisRuntime({ version: '0.2.0' });
    const guardian: VersionGuardianLike = {
      checkPackage: (name) => ({
        package_name: name,
        locked_version: '0.1.3-alpha.1',
        declared_version: '0.2.0',
        state: 'blocked',
        strategy: 'exact',
        message: '版本漂移'
      })
    };
    const adapter = new CordisAdapter({
      runtimeLoader: async () => fake,
      lockGuardian: guardian,
      logger: quietLogger()
    });
    const status = await adapter.initialize();
    expect(status.state).toBe('version-blocked');
    expect(status.error_code).toBe('DSH_VERSION_BLOCKED');
  });

  it('版本闸门：未被锁定清单跟踪的运行时放行（checkPackage 抛错容忍）', async () => {
    const fake = new FakeCordisRuntime({ name: 'unknown-runtime' });
    const guardian: VersionGuardianLike = {
      checkPackage: () => {
        throw new Error('not tracked');
      }
    };
    const adapter = new CordisAdapter({
      runtimeLoader: async () => fake,
      lockGuardian: guardian,
      logger: quietLogger()
    });
    const status = await adapter.initialize();
    expect(status.state).toBe('cordis-ready');
  });

  it('loader 加载失败 → 状态快照（faulted），close 后重置', async () => {
    const adapter = new CordisAdapter({
      runtimeLoader: async () => {
        throw new CordisRuntimeError('CORDIS_RUNTIME_FAULT', 'boom');
      },
      logger: quietLogger()
    });
    const status = await adapter.initialize();
    expect(status.state).toBe('faulted');
    await adapter.close();
    expect(adapter.getStatus()).toBeNull();
  });
});
