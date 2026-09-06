// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/tools/generate-profile.tool.ts
// 职责: 生成配置文件工具（Sprint 2 由 stub 落地）。
//   - 消费 PromptAssembler（组装 System Prompt/模型路由）+ pattern-matcher +
//     组件目录（knowledge/component-catalog.json），产出 DesignProfile
//   - 确定性规则生成：依赖拓扑 meta（depends_on + build_order 注解）随后经
//     patch-validator 强校验（结构合法 + patch id 唯一）
//   - 不调用真实 LLM：LLM 在线生成留待 v2.0；本工具是可注入 seam 的默认实现

import type { DesignContext } from '../interfaces/design-context.interface';
import type { DesignProfile } from '../interfaces/config.interface';
import type { CordisPatch } from '../interfaces/config.interface';
import type { PatternMatcher } from '../modules/pattern-matcher';
import type { PromptAssembler } from '../prompts/assembler';
import { annotateBuildOrder, buildProfile } from '../modules/config-generator/patch-builder';
import { assertValidProfile } from '../modules/config-generator/patch-validator';

/** 组件目录数据（knowledge/component-catalog.json 的收敛形态） */
export interface ComponentCatalogData {
  readonly bundles: readonly string[];
  readonly tools: readonly string[];
}

/** 默认组件目录（与 knowledge/component-catalog.json 当前值对齐） */
export const DEFAULT_COMPONENT_CATALOG: ComponentCatalogData = {
  bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'custom/code-review-tools'],
  tools: ['git-tool', 'linter-tool', 'search-tool']
};

/** 生成错误 */
export class GenerateProfileError extends Error {
  readonly code = 'GENERATE_PROFILE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'GenerateProfileError';
  }
}

export interface GenerateProfileToolOptions {
  readonly assembler: PromptAssembler;
  readonly matcher: PatternMatcher;
  readonly catalog?: ComponentCatalogData;
  readonly now?: () => string;
}

export interface GenerateProfileInput {
  readonly ctx: DesignContext;
  readonly user_prompt: string;
  readonly memory_hints?: readonly string[];
}

/** 生成结果 */
export interface GeneratedProfile {
  readonly profile: DesignProfile;
  readonly system_prompt: string;
  readonly route: { readonly model: string; readonly endpoint: string };
}

/** 从模式 harness 组件构造补丁（带依赖链 meta，交给 annotateBuildOrder 注解） */
function patchesFromComponents(patternId: string, components: readonly string[]): CordisPatch[] {
  return components.map((component, index) => ({
    id: `${patternId}-harness-${index}`,
    config: { component: component, order: index },
    meta: {
      depends_on: index === 0 ? [] : [`${patternId}-harness-${index - 1}`]
    }
  }));
}

/** profile 名（确定性 slug，全部非 ASCII/非词符剥除；兜底 design-profile） */
function profileNameFrom(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length >= 3 ? slug : 'design-profile';
}

/** 按模式 id 确定性选择 bundles（base 恒入；超出按模式 id 取模增选一个） */
function pickBundles(catalog: ComponentCatalogData, patternId: string): readonly string[] {
  const base = catalog.bundles.find((b) => b.includes('dsh-base'));
  const others = catalog.bundles.filter((b) => b !== base);
  const selected: string[] = base === undefined ? (others.length > 0 ? [others[0]] : []) : [base];
  if (others.length > 0) {
    const hash = patternId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const extra = others[hash % others.length];
    if (extra !== undefined && !selected.includes(extra)) {
      selected.push(extra);
    }
  }
  return selected;
}

/** 生成配置文件工具 */
export class GenerateProfileTool {
  private readonly assembler: PromptAssembler;
  private readonly matcher: PatternMatcher;
  private readonly catalog: ComponentCatalogData;
  private readonly nowProvider: () => string;

  constructor(options: GenerateProfileToolOptions) {
    this.assembler = options.assembler;
    this.matcher = options.matcher;
    this.catalog = options.catalog ?? DEFAULT_COMPONENT_CATALOG;
    this.nowProvider = options.now ?? ((): string => new Date().toISOString());
  }

  async generate(input: GenerateProfileInput): Promise<GeneratedProfile> {
    const ctx = input.ctx;
    const complexity = ctx.complexity;
    const patternId = ctx.matched_pattern_id ?? 'react';
    const usedPattern = this.matcher.patternById(patternId) ?? this.matcher.patternById('react');

    const assembled = this.assembler.assemble({
      trace_id: ctx.trace_id,
      task_type: ctx.structured_req?.task_type,
      complexity,
      now: this.nowProvider(),
      memory_hints: input.memory_hints
    });

    const patternIdForArtifacts = usedPattern?.id ?? patternId;
    const harnessComponents =
      usedPattern !== undefined ? usedPattern.harness_components : ['默认 Agent Loop'];
    const harnessPatches = patchesFromComponents(patternIdForArtifacts, harnessComponents);
    const tools = this.catalog.tools.slice(0, 2);
    const toolsPatch: CordisPatch = {
      id: `${patternIdForArtifacts}-tools`,
      config: { tools },
      meta: { depends_on: harnessPatches.map((p) => p.id) }
    };
    const bundles = pickBundles(this.catalog, patternIdForArtifacts);

    const profile = buildProfile({
      name: profileNameFrom(input.user_prompt),
      description: `AKO 自动生成设计（Sprint 2 generate-profile.tool；模式=${patternIdForArtifacts}）`,
      bundles,
      patches: annotateBuildOrder([...harnessPatches, toolsPatch])
    });

    // 强校验：结构合法 + patch id 唯一 + 拓扑注解完整
    assertValidProfile(profile);
    for (const patch of profile.patches) {
      if (patch.meta?.build_order === undefined) {
        throw new GenerateProfileError(`patch ${patch.id} 缺少 build_order 注解`);
      }
    }
    const ids = profile.patches.map((p) => p.id);
    if (new Set(ids).size !== ids.length) {
      throw new GenerateProfileError('生成结果存在重复 patch id');
    }

    return {
      profile,
      system_prompt: assembled.system_prompt,
      route: { model: assembled.meta.model, endpoint: assembled.meta.endpoint }
    };
  }
}
