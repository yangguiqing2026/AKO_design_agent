// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/modules/learning/pattern-weight.ts
// 职责: 模式权重统计式自动更新（FI-V-01 有据化，非语义向量版）。
//   - 权重规则：默认 1.0；成功乘 1.15、失败乘 0.85；有界 [0.5, 2.0]
//   - 每次命中递增 hits，胜/负分别计 wins/losses（同一模式去重累加）
//   - 持久化 JSON：默认 knowledge/patterns/weights.json（可注入；装配层可改指向沙箱目录）
//   - 确定性：record 前后快照返回差量；snapshot 键按 id 排序

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  IPatternWeightStore,
  PatternStats,
  PatternWeightDelta,
  PatternWeightsFile
} from '../../interfaces/learning.interface';
import { readJsonFile, writeJsonAtomic } from '../persist/atomic-json';

/** 权重边界与因子 */
export const WEIGHT_MIN = 0.5;
export const WEIGHT_MAX = 2.0;
export const WIN_MULTIPLIER = 1.15;
export const LOSS_MULTIPLIER = 0.85;
export const DEFAULT_PATTERN_WEIGHT = 1.0;

/** 权重文件默认路径（计划指定 knowledge/patterns/weights.json；装配可注入沙箱目录） */
const DEFAULT_WEIGHTS_FILE = 'knowledge/patterns/weights.json';

export interface PatternWeightStoreOptions {
  readonly file?: string;
  readonly now?: () => number;
  readonly warn?: (message: string) => void;
}

function isPatternStats(value: unknown): value is PatternStats {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.weight === 'number' &&
    typeof record.hits === 'number' &&
    typeof record.wins === 'number' &&
    typeof record.losses === 'number' &&
    typeof record.updated_at === 'number'
  );
}

function normalizeWeights(value: unknown): Readonly<Record<string, PatternStats>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  // schema 闸门：非 pattern-weights 结构整体忽略
  if (record.schema !== 'pattern-weights') {
    return {};
  }
  if (record.version !== undefined && record.version !== 1) {
    return {};
  }
  const weights = record.weights;
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
    return {};
  }
  const out: Record<string, PatternStats> = {};
  for (const [id, stats] of Object.entries(weights as Record<string, unknown>)) {
    if (isPatternStats(stats)) {
      out[id] = { ...stats };
    }
  }
  return out;
}

function roundWeight(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 模式权重存储实现 */
export class PatternWeightStore implements IPatternWeightStore {
  private readonly file: string;
  private readonly nowProvider: () => number;
  private readonly warnSink: (message: string) => void;
  private readonly stats: Map<string, PatternStats>;

  constructor(options: PatternWeightStoreOptions = {}) {
    this.file = path.resolve(options.file ?? DEFAULT_WEIGHTS_FILE);
    this.nowProvider = options.now ?? ((): number => Date.now());
    this.warnSink = options.warn ?? ((): void => undefined);
    const loaded = readJsonFile(this.file);
    const initial = loaded.ok ? normalizeWeights(loaded.value) : {};
    if (!loaded.ok && loaded.reason === 'invalid') {
      this.warnSink(`权重文件损坏，以空表启动：${loaded.detail ?? ''}`);
    }
    this.stats = new Map(Object.entries(initial));
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  weightOf(patternId: string): number {
    const stats = this.stats.get(patternId);
    return stats === undefined ? DEFAULT_PATTERN_WEIGHT : stats.weight;
  }

  statsOf(patternId: string): PatternStats | null {
    const stats = this.stats.get(patternId);
    return stats === undefined ? null : { ...stats };
  }

  record(patternId: string, outcome: 'win' | 'loss'): PatternWeightDelta {
    const existing = this.stats.get(patternId);
    const before = existing?.weight ?? DEFAULT_PATTERN_WEIGHT;
    const multiplier = outcome === 'win' ? WIN_MULTIPLIER : LOSS_MULTIPLIER;
    const after = roundWeight(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, before * multiplier)));
    const updated: PatternStats = {
      weight: after,
      hits: (existing?.hits ?? 0) + 1,
      wins: (existing?.wins ?? 0) + (outcome === 'win' ? 1 : 0),
      losses: (existing?.losses ?? 0) + (outcome === 'loss' ? 1 : 0),
      updated_at: this.nowProvider()
    };
    this.stats.set(patternId, updated);
    this.persist();
    return { pattern_id: patternId, outcome, before, after };
  }

  snapshot(): Readonly<Record<string, PatternStats>> {
    const out: Record<string, PatternStats> = {};
    for (const id of [...this.stats.keys()].sort()) {
      const stats = this.stats.get(id);
      if (stats !== undefined) {
        out[id] = { ...stats };
      }
    }
    return out;
  }

  private persist(): void {
    const weights: Record<string, PatternStats> = {};
    for (const [id, stats] of this.stats.entries()) {
      weights[id] = { ...stats };
    }
    const file: PatternWeightsFile = { schema: 'pattern-weights', version: 1, weights };
    writeJsonAtomic(this.file, file);
  }
}
