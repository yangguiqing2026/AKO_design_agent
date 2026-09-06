// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/integration/cordis-live-probe.test.ts
// 用途: Cordis-4 真机兼容性探针（D1 决策配套）。
//   - 默认：真实包未安装/公开 npm 不可闭环时校验 not-installed 降级通道（CI 常态）
//   - AKO_DSH_LIVE=1 时：对受控私有源安装的真包执行 live 断言（loader 归一化一致）

import {
  CordisAdapter,
  probeCordisCompatibility,
  defaultCordisRuntimeLoader
} from '../../src/core/cordis-adapter';
import { createLogger } from '../../src/core/logger';

const LIVE = process.env.AKO_DSH_LIVE === '1';

function quietLogger(): ReturnType<typeof createLogger> {
  return createLogger({ level: 'error', sinks: [] });
}

describe('Cordis 兼容性探针（默认无真包环境）', () => {
  it('返回结构化 not-installed 结论（不抛错）', async () => {
    const probe = await probeCordisCompatibility();
    expect(probe.package_name).toBe('@deepseek-ai/dsh-agent');
    if (!LIVE) {
      expect(probe.surface).toBe('not-installed');
      expect(probe.present).toBe(false);
    } else {
      expect(['cordis-ready', 'mismatch', 'faulted']).toContain(probe.surface);
    }
  });

  it('适配器对缺失运行时返回 runtime-missing 状态', async () => {
    const adapter = new CordisAdapter({ logger: quietLogger() });
    const status = await adapter.initialize();
    if (!LIVE) {
      expect(status.state).toBe('runtime-missing');
    } else {
      expect(['cordis-ready', 'version-blocked', 'surface-mismatch', 'faulted']).toContain(status.state);
    }
  });

  it('未就绪时 createAgent 抛类型化错误（防误用降级）', async () => {
    const adapter = new CordisAdapter({ logger: quietLogger() });
    const err = await adapter.createAgent({ id: 'x' }).catch((e: unknown) => e);
    expect(err).toHaveProperty('code');
    const code = (err as { code: string }).code;
    expect(['CORDIS_RUNTIME_FAULT', 'DSH_NOT_INSTALLED', 'CORDIS_SURFACE_MISMATCH']).toContain(code);
  });
});

if (LIVE) {
  describe('Cordis 真包 live E2E（AKO_DSH_LIVE=1，需受控私有源完整包）', () => {
    it('loader 与探针一致性：探针 ready 则 adapter 可初始化并建 Agent', async () => {
      const probe = await probeCordisCompatibility();
      const adapter = new CordisAdapter({ logger: quietLogger() });
      const status = await adapter.initialize();
      if (probe.surface === 'cordis-ready') {
        expect(status.state).toBe('cordis-ready');
        const runtime = await defaultCordisRuntimeLoader();
        const handle = await runtime.agents.create({ id: 'live-smoke' });
        expect(handle.id).toBe('live-smoke');
        await handle.abort();
      } else {
        expect(status.error_code).toBeDefined();
      }
      await adapter.close();
    });
  });
}
