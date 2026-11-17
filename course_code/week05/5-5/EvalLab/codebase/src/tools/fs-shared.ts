import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** 第三方产物与构建输出不属于"代码库理解"的范围，遍历一律跳过。 */
export const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next"]);

const MAX_DEPTH = 16;

export async function* walkFiles(directory: string, depth = 0): AsyncGenerator<string> {
  if (depth > MAX_DEPTH) return;
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      yield* walkFiles(absolutePath, depth + 1);
    } else if (entry.isFile()) {
      yield absolutePath;
    }
  }
}

/** 二进制判定：出现 NUL 字节即认为不是文本，不做魔数识别。 */
export function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8_000);
  return sample.includes(0);
}
