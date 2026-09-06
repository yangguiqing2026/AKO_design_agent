// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/unit/case-store.test.ts
// 覆盖: 案例沉淀——append/list/会话过滤/字段往返/损坏容错/非法规整。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CaseStore, normalizeCase } from '../../src/modules/learning/case-store';
import type { CaseRecord } from '../../src/interfaces/learning.interface';
import type { ProfileConfig } from '../../src/interfaces/config.interface';

const PROFILE: ProfileConfig = {
  name: 'agent-x',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [{ id: 'loop', config: { loop: 'default' } }]
};

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ako-case-')), 'cases.json');
});

afterEach(() => {
  fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
});

describe('CaseStore 案例沉淀', () => {
  it('append 生成 case_id/created_at 并落盘', () => {
    const store = new CaseStore({ file: tmpFile, now: () => 42 });
    const record = store.append({
      session_id: 's1',
      trace_id: 't1',
      source: 'critic_loop',
      verdict: 'accepted',
      interrupted: false,
      retry_count: 1,
      pattern_id: 'react',
      profile: PROFILE
    });
    expect(record.case_id).toMatch(/^case-42-/);
    expect(record.created_at).toBe(42);
    expect(store.list()).toHaveLength(1);
  });

  it('list 可按会话过滤，按 created_at 倒序', () => {
    const store = new CaseStore({ file: tmpFile, now: () => 1 });
    store.append({ session_id: 'a', source: 'critic_loop', verdict: 'rejected', interrupted: true, retry_count: 3 });
    store.append({ session_id: 'b', source: 'human_interrupt', verdict: 'accepted', interrupted: false, retry_count: 0 });
    expect(store.list({ session_id: 'a' })).toHaveLength(1);
    expect(store.list({ session_id: 'b' })[0].source).toBe('human_interrupt');
    expect(store.list()).toHaveLength(2);
  });

  it('跨实例持久化：新实例读取已落库案例且字段完整', () => {
    const store = new CaseStore({ file: tmpFile, now: () => 7 });
    store.append({
      session_id: 's9',
      trace_id: 'tr-9',
      source: 'critic_loop',
      verdict: 'partial',
      interrupted: false,
      retry_count: 2,
      pattern_id: 'plan-execute',
      profile: PROFILE,
      error_log: ['a', 'b'],
      fixed_config: { ...PROFILE, name: 'agent-x-fixed' }
    });
    const reloaded = new CaseStore({ file: tmpFile });
    const records = reloaded.list({ session_id: 's9' });
    expect(records).toHaveLength(1);
    expect(records[0].profile?.name).toBe('agent-x');
    expect(records[0].fixed_config?.name).toBe('agent-x-fixed');
    expect(records[0].error_log).toEqual(['a', 'b']);
    expect(records[0].pattern_id).toBe('plan-execute');
  });

  it('损坏案例文件 → 以空列表重建并告警', () => {
    fs.writeFileSync(tmpFile, '{corrupt', 'utf8');
    const warns: string[] = [];
    const store = new CaseStore({ file: tmpFile, warn: (m) => warns.push(m) });
    expect(store.list()).toHaveLength(0);
    expect(warns.length).toBe(1);
    // 重建后可继续追加
    store.append({ session_id: 'x', source: 'critic_loop', verdict: 'accepted', interrupted: false, retry_count: 0 });
    expect(store.list()).toHaveLength(1);
  });

  it('列表内非法条目在加载时被过滤', () => {
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
    fs.writeFileSync(
      tmpFile,
      JSON.stringify([
        { case_id: 'c-ok', source: 'critic_loop', verdict: 'accepted', interrupted: false, retry_count: 0, created_at: 1 },
        { case_id: 'c-bad', source: 'unknown' }
      ]),
      'utf8'
    );
    const store = new CaseStore({ file: tmpFile });
    expect(store.list()).toHaveLength(1);
  });
});

describe('normalizeCase 防御性规整', () => {
  it('null/非法字段返回 null', () => {
    expect(normalizeCase(null)).toBeNull();
    expect(normalizeCase({ case_id: 'x' })).toBeNull();
    expect(normalizeCase({ case_id: 'x', source: 'critic_loop', verdict: 'accepted', interrupted: false, retry_count: 'nope', created_at: 1 })).toBeNull();
  });

  it('合法对象往返保留字段', () => {
    const input: CaseRecord = {
      case_id: 'c1',
      session_id: 's',
      source: 'critic_loop',
      verdict: 'accepted',
      interrupted: false,
      retry_count: 0,
      created_at: 1
    };
    expect(normalizeCase(input)?.session_id).toBe('s');
  });
});
