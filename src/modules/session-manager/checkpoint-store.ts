// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/modules/session-manager/checkpoint-store.ts
// 职责: 检查点存储（JSON 原子落盘，tmp+rename 复用 cost-circuit 模式）。
//   - 路径约定：{dir}/{session_id}.{checkpoint_id}.json（默认 sandbox/data/checkpoints，可注入）
//   - 损坏/非法检查点在加载时跳过并告警，不阻断会话恢复

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DesignCheckpoint, ICheckpointStore } from '../../interfaces/checkpoint.interface';
import type { DesignContext, DesignStatus } from '../../interfaces/design-context.interface';
import { readJsonFile, writeJsonAtomic } from '../persist/atomic-json';

/** 检查点错误 */
export class CheckpointStoreError extends Error {
  readonly code = 'CHECKPOINT_STORE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'CheckpointStoreError';
  }
}

const DEFAULT_CHECKPOINT_DIR = 'sandbox/data/checkpoints';

export interface CheckpointStoreOptions {
  /** 存储目录（默认 sandbox/data/checkpoints，可注入） */
  readonly dir?: string;
  /** 时间源（默认 Date.now） */
  readonly now?: () => number;
  /** 告警 sink */
  readonly warn?: (message: string) => void;
}

const DESIGN_STATUSES: readonly string[] = [
  'idle',
  'analyzing',
  'matching',
  'generating',
  'validating',
  'delivering',
  'interrupted',
  'error',
  'completed'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDesignStatus(value: unknown): value is DesignStatus {
  return typeof value === 'string' && (DESIGN_STATUSES as readonly string[]).includes(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** 从 unknown 规整检查点；非法返回 null（白名单式校验，无 any） */
export function normalizeCheckpoint(value: unknown): DesignCheckpoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const ctx = value.ctx;
  if (
    !isString(value.checkpoint_id) ||
    value.checkpoint_id.length === 0 ||
    !isString(value.session_id) ||
    typeof value.seq !== 'number' ||
    !isDesignStatus(value.status) ||
    !isString(value.label) ||
    typeof value.created_at !== 'number' ||
    !isRecord(ctx)
  ) {
    return null;
  }
  if (
    !isDesignStatus(ctx.status) ||
    !isString(ctx.trace_id) ||
    !isString(ctx.session_id) ||
    !isString(ctx.user_prompt) ||
    typeof ctx.cost_usd !== 'number' ||
    typeof ctx.retry_count !== 'number' ||
    !isString(ctx.checkpoint) ||
    typeof ctx.created_at !== 'number'
  ) {
    return null;
  }
  const normalizedCtx: DesignContext = {
    trace_id: ctx.trace_id as string,
    session_id: ctx.session_id as string,
    status: ctx.status as DesignStatus,
    user_prompt: ctx.user_prompt as string,
    cost_usd: ctx.cost_usd as number,
    retry_count: ctx.retry_count as number,
    checkpoint: ctx.checkpoint as string,
    created_at: ctx.created_at as number,
    ...(ctx.structured_req !== undefined
      ? { structured_req: ctx.structured_req as DesignContext['structured_req'] }
      : {}),
    ...(ctx.complexity !== undefined ? { complexity: ctx.complexity as DesignContext['complexity'] } : {}),
    ...(ctx.matched_pattern_id !== undefined
      ? { matched_pattern_id: ctx.matched_pattern_id as string }
      : {}),
    ...(ctx.generated_profile !== undefined
      ? { generated_profile: ctx.generated_profile as DesignContext['generated_profile'] }
      : {}),
    ...(ctx.validation_errors !== undefined
      ? { validation_errors: ctx.validation_errors as DesignContext['validation_errors'] }
      : {})
  };
  return {
    checkpoint_id: value.checkpoint_id as string,
    session_id: value.session_id as string,
    seq: value.seq as number,
    status: value.status as DesignStatus,
    label: value.label as string,
    ctx: normalizedCtx,
    created_at: value.created_at as number
  };
}

/** 检查点存储实现 */
export class CheckpointStore implements ICheckpointStore {
  private readonly dir: string;
  private readonly nowProvider: () => number;
  private readonly warnSink: (message: string) => void;
  private seq = 0;

  constructor(options: CheckpointStoreOptions = {}) {
    this.dir = path.resolve(options.dir ?? DEFAULT_CHECKPOINT_DIR);
    this.nowProvider = options.now ?? ((): number => Date.now());
    this.warnSink = options.warn ?? ((): void => undefined);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  save(ctx: DesignContext, label: string): DesignCheckpoint {
    const created = this.nowProvider();
    this.seq += 1;
    const checkpoint: DesignCheckpoint = {
      checkpoint_id: `cp-${created}-${this.seq}`,
      session_id: ctx.session_id,
      seq: this.seq,
      status: ctx.status,
      label,
      ctx,
      created_at: created
    };
    writeJsonAtomic(this.filePath(checkpoint.session_id, checkpoint.checkpoint_id), checkpoint);
    return checkpoint;
  }

  load(checkpointId: string): DesignCheckpoint | null {
    for (const file of this.listFiles()) {
      const loaded = readJsonFile(path.join(this.dir, file));
      if (!loaded.ok) {
        continue;
      }
      const normalized = normalizeCheckpoint(loaded.value);
      if (normalized !== null && normalized.checkpoint_id === checkpointId) {
        return normalized;
      }
    }
    return null;
  }

  latest(sessionId: string): DesignCheckpoint | null {
    const list = this.list(sessionId);
    return list.length === 0 ? null : list[list.length - 1];
  }

  list(sessionId: string): readonly DesignCheckpoint[] {
    const prefix = `${sessionId}.`;
    const checkpoints: DesignCheckpoint[] = [];
    for (const file of this.listFiles()) {
      if (!file.startsWith(prefix) || !file.endsWith('.json')) {
        continue;
      }
      const loaded = readJsonFile(path.join(this.dir, file));
      if (!loaded.ok) {
        this.warnSink(`检查点文件读取失败，跳过：${file}`);
        continue;
      }
      const normalized = normalizeCheckpoint(loaded.value);
      if (normalized === null || normalized.session_id !== sessionId) {
        this.warnSink(`检查点文件结构非法，跳过：${file}`);
        continue;
      }
      checkpoints.push(normalized);
    }
    checkpoints.sort((a, b) => a.seq - b.seq || a.created_at - b.created_at);
    return checkpoints;
  }

  removeSession(sessionId: string): void {
    const prefix = `${sessionId}.`;
    for (const file of this.listFiles()) {
      if (file.startsWith(prefix) && file.endsWith('.json')) {
        fs.rmSync(path.join(this.dir, file), { force: true });
      }
    }
  }

  private filePath(sessionId: string, checkpointId: string): string {
    return path.join(this.dir, `${sessionId}.${checkpointId}.json`);
  }

  private listFiles(): string[] {
    if (!fs.existsSync(this.dir)) {
      return [];
    }
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
  }
}
