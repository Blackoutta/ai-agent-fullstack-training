import { matchesGlob, relative } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { Type } from "typebox";
import type { ManagedTool } from "../domain.js";
import { ToolRuntimeError } from "../domain.js";
import type { Sandbox } from "../sandbox.js";
import { integer, optionalText, text } from "./args.js";
import { clipLinesHead, formatBytes } from "./clip.js";
import { isBinary, walkFiles } from "./fs-shared.js";

const GREP_LINE_CHARS = 500;

function rel(sandbox: Sandbox, absolutePath: string): string {
  return relative(sandbox.root, absolutePath);
}

function matchesPattern(relPath: string, pattern: string): boolean {
  return relPath === pattern || matchesGlob(relPath, pattern);
}

/** 行号前缀与 pi 的 read 工具同形：`  42| ` 表示文件第 42 行。 */
function numbered(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length).length;
  return lines.map((line, index) => `${String(startLine + index).padStart(width)}| ${line}`).join("\n");
}

export function createReadFileTool(sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "read_file",
      description:
        "读取工作区内的文本文件，输出带行号。内容超过上限时按头部提示的 offset 续读，不要指望一次拿到全文，也不要用它读二进制文件。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          path: Type.String({ description: "文件路径，相对工作区根目录，例如 src/routes/login.ts；目录请改用 read_directory", minLength: 1 }),
          offset: Type.Optional(Type.Number({ description: "起始行号，从 1 开始，默认 1", minimum: 1 })),
          limit: Type.Optional(
            Type.Number({ description: "最多读取的行数，默认读到结尾；一次最多 2000 行", minimum: 1, maximum: 2_000 }),
          ),
        },
        { additionalProperties: false },
      ),
      risk: "read",
      permissions: ["repo:read"],
      requiresConfirmation: false,
      timeoutMs: 5_000,
      maxRetries: 2,
      idempotent: true,
      source: "local",
    },
    async handler({ args }) {
      const absolutePath = sandbox.check(text(args, "path"));
      const buffer = await readFile(absolutePath);
      if (isBinary(buffer)) {
        throw new ToolRuntimeError("BINARY_FILE", `${args.path} 含 NUL 字节，按二进制处理，read_file 不读`);
      }

      const allLines = buffer.toString("utf8").split("\n");
      const start = integer(args, "offset", 1) - 1;
      if (start >= allLines.length) {
        throw new ToolRuntimeError("OFFSET_OUT_OF_RANGE", `offset ${start + 1} 超过文件总行数 ${allLines.length}`);
      }
      const requested = args.limit === undefined ? allLines.length - start : integer(args, "limit", allLines.length);
      const selected = allLines.slice(start, start + Math.max(requested, 0));
      const clip = clipLinesHead(selected, sandbox.rules.maxReadChars);
      const lastShown = start + clip.lines.length;
      const nextOffset = lastShown < allLines.length ? lastShown + 1 : null;

      return [
        `${rel(sandbox, absolutePath)} · 共 ${allLines.length} 行 · 显示 ${start + 1}-${lastShown}` +
          (nextOffset ? ` · 续读用 offset=${nextOffset}` : " · 已到文件末尾"),
        numbered(clip.lines, start + 1),
      ].join("\n");
    },
  };
}

export function createReadDirectoryTool(sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "read_directory",
      description: "列出某个目录的下一层条目，目录名以 / 结尾。看目录结构用它；递归找文件用 list_files。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          path: Type.Optional(Type.String({ description: "目录路径，默认工作区根目录；相对形式，不要以 / 开头", minLength: 1 })),
          limit: Type.Optional(
            Type.Number({ description: "最多返回多少条，默认 200，上限 500", minimum: 1, maximum: 500 }),
          ),
        },
        { additionalProperties: false },
      ),
      risk: "read",
      permissions: ["repo:read"],
      requiresConfirmation: false,
      timeoutMs: 5_000,
      maxRetries: 2,
      idempotent: true,
      source: "local",
    },
    async handler({ args }) {
      const absolutePath = sandbox.check(optionalText(args, "path") ?? ".");
      const limit = integer(args, "limit", 200);
      const entries = await readdir(absolutePath, { withFileTypes: true });
      entries.sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name);
      });

      const rows: string[] = [];
      for (const entry of entries.slice(0, limit)) {
        if (entry.isDirectory()) {
          rows.push(`${entry.name}/`);
        } else {
          const info = await stat(`${absolutePath}/${entry.name}`);
          rows.push(`${entry.name}  ${formatBytes(info.size)}`);
        }
      }
      const shown = rel(sandbox, absolutePath) || ".";
      return [
        `${shown} · ${entries.length} 项` + (entries.length > limit ? ` · 只列出前 ${limit} 条` : ""),
        ...rows,
      ].join("\n");
    },
  };
}

