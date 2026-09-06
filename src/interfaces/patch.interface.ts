// AKO_studio - Design Agent v1.0.1
// 文件名: src/interfaces/patch.interface.ts
// 职责: Patch / 组件依赖图契约（v1.0.1 修正，无 any）。
//
// 语义声明：Cordis Patch 采用【整行替换】语义（非 deep-merge）——
//   - patch.config 的每个键都会【整体替换】基础配置中同键的值（对象子树不再递归合并）；
//   - 因此 diff 生成器必须输出“完整行”（被替换子树的全量快照），配合
//     config-generator 的 assertAdditive 保证“不丢失原配置字段”（白皮书验收项）。
//   - meta.depends_on / build_order 用于组件拓扑排序与构建顺序注解。

/** Patch 拓扑元数据 */
export interface PatchMeta {
  /** 依赖的其他组件/Patch ID 列表（构建前必须就绪） */
  readonly depends_on: readonly string[];
  /** 拓扑排序后的构建顺序（从 0 开始，由 sortPatchesTopologically/annotateBuildOrder 填充） */
  readonly build_order?: number;
}

/**
 * Cordis Patch（v1.0.1 修正：整行替换语义，非 deep-merge）
 */
export interface CordisPatch {
  readonly id: string;
  readonly config?: Record<string, unknown>;
  readonly insert?: ReadonlyArray<Record<string, unknown>>;
  /** v1.0.1 新增：Patch 元数据，用于拓扑排序 */
  readonly meta?: PatchMeta;
}

/** 组件依赖图节点 */
export interface ComponentNode {
  readonly id: string;
  readonly config: Record<string, unknown>;
  /** 依赖的其他组件 ID */
  readonly dependencies: readonly string[];
}

/** 组件目录（含依赖关系定义） */
export interface ComponentCatalog {
  readonly components: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly dependencies: readonly string[];
        readonly description?: string;
      }
    >
  >;
}
