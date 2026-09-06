// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: tests/integration/session-manager.test.ts
// 覆盖: 会话生命周期——保存推进 → 磁盘恢复 → 续跑完整一轮（失败后断点续跑语义）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { DesignContext } from '../../src/interfaces/design-context.interface';
import type { StructuredRequirement } from '../../src/interfaces/design-context.interface';
import { CheckpointStore } from '../../src/modules/session-manager/checkpoint-store';
import { SessionManager } from '../../src/modules/session-manager/session-manager';

const STRUCTURED: StructuredRequirement = {
  task_type: 'coding',
  environment: { network_access: false, sandbox_required: true, permission_level: 'read_write' },
  performance: {},
  extensibility_expected: true
};

function advanceAndSave(manager: SessionManager, ctx: DesignContext, label: string): DesignContext {
  const saved = manager.checkpoint(ctx, label);
  return saved.ctx;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ako-session-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SessionManager：保存推进与断点恢复', () => {
  it('create → 保存各阶段 → 新实例 resume 还原上下文并续跑到完成', () => {
    const manager = new SessionManager(new CheckpointStore({ dir: tmpDir, now: () => 100 }));

    // 第一进程：分析→匹配，保存两个检查点后“中断”
    let ctx = manager.create('it-session', '设计一个可扩展的多步任务 Agent');
    ctx = advanceAndSave(manager, { ...ctx, status: 'analyzing' }, 'analyzing');
    ctx = advanceAndSave(
      manager,
      {
        ...ctx,
        status: 'matching',
        structured_req: STRUCTURED,
        complexity: 'medium',
        checkpoint: 'analyzed'
      },
      'matching'
    );
    expect(manager.latestStatus('it-session')).toBe('matching');

    // 模拟进程崩溃：全新 store 目录指向同一磁盘
    const recoveredStore = new CheckpointStore({ dir: tmpDir, now: () => 200 });
    const recoveredManager = new SessionManager(recoveredStore);
    const restored = recoveredManager.resume('it-session');
    expect(restored).not.toBeNull();
    expect(restored?.structured_req?.task_type).toBe('coding');
    expect(restored?.complexity).toBe('medium');
    expect(restored?.status).toBe('matching');

    // 续跑：matching → generating → validating（保留分析结果字段）
    let resumed: DesignContext = restored as DesignContext;
    resumed = advanceAndSave(
      recoveredManager,
      { ...resumed, status: 'generating', matched_pattern_id: 'react', checkpoint: 'matched' },
      'generating'
    );
    resumed = advanceAndSave(
      recoveredManager,
      { ...resumed, status: 'validating', retry_count: 1, validation_errors: ['待修复'], checkpoint: 'generated' },
      'validating'
    );
    resumed = advanceAndSave(
      recoveredManager,
      { ...resumed, status: 'completed', validation_errors: undefined, checkpoint: 'delivered' },
      'completed'
    );
    expect(recoveredManager.latestStatus('it-session')).toBe('completed');

    // 已完成会话不可重复续跑（幂等）
    expect(recoveredManager.resume('it-session')).toBeNull();
  });

  it('resume 保留 retry_count 与生成的 profile（失败续跑不归零）', () => {
    const manager = new SessionManager(new CheckpointStore({ dir: tmpDir, now: () => 1 }));
    let ctx = manager.create('it-retry', '需求');
    ctx = advanceAndSave(
      manager,
      {
        ...ctx,
        status: 'validating',
        complexity: 'complex',
        generated_profile: {
          name: 'agent-x',
          bundles: ['@deepseek-ai/dsh-base'],
          patches: [{ id: 'loop', config: { loop: 'default' } }]
        },
        retry_count: 2,
        validation_errors: ['两次修复后仍失败'],
        checkpoint: 'validating->generate'
      },
      'validating'
    );
    const again = new SessionManager(new CheckpointStore({ dir: tmpDir, now: () => 2 }));
    const restored = again.resume('it-retry');
    expect(restored?.retry_count).toBe(2);
    expect(restored?.generated_profile?.name).toBe('agent-x');
    expect(restored?.validation_errors).toEqual(['两次修复后仍失败']);
  });

  it('无检查点会话 resume 返回 null；next 复用状态机静态推进', () => {
    const manager = new SessionManager(new CheckpointStore({ dir: tmpDir }));
    expect(manager.resume('no-such-session')).toBeNull();
    const ctx = manager.create('s-new', '需求');
    expect(manager.next(ctx)).toBe('analyzing');
    manager.reset('s-new');
    expect(manager.latestStatus('s-new')).toBeNull();
  });
});