export function createListFilesTool(sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "list_files",
      description: "按 glob 递归查找文件路径，自动跳过 node_modules/.git/dist/build 等目录。用于回答“这个仓库里有哪些相关文件”。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          pattern: Type.String({
            description: "glob 模式，例如 **/*.ts 或 src/routes/**；比对的是相对路径，所以不要写成 /**/*.ts",
            minLength: 1,
          }),
          path: Type.Optional(Type.String({ description: "起始目录，默认工作区根目录；相对形式，不要以 / 开头", minLength: 1 })),
          limit: Type.Optional(
            Type.Number({ description: "最多返回多少条，默认 200，上限 500", minimum: 1, maximum: 500 }),
          ),
        },
        { additionalProperties: false },
      ),
      risk: "read",
      permissions: ["repo:read"],
      requiresConfirmation: false,
      timeoutMs: 8_000,
      maxRetries: 2,
      idempotent: true,
      source: "local",
    },
    async handler({ args }) {
      const scope = sandbox.check(optionalText(args, "path") ?? ".");
      const pattern = text(args, "pattern");
      const limit = integer(args, "limit", 200);

      const matched: string[] = [];
      let scanned = 0;
      for await (const filePath of walkFiles(scope)) {
        scanned += 1;
        if (matchesPattern(rel(sandbox, filePath), pattern)) {
          matched.push(rel(sandbox, filePath));
          if (matched.length >= limit) break;
        }
      }
      return [
        `${pattern} · 命中 ${matched.length} 个文件（扫描 ${scanned} 个）` +
          (matched.length === 0 ? " · 没有匹配，换个 pattern 或放宽 path" : ""),
        ...matched,
      ].join("\n");
    },
  };
}

export function createSearchCodeTool(sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "search_code",
      description:
        "在工作区文本文件中搜关键字或正则，命中格式为 路径:行号: 内容。定位代码位置的第一步，找到行号后再用 read_file 读上下文。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          pattern: Type.String({
            description: "搜索内容；literal 为 true 时按字面量，否则按正则解释，正则必须能编译",
            minLength: 1,
          }),
          path: Type.Optional(Type.String({ description: "限定到某个目录或单个文件，默认整个工作区；相对形式", minLength: 1 })),
          glob: Type.Optional(
            Type.String({ description: "只搜匹配该 glob 的文件，例如 **/*.ts；比对的是相对路径，不要以 / 开头", minLength: 1 }),
          ),
          ignoreCase: Type.Optional(Type.Boolean({ description: "是否忽略大小写，默认 false" })),
          literal: Type.Optional(Type.Boolean({ description: "true 时按字面量匹配，不做正则解释" })),
          context: Type.Optional(Type.Number({ description: "每条命中额外带前后各几行，默认 0，最多 10", minimum: 0, maximum: 10 })),
          limit: Type.Optional(Type.Number({ description: "最多命中条数，默认 50，上限 200", minimum: 1, maximum: 200 })),
        },
        { additionalProperties: false },
      ),
      risk: "read",
      permissions: ["repo:read"],
      requiresConfirmation: false,
      timeoutMs: 15_000,
      maxRetries: 2,
      idempotent: true,
      source: "local",
    },
    async handler({ args }) {
      const scope = sandbox.check(optionalText(args, "path") ?? ".");
      const raw = text(args, "pattern");
      let tester: (line: string) => boolean;
      try {
        const source = args.literal === true ? raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : raw;
        const regexp = new RegExp(source, args.ignoreCase === true ? "i" : "");
        tester = (line) => regexp.test(line);
      } catch (error) {
        throw new ToolRuntimeError("INVALID_PATTERN", error instanceof Error ? error.message : "正则无法编译");
      }
      const glob = optionalText(args, "glob");
      const around = integer(args, "context", 0);
      const limit = integer(args, "limit", 50);

      const rows: string[] = [];
      let hits = 0;
      let files = 0;
      let bytes = 0;
      search: for (const filePath of await collectFiles(sandbox, scope)) {
        files += 1;
        if (glob && !matchesPattern(rel(sandbox, filePath), glob)) continue;
        const buffer = await readFile(filePath);
        bytes += buffer.length;
        if (isBinary(buffer)) continue;
        const path = rel(sandbox, filePath);
        const lines = buffer.toString("utf8").split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          if (!tester(lines[index])) continue;
          hits += 1;
          const from = Math.max(0, index - around);
          for (let cursor = from; cursor < index; cursor += 1) {
            rows.push(`${path}-${cursor + 1}- ${lines[cursor].trimEnd()}`);
          }
          rows.push(`${path}:${index + 1}: ${lines[index].slice(0, GREP_LINE_CHARS).trimEnd()}`);
          for (let cursor = index + 1; cursor <= Math.min(lines.length - 1, index + around); cursor += 1) {
            rows.push(`${path}-${cursor + 1}- ${lines[cursor].trimEnd()}`);
          }
          if (hits >= limit) break search;
        }
      }
      return [
        `${raw} · 命中 ${hits} 处（扫描 ${files} 个文件 / ${formatBytes(bytes)}）` +
          (hits === 0 ? " · 没有命中，换关键字或用 list_files 先看目录" : "") +
          (hits >= limit ? " · 已达 limit 上限，缩小 path 或提高 limit" : ""),
        ...rows,
      ].join("\n");
    },
  };
}

async function collectFiles(sandbox: Sandbox, scope: string): Promise<string[]> {
  const info = await stat(scope);
  if (info.isFile()) return [scope];
  const files: string[] = [];
  for await (const filePath of walkFiles(scope)) files.push(filePath);
  return files;
}
