import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DemoExecutionContext } from "./run-context.js";

export interface ManagedToolResult {
  ok: boolean;
  code: string;
  modelView: unknown;
  artifact?: string;
}

export interface InvokeRequest {
  toolCallId: string;
  modelName: string;
  args: Record<string, unknown>;
  context: DemoExecutionContext;
  signal?: AbortSignal;
}

interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".yaml",
  ".yml",
]);

export class DemoToolRuntime {
  private readonly callCounts = new Map<string, number>();

  async invoke(request: InvokeRequest): Promise<ManagedToolResult> {
    try {
      switch (request.modelName) {
        case "list_files":
          return await this.listFiles(request);
        case "search_code":
          return await this.searchCode(request);
        case "read_file":
          return await this.readSourceFile(request);
        case "write_file":
          return await this.writeArtifact(request);
        default:
          return failure("TOOL_NOT_FOUND", `未注册工具：${request.modelName}`);
      }
    } catch (error) {
      if (request.signal?.aborted) {
        return failure("ABORTED", "工具执行已取消");
      }
      return failure(
        "TOOL_EXECUTION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  getHandlerCallCount(toolName: string): number {
    return this.callCounts.get(toolName) ?? 0;
  }

  private async listFiles(request: InvokeRequest): Promise<ManagedToolResult> {
    this.bump("list_files");
    const rawPath = asString(request.args.path, ".");
    const directory = resolveWithin(request.context.repoRoot, rawPath);
    const entries = await walk(directory, request.signal);
    return success("OK", {
      basePath: relativeTo(request.context.repoRoot, directory),
      files: entries.map((entry) => relativeTo(
        request.context.repoRoot,
        entry,
      )),
    });
  }

  private async searchCode(request: InvokeRequest): Promise<ManagedToolResult> {
    this.bump("search_code");
    const query = requiredString(request.args.query, "query");
    const rawPath = asString(request.args.path, ".");
    const directory = resolveWithin(request.context.repoRoot, rawPath);
    const files = await walk(directory, request.signal);
    const matches: SearchMatch[] = [];

    for (const filePath of files) {
      request.signal?.throwIfAborted();
      if (!TEXT_EXTENSIONS.has(path.extname(filePath))) {
        continue;
      }

      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        if (line.includes(query)) {
          matches.push({
            path: relativeTo(request.context.repoRoot, filePath),
            line: index + 1,
            preview: line.trim(),
          });
        }
      });
    }

    return success("OK", {
      query,
      path: relativeTo(request.context.repoRoot, directory),
      matches: matches.slice(0, 20),
      total: matches.length,
    });
  }

  private async readSourceFile(
    request: InvokeRequest,
  ): Promise<ManagedToolResult> {
    this.bump("read_file");
    const rawPath = requiredString(request.args.path, "path");
    const filePath = resolveWithin(request.context.repoRoot, rawPath);
    const content = await readFile(filePath, "utf8");
    return success("OK", {
      path: relativeTo(request.context.repoRoot, filePath),
      content,
    });
  }

  private async writeArtifact(request: InvokeRequest): Promise<ManagedToolResult> {
    this.bump("write_file");
    const rawPath = requiredString(request.args.path, "path");
    const content = requiredString(request.args.content, "content");

    if (!rawPath.startsWith("artifacts/")) {
      return failure("ARTIFACT_PATH_DENIED", "本节演示只允许写入 artifacts/ 目录");
    }

    const filePath = resolveWithin(
      request.context.projectRoot,
      rawPath,
    );
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");

    return success(
      "OK",
      {
        path: rawPath,
        bytes: Buffer.byteLength(content, "utf8"),
      },
      rawPath,
    );
  }

  private bump(toolName: string): void {
    this.callCounts.set(
      toolName,
      (this.callCounts.get(toolName) ?? 0) + 1,
    );
  }
}

function success(
  code: string,
  modelView: unknown,
  artifact?: string,
): ManagedToolResult {
  return {
    ok: true,
    code,
    modelView,
    artifact,
  };
}

function failure(code: string, message: string): ManagedToolResult {
  return {
    ok: false,
    code,
    modelView: {
      code,
      message,
    },
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0
    ? value
    : fallback;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`参数 ${field} 必须是非空字符串`);
  }
  return value;
}

function resolveWithin(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  const normalizedRoot = path.resolve(root);
  if (
    resolved !== normalizedRoot
    && !resolved.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error(`路径越界：${target}`);
  }
  return resolved;
}

function relativeTo(root: string, target: string): string {
  const relativePath = path.relative(root, target);
  return relativePath.length === 0 ? "." : relativePath;
}

async function walk(
  root: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const output: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    signal?.throwIfAborted();
    const current = queue.shift()!;
    const entries = await readdir(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }

      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }

      output.push(nextPath);
    }
  }

  return output.sort((left, right) => left.localeCompare(right));
}
