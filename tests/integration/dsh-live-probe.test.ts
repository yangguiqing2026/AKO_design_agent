// AKO_studio - Design Agent v1.0.0
// 文件名: tests/integration/dsh-live-probe.test.ts
// 用途: DSH 真包兼容性探针（P1）。
//   - 默认：真实包未安装时校验「not-installed」降级通道（本地/CI 常态）
//   - AKO_DSH_LIVE=1 时：对已安装的真实 DeepSeek Harness 包执行 live E2E，
//     验证 loader 归一化/探针输出结论（公开 npm 上该生态 peer 链不闭环，
//     需在具备完整私有源的环境执行）

import {
  DshAdapter,
  probeDshCompatibility,
  DshRuntimeError
} from '../../src/core/dsh-adapter';
import { createLogger } from '../../src/core/logger';

const LIVE = process.env.AKO_DSH_LIVE === '1';

function quietLogger(): ReturnType<typeof createLogger> {
  return createLogger({ level: 'error', sinks: [] });
}

describe('DSH 兼容性探针（默认无真包环境）', () => {
  it('返回结构化 not-installed 结论（不抛错）', async () => {
    const probe = await probeDshCompatibility();
    expect(probe.package_name).toBe('@deepseek-ai/dsh-agent');
    if (!LIVE) {
      expect(probe.present).toBe(false);
      expect(probe.surface).toBe('not-installed');
      expect(probe.reason).toContain('未安装');
    } else {
      expect(['runtime-ready', 'mismatch', 'faulted']).toContain(probe.surface);
    }
  });

  it('适配器对缺失运行时返回 runtime-missing 状态', async () => {
    const adapter = new DshAdapter({}, quietLogger());
    const status = await adapter.initialize();
    if (!LIVE) {
      expect(status.state).toBe('runtime-missing');
    } else {
      expect(['runtime-ready', 'version-blocked', 'surface-mismatch', 'faulted']).toContain(
        status.state
      );
    }
  });

  it('未就绪时 runSession 抛类型化错误（防误用降级）', async () => {
    const adapter = new DshAdapter({}, quietLogger());
    await expect(
      adapter.runSession([{ role: 'user', content: 'hello' }])
    ).rejects.toBeInstanceOf(DshRuntimeError);
  });
});

if (LIVE) {
  describe('真包 live E2E（AKO_DSH_LIVE=1，需完整 DeepSeek Harness 私有源）', () => {
    it('loader 与探针一致性：probe 就绪则 adapter 可初始化', async () => {
      const probe = await probeDshCompatibility();
      const adapter = new DshAdapter({}, quietLogger());
      const status = await adapter.initialize();
      if (probe.surface === 'runtime-ready') {
        expect(status.state).toBe('runtime-ready');
      } else {
        // 契约不匹配也应给出确定性的 type/诊断，而非静默成功
        expect(status.error_code).toBeDefined();
      }
      await adapter.close();
    });
  });
}
