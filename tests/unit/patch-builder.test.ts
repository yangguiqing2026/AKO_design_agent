// AKO_studio - Design Agent v1.0.1
// 文件名: tests/unit/patch-builder.test.ts
// 覆盖: 拓扑排序正确性（依赖先后）/ 循环依赖检测（CircularDependencyError）/
//       build_order 注解 / 外部依赖放行

import {
  annotateBuildOrder,
  CircularDependencyError,
  createPatch,
  sortPatchesTopologically
} from '../../src/modules/config-generator/patch-builder';
import type { CordisPatch } from '../../src/interfaces/config.interface';

describe('patch-builder：拓扑排序正确性', () => {
  it('3 个组件按依赖顺序重排（依赖者排在依赖之后）', () => {
    // 输入乱序：web → router → db（web 依赖 router，router 依赖 db）
    const patches: CordisPatch[] = [
      createPatch({ id: 'web', meta: { depends_on: ['router'] } }),
      createPatch({ id: 'db', meta: { depends_on: [] } }),
      createPatch({ id: 'router', meta: { depends_on: ['db'] } })
    ];
    const ordered = sortPatchesTopologically(patches).map((p) => p.id);
    expect(ordered).toHaveLength(3);
    expect(ordered.indexOf('db')).toBeLessThan(ordered.indexOf('router'));
    expect(ordered.indexOf('router')).toBeLessThan(ordered.indexOf('web'));
    expect(new Set(ordered)).toEqual(new Set(['web', 'db', 'router']));
  });

  it('输入已符合拓扑序时保持稳定顺序', () => {
    const patches: CordisPatch[] = [
      createPatch({ id: 'base', meta: { depends_on: [] } }),
      createPatch({ id: 'middle', meta: { depends_on: ['base'] } }),
      createPatch({ id: 'top', meta: { depends_on: ['middle'] } })
    ];
    const ordered = sortPatchesTopologically(patches).map((p) => p.id);
    expect(ordered).toEqual(['base', 'middle', 'top']);
  });

  it('指向集合外的依赖视为已满足（由组件目录提供）', () => {
    const patches: CordisPatch[] = [
      createPatch({ id: 'web', meta: { depends_on: ['external-catalog-x'] } }),
      createPatch({ id: 'api', meta: { depends_on: [] } })
    ];
    expect(() => sortPatchesTopologically(patches)).not.toThrow();
  });

  it('annotateBuildOrder 依拓扑序写入 0..n-1', () => {
    const annotated = annotateBuildOrder([
      createPatch({ id: 'web', meta: { depends_on: ['router'] } }),
      createPatch({ id: 'db', meta: { depends_on: [] } }),
      createPatch({ id: 'router', meta: { depends_on: ['db'] } })
    ]);
    const orderOf = new Map(annotated.map((p) => [p.id, p.meta?.build_order]));
    expect(orderOf.get('db')).toBe(0);
    expect(orderOf.get('router')).toBe(1);
    expect(orderOf.get('web')).toBe(2);
  });
});

describe('patch-builder：循环依赖检测', () => {
  it('直接互依（a↔b）抛 CircularDependencyError', () => {
    const patches: CordisPatch[] = [
      createPatch({ id: 'a', meta: { depends_on: ['b'] } }),
      createPatch({ id: 'b', meta: { depends_on: ['a'] } })
    ];
    expect(() => sortPatchesTopologically(patches)).toThrow(CircularDependencyError);
  });

  it('自依赖（a→a）抛 CircularDependencyError 且错误码明确', () => {
    const patches: CordisPatch[] = [createPatch({ id: 'a', meta: { depends_on: ['a'] } })];
    try {
      sortPatchesTopologically(patches);
      throw new Error('应当抛出 CircularDependencyError');
    } catch (err) {
      expect(err).toBeInstanceOf(CircularDependencyError);
      expect((err as CircularDependencyError).code).toBe('PATCH_CIRCULAR_DEPENDENCY');
      expect((err as CircularDependencyError).message).toContain('a');
    }
  });

  it('annotateBuildOrder 对成环输入同样抛 CircularDependencyError', () => {
    const patches: CordisPatch[] = [
      createPatch({ id: 'x', meta: { depends_on: ['y'] } }),
      createPatch({ id: 'y', meta: { depends_on: ['x'] } })
    ];
    expect(() => annotateBuildOrder(patches)).toThrow(CircularDependencyError);
  });
});
