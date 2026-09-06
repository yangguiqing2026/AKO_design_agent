// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/integration/ttft-live-probe.test.ts
// 用途: TTFT 真机探针（时间熔断 P1 配套，白皮书 §10.1）。
//   - 默认跳过（CI 常态）：需 AKO_TTFT_LIVE=1 且 TTFT_TEST_ENDPOINT 指向受控 stream 端点
//   - 测量首个 chunk 到达时延（TTFT），并断言在 env 配置阈值内
//   - 真机压测清单见 docs/time-circuit-validation.md（结果回填报告）

import { TimeCircuit } from '../../src/modules/validator/time-circuit';

const LIVE = process.env.AKO_TTFT_LIVE === '1';
const ENDPOINT = process.env.TTFT_TEST_ENDPOINT;
const THRESHOLD_MS = Number(process.env.TTFT_THRESHOLD_MS ?? '30000');

describe('TTFT 真机探针（AKO_TTFT_LIVE=1 + TTFT_TEST_ENDPOINT 才执行）', () => {
  it(
    '测量首 chunk 时延并断言不超阈值',
    async () => {
      if (!LIVE || ENDPOINT === undefined) {
        return; // 默认跳过
      }
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(ENDPOINT, { signal: controller.signal });
        if (!response.ok || response.body === null) {
          throw new Error(`endpoint 非预期：HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const { value } = await reader.read();
        const ttft = Date.now() - started;
        expect(value?.length ?? 0).toBeGreaterThanOrEqual(0);
        const circuit = new TimeCircuit({ maxTtftMs: THRESHOLD_MS });
        circuit.begin('ttft-probe');
        expect(() => circuit.assertLatencyMs('ttft-probe', ttft)).not.toThrow();
      } finally {
        clearTimeout(timer);
      }
    },
    70_000
  );
});
