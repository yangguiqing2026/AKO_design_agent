// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/modules/memory/memory-hub.ts
// 职责: 三级记忆中枢（Sprint 2 B 模块）。
//   - short_term：按会话窗口，受 max_short_term 约束（超出淘汰最旧）
//   - long_term ：知识 seed（knowledge/best-practices.json）加载为只读基底 +
//                 用户追加项持久化到 memoryDir/long-term.json
//   - episodic  ：会话情景条目，持久化到 memoryDir/episodic/<session_id>.json
//   - recall    ：确定性关键词打分（内容/标签命中计数），供 Prompt 组装注入记忆提示
//   持久目录默认 sandbox/data/memory/，构造器可注入（测试/装配均可覆盖）。

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  IMemoryHub,
  MemoryEntry,
  MemoryKind,
  MemoryQueryOptions,
  MemoryRecallHit,
  NewMemoryEntry
} from '../../interfaces/memory.interface';
import { readJsonFile, writeJsonAtomic } from '../persist/atomic-json';

/** 记忆库错误 */
export class MemoryHubError extends Error {
  readonly code = 'MEMORY_HUB_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'MemoryHubError';
  }
}

const LONG_TERM_FILE = 'long-term.json';
const SHORT_TERM_DIR = 'short-term';
const EPISODIC_DIR = 'episodic';

const DEFAULT_MAX_SHORT_TERM = 20;
const DEFAULT_MEMORY_DIR = 'sandbox/data/memory';
const DEFAULT_BEST_PRACTICES = 'knowledge/best-practices.json';

export interface MemoryHubOptions {
  /** 持久化根目录（默认 sandbox/data/memory，可注入） */
  readonly memoryDir?: string;
  /** 长期记忆 seed 文件路径（best-practices JSON），可注入 */
  readonly bestPracticesPath?: string;
  /** 短期窗口上限（默认 20，与 runtime.max_steps 同一数量级） */
  readonly maxShortTerm?: number;
  /** 时间源（默认 Date.now） */
  readonly now?: () => number;
  /** 告警 sink（seed 文件损坏等非致命问题） */
  readonly warn?: (message: string) => void;
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.kind === 'string' &&
    typeof record.session_id === 'string' &&
    (record.scope === 'session' || record.scope === 'global') &&
    typeof record.content === 'string' &&
    typeof record.created_at === 'number'
  );
}

function normalizeEntryList(value: unknown): MemoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isMemoryEntry).map((entry) => ({
    ...entry,
    tags: entry.tags === undefined ? undefined : [...entry.tags]
  }));
}

function normalizeSeed(value: unknown): MemoryEntry[] {
  // 知识 seed 形态：{ 分类: [条目, ...] }；每项展开为 global 长期记忆
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  const entries: MemoryEntry[] = [];
  const seen = new Set<string>();
  for (const [category, items] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(items)) {
      continue;
    }
    for (const item of items) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        continue;
      }
      const content = `[${category}] ${item.trim()}`;
      if (seen.has(content)) {
        continue;
      }
      seen.add(content);
      entries.push({
        id: `lt-seed-${category}-${entries.length}`,
        kind: 'long_term',
        session_id: '__knowledge__',
        scope: 'global',
        content,
        created_at: 0
      });
    }
  }
  return entries;
}

/** 记忆中枢实现（实现 IMemoryHub；方法同步便于装配与测试确定性） */
export class MemoryHub implements IMemoryHub {
  private readonly memoryDir: string;
  private readonly maxShortTerm: number;
  private readonly nowProvider: () => number;
  private readonly warnSink: (message: string) => void;
  private readonly seedEntries: readonly MemoryEntry[];
  private seq = 0;

  constructor(options: MemoryHubOptions = {}) {
    this.memoryDir = path.resolve(options.memoryDir ?? DEFAULT_MEMORY_DIR);
    this.maxShortTerm = options.maxShortTerm ?? DEFAULT_MAX_SHORT_TERM;
    this.nowProvider = options.now ?? ((): number => Date.now());
    this.warnSink = options.warn ?? ((): void => undefined);
    this.seedEntries = this.loadSeed(options.bestPracticesPath ?? DEFAULT_BEST_PRACTICES);
    this.ensureDirs();
  }

  /** 已加载的知识 seed 条数（供装配/测试观察） */
  get seedCount(): number {
    return this.seedEntries.length;
  }

  write(entry: NewMemoryEntry): MemoryEntry {
    const kind = entry.kind;
    const scope = entry.scope ?? (kind === 'long_term' ? 'global' : 'session');
    const created = this.nowProvider();
    this.seq += 1;
    const stored: MemoryEntry = {
      id: `${kind}-${created}-${this.seq}`,
      kind,
      session_id: entry.session_id,
      scope,
      content: entry.content.trim(),
      ...(entry.tags !== undefined && entry.tags.length > 0 ? { tags: [...entry.tags] } : {}),
      created_at: created
    };
    if (stored.content.length === 0) {
      throw new MemoryHubError('记忆内容不能为空');
    }

    if (kind === 'long_term') {
      const list = this.loadLongTermList();
      list.push(stored);
      writeJsonAtomic(path.join(this.memoryDir, LONG_TERM_FILE), list);
      return stored;
    }

    const list = this.loadSessionList(kind, entry.session_id);
    list.push(stored);
    const trimmed = kind === 'short_term' ? trimToWindow(list, this.maxShortTerm) : list;
    writeJsonAtomic(this.sessionFilePath(kind, entry.session_id), trimmed);
    return stored;
  }

