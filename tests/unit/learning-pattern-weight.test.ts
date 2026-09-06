// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/unit/learning-pattern-weight.test.ts
// 覆盖: 模式权重统计式更新——单调性/有界(0.5–2.0)/计数去重/持久化重载/确定性。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  DEFAULT_PATTERN_WEIGHT,
  LOSS_MULTIPLIER,
  PatternWeightStore,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WIN_MULTIPLIER
} from '../../src/modules/learning/pattern-weight';

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ako-w-')), 'weights.json');
});

afterEach(() => {
  fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
});

describe('PatternWeightStore 更新规则', () => {
  it('未知模式权重为 1.0，record 缺省基准一致', () => {
    const store = new PatternWeightStore({ file: tmpFile, now: () => 1 });
    expect(store.weightOf('react')).toBe(DEFAULT_PATTERN_WEIGHT);
    const delta = store.record('react', 'win');
    expect(delta.before).toBe(1);
    expect(delta.after).toBe(1.15);
  });

  it('成功单调上升且有界（<=2.0）；次数去重计数 wins', () => {
    const store = new PatternWeightStore({ file: tmpFile, now: () => 1 });
    let prev = 1;
    let delta = store.record('ptc', 'win');
    for (let i = 0; i < 10; i += 1) {
      expect(delta.after).toBeLessThanOrEqual(WEIGHT_MAX);
      if (delta.after < WEIGHT_MAX) {
        expect(delta.after).toBeGreaterThan(prev);
      }
      prev = delta.after;
      delta = store.record('ptc', 'win');
    }
    const stats = store.statsOf('ptc');
    expect(stats?.hits).toBe(11);
    expect(stats?.wins).toBe(11);
    expect(stats?.losses).toBe(0);
    expect(stats?.weight).toBe(WEIGHT_MAX);
  });

  it('失败单调下降且有界（>=0.5）；losses 计数', () => {
    const store = new PatternWeightStore({ file: tmpFile, now: () => 1 });
    store.record('react', 'win'); // 1.15
    let delta = store.record('react', 'loss'); // 1.15*0.85=0.9775→0.978(round)
    expect(delta.after).toBeLessThan(delta.before);
    for (let i = 0; i < 10; i += 1) {
      delta = store.record('react', 'loss');
      expect(delta.after).toBeGreaterThanOrEqual(WEIGHT_MIN);
    }
    const stats = store.statsOf('react');
    expect(stats?.losses).toBe(11);
    expect(stats?.wins).toBe(1);
  });

  it('因子常量与边界一致（乘性公式可复算）', () => {
    expect(WIN_MULTIPLIER).toBe(1.15);
    expect(LOSS_MULTIPLIER).toBe(0.85);
    expect(WEIGHT_MIN).toBe(0.5);
    expect(WEIGHT_MAX).toBe(2);
  });
});

describe('PatternWeightStore 持久化与确定性', () => {
  it('record 后磁盘重载：快照完全一致（幂等往返）', () => {
    const store = new PatternWeightStore({ file: tmpFile, now: () => 100 });
    store.record('react', 'win');
    store.record('plan-execute', 'loss');
    const reloaded = new PatternWeightStore({ file: tmpFile, now: () => 100 });
    expect(reloaded.snapshot()).toEqual(store.snapshot());
    expect(reloaded.weightOf('react')).toBe(1.15);
    expect(reloaded.weightOf('plan-execute')).toBe(0.85);
  });

  it('snapshot 键按 id 排序、未知模式不计入', () => {
    const store = new PatternWeightStore({ file: tmpFile, now: () => 1 });
    store.record('ptc', 'win');
    store.record('react', 'loss');
    expect(Object.keys(store.snapshot())).toEqual(['ptc', 'react']);
    expect(Object.keys(store.snapshot())).not.toContain('hierarchical');
  });

  it('权重文件损坏 → 以空表启动并告警', () => {
    fs.writeFileSync(tmpFile, '{broken', 'utf8');
    const warns: string[] = [];
    const store = new PatternWeightStore({ file: tmpFile, warn: (m) => warns.push(m) });
    expect(store.weightOf('react')).toBe(1);
    expect(warns.length).toBe(1);
  });

  it('schema/version 校验：非 pattern-weights 结构被忽略', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ schema: 'other', weights: { react: { weight: 9, hits: 1, wins: 1, losses: 0, updated_at: 1 } } }), 'utf8');
    const store = new PatternWeightStore({ file: tmpFile });
    expect(store.weightOf('react')).toBe(1);
  });
});
