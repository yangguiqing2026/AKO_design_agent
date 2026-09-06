// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/unit/checkpoint-store.test.ts
// 覆盖: 检查点 save/load/list/latest/removeSession、上下文全量快照往返、
//       损坏文件容忍与告警、原子 JSON 落盘。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CheckpointStore, normalizeCheckpoint } from '../../src/modules/session-manager/checkpoint-store';
import type { DesignContext } from '../../src/interfaces/design-context.interface';
import { createDesignContext } from '../../src/interfaces/design-context.interface';
import type { ProfileConfig } from '../../src/interfaces/config.interface';

const PROFILE: ProfileConfig = {
  name: 'code-agent',
  bundles: ['@deepseek-ai/dsh-base'],
  patches: [
    { id: 'loop', config: { loop: 'default' } },
    { id: 'tools', config: { tools: ['search'] }, meta: { depends_on: ['loop'] } }
  ]
};

function baseCtx(overrides: Partial<DesignContext> = {}): DesignContext {
  return {
    ...createDesignContext({ session_id: 's-1', user_prompt: '设计一个多步编码 Agent' }),
    ...overrides
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-cp-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('CheckpointStore 基本语义', () => {
  it('save/load 往返：ctx 全量快照（含 retry_count/complexity/profile/errors）', () => {
    const store = new CheckpointStore({ dir: tmpDir, now: () => 100 });
    const ctx = baseCtx({
      status: 'validating',
      complexity: 'medium',
      generated_profile: PROFILE,
      validation_errors: ['需要修复 loop'],
      retry_count: 2,
      checkpoint: 'validating->generate'
    });
    const saved = store.save(ctx, 'validating');
    expect(saved.session_id).toBe('s-1');
    expect(saved.status).toBe('validating');

    const loaded = store.load(saved.checkpoint_id);
    expect(loaded).not.toBeNull();
    expect(loaded?.ctx.retry_count).toBe(2);
    expect(loaded?.ctx.complexity).toBe('medium');
    expect(loaded?.ctx.generated_profile?.patches).toHaveLength(2);
    expect(loaded?.ctx.validation_errors).toEqual(['需要修复 loop']);
    expect(loaded?.ctx.trace_id).toBe(ctx.trace_id);
  });

  it('load 不存在的 checkpoint_id 返回 null', () => {
    const store = new CheckpointStore({ dir: tmpDir });
    expect(store.load('cp-does-not-exist')).toBeNull();
  });

  it('list 按 seq 升序、latest 返回最后一个', () => {
    const store = new CheckpointStore({ dir: tmpDir, now: () => 1 });
    store.save(baseCtx({ status: 'analyzing' }), 'analyzing');
    store.save(baseCtx({ status: 'matching' }), 'matching');
    store.save(baseCtx({ status: 'generating' }), 'generating');
    const list = store.list('s-1');
    expect(list.map((c) => c.label)).toEqual(['analyzing', 'matching', 'generating']);
    expect(store.latest('s-1')?.label).toBe('generating');
    expect(store.latest('s-other')).toBeNull();
  });

  it('removeSession 删除该会话全部检查点（不影响其他会话）', () => {
    const store = new CheckpointStore({ dir: tmpDir, now: () => 1 });
    store.save(baseCtx({ session_id: 's-1', status: 'analyzing' }), 'a');
    store.save(baseCtx({ session_id: 's-2', status: 'analyzing' }), 'b');
    store.removeSession('s-1');
    expect(store.list('s-1')).toHaveLength(0);
    expect(store.list('s-2')).toHaveLength(1);
  });

  it('损坏 JSON / 结构非法文件被跳过并告警', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 's-1.broken.json'), '{not-json', 'utf8');
    fs.writeFileSync(
      path.join(tmpDir, 's-1.badshape.json'),
      JSON.stringify({ checkpoint_id: 'x' }),
      'utf8'
    );
    const warns: string[] = [];
    const store = new CheckpointStore({ dir: tmpDir, warn: (m) => warns.push(m) });
    store.save(baseCtx({ status: 'analyzing' }), 'ok');
    const list = store.list('s-1');
    expect(list).toHaveLength(1);
    expect(warns.length).toBe(2);
  });

  it('落盘文件为原子 JSON（可被直接解析，含 .json 后缀）', () => {
    const store = new CheckpointStore({ dir: tmpDir, now: () => 7 });
    const saved = store.save(baseCtx({ status: 'idle' }), 'begin');
    const files = fs.readdirSync(tmpDir);
    expect(files).toContain(`s-1.${saved.checkpoint_id}.json`);
    const raw = JSON.parse(
      fs.readFileSync(path.join(tmpDir, `s-1.${saved.checkpoint_id}.json`), 'utf8')
    ) as unknown;
    expect(normalizeCheckpoint(raw)?.ctx.session_id).toBe('s-1');
  });
});

describe('normalizeCheckpoint 防御性规整', () => {
  it('null/非对象/缺字段返回 null', () => {
    expect(normalizeCheckpoint(null)).toBeNull();
    expect(normalizeCheckpoint('x')).toBeNull();
    expect(normalizeCheckpoint({ checkpoint_id: 'c1' })).toBeNull();
    expect(
      normalizeCheckpoint({
        checkpoint_id: 'c1',
        session_id: 's1',
        seq: 1,
        status: 'unknown-status',
        label: 'x',
        ctx: {},
        created_at: 1
      })
    ).toBeNull();
  });
});