  read(kind: MemoryKind, options: MemoryQueryOptions = {}): readonly MemoryEntry[] {
    const sorted = this.listFor(kind, options.session_id).slice().sort(
      (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id)
    );
    const limited = options.limit === undefined ? sorted : sorted.slice(0, options.limit);
    return limited.map((entry) => ({
      ...entry,
      tags: entry.tags === undefined ? undefined : [...entry.tags]
    }));
  }

  recall(
    kind: MemoryKind,
    query: string,
    options: MemoryQueryOptions = {}
  ): readonly MemoryRecallHit[] {
    const tokens = tokenize(query);
    const list = this.listFor(kind, options.session_id);
    const scored: MemoryRecallHit[] = list
      .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
      .filter(
        (hit) => hit.score > 0 && (options.min_score === undefined || hit.score >= options.min_score)
      );
    scored.sort(
      (a, b) =>
        b.score - a.score || b.entry.created_at - a.entry.created_at || a.entry.id.localeCompare(b.entry.id)
    );
    const limited = options.limit === undefined ? scored : scored.slice(0, options.limit);
    return limited.map((hit) => ({
      entry: {
        ...hit.entry,
        tags: hit.entry.tags === undefined ? undefined : [...hit.entry.tags]
      },
      score: hit.score
    }));
  }

  clearSession(sessionId: string): void {
    for (const dir of [SHORT_TERM_DIR, EPISODIC_DIR]) {
      const file = path.join(this.memoryDir, dir, `${sessionId}.json`);
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
      }
    }
  }

  private listFor(kind: MemoryKind, sessionId?: string): MemoryEntry[] {
    if (kind === 'long_term') {
      const globalOnly = this.loadLongTermList();
      return sessionId === undefined ? globalOnly : globalOnly.filter((e) => e.session_id === sessionId);
    }
    if (sessionId !== undefined) {
      return this.loadSessionList(kind, sessionId);
    }
    // 全量（跨会话）读取：扫描 kind 目录下的会话文件
    const dir = path.join(this.memoryDir, kindDirName(kind));
    if (!fs.existsSync(dir)) {
      return [];
    }
    const all: MemoryEntry[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) {
        continue;
      }
      const loaded = readJsonFile(path.join(dir, file));
      if (loaded.ok) {
        all.push(...normalizeEntryList(loaded.value));
      }
    }
    all.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    return all;
  }

  private loadSessionList(kind: MemoryKind, sessionId: string): MemoryEntry[] {
    const result = readJsonFile(this.sessionFilePath(kind, sessionId));
    if (!result.ok) {
      return [];
    }
    const list = normalizeEntryList(result.value);
    list.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
    return list;
  }

  private loadLongTermList(): MemoryEntry[] {
    const file = path.join(this.memoryDir, LONG_TERM_FILE);
    const result = readJsonFile(file);
    if (result.ok) {
      const list = normalizeEntryList(result.value);
      // 落库文件已存在即信任磁盘（seed 变更不回灌，避免覆盖用户追加项）
      if (list.length > 0 || this.seedEntries.length === 0) {
        return list;
      }
    }
    // 首写初始化：将 seed 落盘作为长期记忆基底
    if (this.seedEntries.length > 0) {
      writeJsonAtomic(file, [...this.seedEntries]);
      return [...this.seedEntries];
    }
    return [];
  }

  private loadSeed(bestPracticesPath: string): readonly MemoryEntry[] {
    const result = readJsonFile(path.resolve(bestPracticesPath));
    if (!result.ok) {
      if (result.reason === 'invalid') {
        this.warnSink(`best-practices seed 读取失败（将以空基底启动）：${result.detail ?? ''}`);
      }
      return [];
    }
    return normalizeSeed(result.value);
  }

  private sessionFilePath(kind: MemoryKind, sessionId: string): string {
    return path.join(this.memoryDir, kindDirName(kind), `${sessionId}.json`);
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.memoryDir, { recursive: true });
    fs.mkdirSync(path.join(this.memoryDir, SHORT_TERM_DIR), { recursive: true });
    fs.mkdirSync(path.join(this.memoryDir, EPISODIC_DIR), { recursive: true });
  }
}

function kindDirName(kind: MemoryKind): string {
  switch (kind) {
    case 'short_term':
      return SHORT_TERM_DIR;
    case 'episodic':
      return EPISODIC_DIR;
    default:
      throw new MemoryHubError('long_term 不使用会话目录存储');
  }
}

function trimToWindow(list: MemoryEntry[], window: number): MemoryEntry[] {
  if (list.length <= window) {
    return list;
  }
  return list.slice(list.length - window);
}

function tokenize(query: string): string[] {
  const lowered = query.toLowerCase();
  return lowered.split(/[\s,，。;；、/()（）]+/).filter((t) => t.length > 0);
}

function scoreEntry(entry: MemoryEntry, tokens: readonly string[]): number {
  const content = entry.content.toLowerCase();
  const tagText = (entry.tags ?? []).join(' ').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (content.includes(token)) {
      score += 2;
    }
    if (tagText.includes(token)) {
      score += 1;
    }
  }
  return score;
}
