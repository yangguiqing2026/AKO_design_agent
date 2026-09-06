// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/unit/memory-hub.test.ts
// 覆盖: MemoryHub 三级记忆读/写/召回语义（临时目录注入，纯单元级别）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MemoryHub, MemoryHubError } from '../../src/modules/memory/memory-hub';

let tmpDir: string;

function seedPath(): string {
  const file = path.join(tmpDir, 'seed.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      general: ['遵循AKO铁律', '使用环境变量'],
      security: ['沙箱隔离', '白名单默认拒绝']
    }),
    'utf8'
  );
  return file;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-memory-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MemoryHub 写/读/召回（短期记忆窗口）', () => {
  it('short_term 写入后按时间倒序读回', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir, now: () => 1000 });
    hub.write({ kind: 'short_term', session_id: 's1', content: '第一步：完成分析' });
    hub.write({ kind: 'short_term', session_id: 's1', content: '第二步：匹配到 react' });
    const entries = hub.read('short_term', { session_id: 's1' });
    expect(entries).toHaveLength(2);
    expect(entries[1].content).toBe('第一步：完成分析');
    expect(entries[0].content).toBe('第二步：匹配到 react');
    expect(entries[0].kind).toBe('short_term');
    expect(entries[0].id).toMatch(/^short_term-/);
  });

  it('短期窗口超出 max_short_term 时淘汰最旧', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir, maxShortTerm: 2, now: () => 1 });
    hub.write({ kind: 'short_term', session_id: 's1', content: 'a' });
    hub.write({ kind: 'short_term', session_id: 's1', content: 'b' });
    hub.write({ kind: 'short_term', session_id: 's1', content: 'c' });
    const entries = hub.read('short_term', { session_id: 's1' });
    expect(entries.map((e) => e.content)).toEqual(['c', 'b']);
  });

  it('空内容写入抛 MemoryHubError', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir });
    expect(() => hub.write({ kind: 'short_term', session_id: 's1', content: '   ' })).toThrow(
      MemoryHubError
    );
  });

  it('会话隔离：不同 session_id 互不可见', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir });
    hub.write({ kind: 'short_term', session_id: 's1', content: '仅会话1' });
    expect(hub.read('short_term', { session_id: 's2' })).toHaveLength(0);
  });
});

describe('MemoryHub 长期记忆（知识 seed + 用户追加）', () => {
  it('seed 加载为 global 长期记忆基底', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir, bestPracticesPath: seedPath() });
    expect(hub.seedCount).toBeGreaterThanOrEqual(2);
    const ltm = hub.read('long_term');
    expect(ltm.some((e) => e.content.includes('沙箱隔离'))).toBe(true);
  });

  it('用户追加 long_term 后持久化并重载可见', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir, bestPracticesPath: seedPath() });
    hub.write({ kind: 'long_term', session_id: 's9', content: '用户偏好：优先使用 v4-pro', tags: ['preference'] });
    const reloaded = new MemoryHub({ memoryDir: tmpDir, bestPracticesPath: seedPath() });
    const ltm = reloaded.read('long_term');
    expect(ltm.some((e) => e.content.includes('用户偏好'))).toBe(true);
  });

  it('seed 文件损坏 → 以空基底启动并告警', () => {
    const bad = path.join(tmpDir, 'bad-seed.json');
    fs.writeFileSync(bad, '{ 非法 json', 'utf8');
    const warns: string[] = [];
    const hub = new MemoryHub({
      memoryDir: tmpDir,
      bestPracticesPath: bad,
      warn: (m) => warns.push(m)
    });
    expect(hub.seedCount).toBe(0);
    expect(warns.length).toBe(1);
  });
});

describe('MemoryHub 情景记忆 + 召回打分 + 清理', () => {
  it('episodic 写入后跨实例持久化', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir, now: () => 5 });
    hub.write({
      kind: 'episodic',
      session_id: 's-42',
      content: '案例：plan-execute 模式用于多步编排，验证通过后交付',
      tags: ['plan-execute', 'success']
    });
    const reloaded = new MemoryHub({ memoryDir: tmpDir });
    const list = reloaded.read('episodic', { session_id: 's-42' });
    expect(list).toHaveLength(1);
    expect(list[0].tags).toContain('plan-execute');
  });

  it('recall 按关键词打分降序返回，min_score/limit 生效', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir });
    hub.write({ kind: 'short_term', session_id: 's1', content: 'react 适合标准工具调用', tags: ['react'] });
    hub.write({ kind: 'short_term', session_id: 's1', content: 'hierarchical 适合多 agent', tags: ['hierarchical'] });
    const hits = hub.recall('short_term', 'react', { session_id: 's1' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.content).toContain('react');
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hub.recall('short_term', '不存在的词xyz', { session_id: 's1' })).toHaveLength(0);
  });

  it('clearSession 移除短期/情景记忆文件', () => {
    const hub = new MemoryHub({ memoryDir: tmpDir });
    hub.write({ kind: 'short_term', session_id: 'sX', content: '临时' });
    hub.write({ kind: 'episodic', session_id: 'sX', content: '情景' });
    expect(fs.existsSync(path.join(tmpDir, 'short-term', 'sX.json'))).toBe(true);
    hub.clearSession('sX');
    expect(fs.existsSync(path.join(tmpDir, 'short-term', 'sX.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'episodic', 'sX.json'))).toBe(false);
  });
});
