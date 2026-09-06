// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/integration/memory-hub.test.ts
// 覆盖: 临时目录持久化/重载 + 目录结构约定（short-term/episodic/long-term.json 落盘形态）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MemoryHub } from '../../src/modules/memory/memory-hub';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-memory-it-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MemoryHub 持久化与重载（integration）', () => {
  it('三级记忆落盘形态符合目录约定', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir });
    hub.write({ kind: 'short_term', session_id: 'it-1', content: '步骤日志' });
    hub.write({ kind: 'episodic', session_id: 'it-1', content: '会话小结' });
    expect(fs.existsSync(path.join(tmpDir, 'short-term', 'it-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'episodic', 'it-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'long-term.json'))).toBe(false); // 无 seed 时不建文件
  });

  it('多次写入幂等重载：新实例读到的条目数/顺序一致', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir, now: () => 100 });
    for (let i = 0; i < 5; i += 1) {
      hub.write({ kind: 'episodic', session_id: 'it-2', content: `case-${i}` });
    }
    const again = new MemoryHub({ memoryDir: tmpDir, now: () => 100 });
    const entries = again.read('episodic', { session_id: 'it-2' });
    expect(entries.map((e) => e.content)).toEqual(['case-4', 'case-3', 'case-2', 'case-1', 'case-0']);
    // 原始 JSON 文件可被直接解析（原子写无半截）
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'episodic', 'it-2.json'), 'utf8')) as unknown[];
    expect(raw).toHaveLength(5);
  });

  it('短期窗口与磁盘淘汰一致（重载后仍遵守窗口上限）', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir, maxShortTerm: 3, now: () => 1 });
    for (const content of ['a', 'b', 'c', 'd']) {
      hub.write({ kind: 'short_term', session_id: 'it-3', content });
    }
    const reloaded = new MemoryHub({ memoryDir: tmpDir, maxShortTerm: 3 });
    const entries = reloaded.read('short_term', { session_id: 'it-3' });
    expect(entries.map((e) => e.content).sort()).toEqual(['b', 'c', 'd']);
  });

  it('损坏的会话文件被容忍（清空该会话，不阻断其他会话）', () => {
    fs.mkdirSync(path.join(tmpDir, 'short-term'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'short-term', 'broken.json'), '{not-json', 'utf8');
    const hub = new MemoryHub({ memoryDir: tmpDir });
    expect(hub.read('short_term', { session_id: 'broken' })).toHaveLength(0);
    hub.write({ kind: 'short_term', session_id: 'ok', content: 'fine' });
    expect(hub.read('short_term', { session_id: 'ok' })).toHaveLength(1);
  });
});
