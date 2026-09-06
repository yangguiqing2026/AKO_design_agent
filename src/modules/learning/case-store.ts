// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/modules/learning/case-store.ts
// 职责: 会话案例沉淀（episodic JSON，原子落盘）。
//   - 默认路径 sandbox/data/learning/cases.json（构造可注入）
//   - 追加即持久化；损坏/非法条目加载时跳过
//   - CaseRecord 含 profile/verdict/error_log/fixed_config/pattern_id/trace，可回放复盘

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  CaseRecord,
  CaseRecordInput,
  CaseSource,
  CaseVerdict,
  ICaseStore
} from '../../interfaces/learning.interface';
import type { ProfileConfig } from '../../interfaces/config.interface';
import { readJsonFile, writeJsonAtomic } from '../persist/atomic-json';

/** 案例存储错误 */
export class CaseStoreError extends Error {
  readonly code = 'CASE_STORE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'CaseStoreError';
  }
}

const DEFAULT_CASES_FILE = 'sandbox/data/learning/cases.json';

export interface CaseStoreOptions {
  readonly file?: string;
  readonly now?: () => number;
  readonly warn?: (message: string) => void;
}

function isCaseSource(value: unknown): value is CaseSource {
  return value === 'critic_loop' || value === 'human_interrupt';
}

function isCaseVerdict(value: unknown): value is CaseVerdict {
  return value === 'accepted' || value === 'rejected' || value === 'partial';
}

function isProfile(value: unknown): value is ProfileConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    Array.isArray(record.bundles) &&
    Array.isArray(record.patches)
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 从 unknown 规整案例；非法返回 null */
export function normalizeCase(value: unknown): CaseRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.case_id !== 'string' ||
    !isCaseSource(record.source) ||
    !isCaseVerdict(record.verdict) ||
    typeof record.interrupted !== 'boolean' ||
    typeof record.retry_count !== 'number' ||
    typeof record.created_at !== 'number'
  ) {
    return null;
  }
  if (
    (record.session_id !== undefined && typeof record.session_id !== 'string') ||
    (record.trace_id !== undefined && typeof record.trace_id !== 'string') ||
    (record.pattern_id !== undefined && typeof record.pattern_id !== 'string') ||
    (record.profile !== undefined && !isProfile(record.profile)) ||
    (record.fixed_config !== undefined && !isProfile(record.fixed_config)) ||
    (record.error_log !== undefined && !isStringArray(record.error_log))
  ) {
    return null;
  }
  const base: CaseRecord = {
    case_id: record.case_id as string,
    source: record.source as CaseSource,
    verdict: record.verdict as CaseVerdict,
    interrupted: record.interrupted as boolean,
    retry_count: record.retry_count as number,
    created_at: record.created_at as number
  };
  return {
    ...base,
    ...(record.session_id !== undefined ? { session_id: record.session_id as string } : {}),
    ...(record.trace_id !== undefined ? { trace_id: record.trace_id as string } : {}),
    ...(record.pattern_id !== undefined ? { pattern_id: record.pattern_id as string } : {}),
    ...(record.profile !== undefined ? { profile: record.profile as ProfileConfig } : {}),
    ...(record.fixed_config !== undefined ? { fixed_config: record.fixed_config as ProfileConfig } : {}),
    ...(record.error_log !== undefined ? { error_log: record.error_log as readonly string[] } : {})
  };
}

/** 案例存储实现（实现 ICaseStore） */
export class CaseStore implements ICaseStore {
  private readonly file: string;
  private readonly nowProvider: () => number;
  private readonly warnSink: (message: string) => void;
  private seq = 0;

  constructor(options: CaseStoreOptions = {}) {
    this.file = path.resolve(options.file ?? DEFAULT_CASES_FILE);
    this.nowProvider = options.now ?? ((): number => Date.now());
    this.warnSink = options.warn ?? ((): void => undefined);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  append(input: CaseRecordInput): CaseRecord {
    const created = input.created_at ?? this.nowProvider();
    this.seq += 1;
    const record: CaseRecord = {
      case_id: `case-${created}-${this.seq}`,
      ...(input.session_id !== undefined ? { session_id: input.session_id } : {}),
      ...(input.trace_id !== undefined ? { trace_id: input.trace_id } : {}),
      source: input.source,
      verdict: input.verdict,
      interrupted: input.interrupted,
      retry_count: input.retry_count,
      ...(input.pattern_id !== undefined ? { pattern_id: input.pattern_id } : {}),
      ...(input.profile !== undefined ? { profile: input.profile } : {}),
      ...(input.fixed_config !== undefined ? { fixed_config: input.fixed_config } : {}),
      ...(input.error_log !== undefined && input.error_log.length > 0
        ? { error_log: [...input.error_log] }
        : {}),
      created_at: created
    };
    const list = this.loadAll();
    list.push(record);
    writeJsonAtomic(this.file, list);
    return record;
  }

  list(options: { readonly session_id?: string } = {}): readonly CaseRecord[] {
    const all = this.loadAll();
    const filtered =
      options.session_id === undefined ? all : all.filter((c) => c.session_id === options.session_id);
    filtered.sort((a, b) => b.created_at - a.created_at || a.case_id.localeCompare(b.case_id));
    return filtered.map((record) => record);
  }

  private loadAll(): CaseRecord[] {
    const result = readJsonFile(this.file);
    if (!result.ok) {
      if (result.reason === 'invalid') {
        this.warnSink(`案例文件损坏，以空列表重建：${result.detail ?? ''}`);
      }
      return [];
    }
    if (!Array.isArray(result.value)) {
      return [];
    }
    return result.value.map(normalizeCase).filter((item): item is CaseRecord => item !== null);
  }
}
