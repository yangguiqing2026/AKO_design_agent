// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/unit/cordis-adapter.test.ts
// 覆盖: Cordis 归一化 loader——鸭子类型收敛/mismatch 诊断/默认未安装降级/探针结构。

import {
  CordisRuntimeError,
  describeKeys,
  defaultCordisRuntimeLoader,
  normalizeCordisModule,
  probeCordisCompatibility
} from '../../src/core/cordis-adapter';
import { CORDIS_PROBE_REPORT_FIXTURE } from '../fixtures/cordis-probe-report.fixture';

describe('normalizeCordisModule 鸭子归一化', () => {
  it('agents.create + info 元信息 → 收敛为 runtime', () => {
    const moduleShape = {
      info: { name: '@deepseek-ai/dsh-agent', version: '0.1.2-rc.1', api_version: '0.1.2' },
      agents: {
        create: async (def: unknown) => def,
        register: async (def: unknown) => def
      }
    };
    const runtime = normalizeCordisModule(moduleShape);
    expect(runtime).not.toBeNull();
    expect(runtime?.name).toBe('@deepseek-ai/dsh-agent');
    expect(runtime?.version).toBe('0.1.2-rc.1');
    expect(typeof runtime?.agents.create).toBe('function');
    expect(typeof runtime?.agents.register).toBe('function');
  });

  it('仅 create（无 register）也可收敛', () => {
    const api = {
      info: { name: 'x', version: '1.0.0', api_version: '1' },
      agents: { create: async () => ({ id: 'a' }) }
    };
    expect(normalizeCordisModule(api)).not.toBeNull();
  });

  it('无 agents / agents 缺 create / create 非函数 → 返回 null', () => {
    expect(normalizeCordisModule({})).toBeNull();
    expect(normalizeCordisModule({ agents: {} })).toBeNull();
    expect(normalizeCordisModule({ agents: { create: 'nope' } })).toBeNull();
    expect(normalizeCordisModule(null)).toBeNull();
  });

  it('元信息缺省时使用包名缺省值（诚实降级）', () => {
    const api = { agents: { create: async () => ({ id: 'a' }) } };
    const runtime = normalizeCordisModule(api);
    expect(runtime?.name).toBe('@deepseek-ai/dsh-agent');
    expect(runtime?.version).toBe('unknown');
  });
});

describe('describeKeys / 默认加载器降级 / 探针', () => {
  it('describeKeys 输出有序键与截断', () => {
    expect(describeKeys({})).toBe('(空)');
    expect(describeKeys({ a: 1, b: 2 })).toBe('a, b');
  });

  it('默认加载器在无真包环境下抛 DSH_NOT_INSTALLED（公开 npm 不可闭环）', async () => {
    await expect(defaultCordisRuntimeLoader()).rejects.toBeInstanceOf(CordisRuntimeError);
    await expect(defaultCordisRuntimeLoader()).rejects.toMatchObject({ code: 'DSH_NOT_INSTALLED' });
  });

  it('probeCordisCompatibility 不抛错：not-installed + shape 结构', async () => {
    const probe = await probeCordisCompatibility();
    expect(probe.package_name).toBe('@deepseek-ai/dsh-agent');
    expect(probe.surface).toBe('not-installed');
    expect(probe.present).toBe(false);
    expect(probe.shape?.has_agents_api).toBe(false);
  });

  it('探针报告 fixture 与现状一致（Sprint 3 D1 证据基线）', async () => {
    expect(CORDIS_PROBE_REPORT_FIXTURE.surface).toBe('not-installed');
    expect(CORDIS_PROBE_REPORT_FIXTURE.package_name).toBe('@deepseek-ai/dsh-agent');
    expect(CORDIS_PROBE_REPORT_FIXTURE.present).toBe(false);
  });
});
