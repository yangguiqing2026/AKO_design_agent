// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/unit/validation-pipeline.test.ts
// 覆盖: critic evaluator 管道——Schema→结构→沙箱 顺序短路、metrics/token 估算、可注入开关。

import {
  buildPipelineEvaluator,
  estimateProfileTokens,
  type SandboxProfileChecker
} from '../../src/modules/validator/validation-pipeline';
import type { ProfileConfig } from '../../src/interfaces/config.interface';

const GOOD_PROFILE: ProfileConfig = {
  name: 'good',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [
    { id: 'a', config: { loop: 'default' } },
    { id: 'b', config: { tools: ['x'] }, meta: { depends_on: ['a'] } }
  ]
};

function passingSandbox(): SandboxProfileChecker & { calls: number } {
  const checker = {
    calls: 0,
    async run() {
      checker.calls += 1;
      return { ok: true, blocked: false, summary: { status: 'ok' } };
    }
  };
  return checker;
}

function blockedSandbox(): SandboxProfileChecker {
  return {
    run: async () => ({
      ok: false,
      blocked: true,
      summary: { status: 'failed', reason: '检测到危险指令' }
    })
  };
}

describe('validation-pipeline：通过与 metrics', () => {
  it('全链路通过：verdict=pass + metrics（latency/token 估算）', async () => {
    const evaluator = buildPipelineEvaluator({ sandbox: passingSandbox(), now: () => 100 });
    const result = await evaluator(GOOD_PROFILE);
    expect(result.verdict).toBe('pass');
    expect(result.metrics?.latency_ms).toBeGreaterThanOrEqual(0);
    expect(result.metrics?.token_count).toBeGreaterThan(0);
  });

  it('estimateProfileTokens：按序列化字符/4 估算且恒 >=1', () => {
    expect(estimateProfileTokens(GOOD_PROFILE)).toBeGreaterThan(0);
    expect(estimateProfileTokens(GOOD_PROFILE)).toBe(
      Math.max(1, Math.ceil(JSON.stringify(GOOD_PROFILE).length / 4))
    );
  });

  it('未注入沙箱时仍通过（结构校验为底线）', async () => {
    const evaluator = buildPipelineEvaluator();
    const result = await evaluator(GOOD_PROFILE);
    expect(result.verdict).toBe('pass');
  });
});

describe('validation-pipeline：短路与失败', () => {
  it('Schema 非法 → 直接 fail 且不调用沙箱', async () => {
    const sandbox = passingSandbox();
    const evaluator = buildPipelineEvaluator({ sandbox });
    const bad = { name: 1, bundles: [], patches: [] };
    const result = await evaluator(bad as never);
    expect(result.verdict).toBe('fail');
    expect(result.errorLog).toContain('name');
    expect(sandbox.calls).toBe(0);
  });

  it('结构校验失败（patch id 重复）→ fail', async () => {
    const evaluator = buildPipelineEvaluator();
    const duplicate = {
      ...GOOD_PROFILE,
      patches: [
        { id: 'dup', config: {} },
        { id: 'dup', config: {} }
      ]
    };
    const result = await evaluator(duplicate);
    expect(result.verdict).toBe('fail');
    expect(result.errorLog).toContain('重复');
  });

  it('沙箱 blocked → fail（拦截原因透出）', async () => {
    const evaluator = buildPipelineEvaluator({ sandbox: blockedSandbox() });
    const result = await evaluator(GOOD_PROFILE);
    expect(result.verdict).toBe('fail');
    expect(result.errorLog).toContain('拦截');
  });

  it('可注入开关关闭 schema/结构校验后，沙箱成为唯一判据', async () => {
    const evaluator = buildPipelineEvaluator({ enableSchema: false, enableStructural: false });
    const result = await evaluator({ name: 1, bundles: [], patches: [] } as never);
    expect(result.verdict).toBe('pass'); // 无沙箱时视为 pass（纯 schema 关闭场景）
  });
});
