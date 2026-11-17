export interface ClipResult {
  text: string;
  truncated: boolean;
  total_chars: number;
}

/**
 * 从头保留 maxChars 个字符。截断单位取字符而不是字节，也不引 pi 的 truncateHead：
 * 它的口径是"行数 + 字节数"两个上限（truncate.d.ts:4-8），本节要把工具输出与
 * Agent 历史统一到同一个度量上，§P3 复用同一个函数。
 */
export function clipHead(value: string, maxChars: number): ClipResult {
  if (value.length <= maxChars) return { text: value, truncated: false, total_chars: value.length };
  return { text: value.slice(0, maxChars), truncated: true, total_chars: value.length };
}

/** 整行为单位裁剪，绝不返回半行；至少保留一行，否则压缩过的单行文件会返回空内容。 */
export function clipLinesHead(lines: string[], maxChars: number): { lines: string[]; truncated: boolean } {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    used += line.length + 1;
    if (used > maxChars && kept.length > 0) break;
    kept.push(line);
  }
  return { lines: kept, truncated: kept.length < lines.length };
}

export function formatBytes(count: number): string {
  if (count < 1_024) return `${count} B`;
  if (count < 1_024 * 1_024) return `${(count / 1_024).toFixed(1)} KB`;
  return `${(count / 1_024 / 1_024).toFixed(1)} MB`;
}
