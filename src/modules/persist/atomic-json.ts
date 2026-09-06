// AKO_studio - Design Agent v1.0.1 (Sprint 2)
// 文件名: src/modules/persist/atomic-json.ts
// 职责: 本地 JSON 读写助手（tmp+rename 原子写，复用 cost-circuit 的持久化模式）。
//   - 读：缺失/损坏以类型化结果返回（不抛错），由调用方决定重建或告警
//   - 写：目录自动创建，先写 .tmp 再 rename，避免半截 JSON
//   供 memory/checkpoint/learning 三套持久化复用，保持写入语义一致。

import * as fs from 'node:fs';
import * as path from 'node:path';

/** JSON 文件读取结果（discriminated union，无 any） */
export type JsonFileReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: 'missing' | 'invalid'; readonly detail?: string };

/** 读取 JSON 文件；文件不存在或非法 JSON 均不抛错 */
export function readJsonFile(filePath: string): JsonFileReadResult {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'missing' };
  }
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { ok: false, reason: 'invalid', detail: `读取失败：${String(err)}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, reason: 'invalid', detail: `JSON 解析失败：${String(err)}` };
  }
}

/** 原子写入 JSON（tmp + rename） */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/** 从合法列表输入（unknown）过滤出 MemoryEntry 形态的规整数组；空输入返回空数组 */
export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 从合法对象输入（unknown）过滤出字符串映射 */
export function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string')
  );
}
