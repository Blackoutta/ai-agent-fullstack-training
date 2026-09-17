// 统一 Tool Runtime：四种工具共用的受控执行基座。
// 边界：本层不调用模型、不做 pi 适配、不做轮数与重复动作控制、不直接向模型暴露。
// 治理顺序：未注册工具 → 参数校验 → 路径边界 → 执行 → 结果治理。
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { DemoExecutionContext } from "./run-context.js";

// 稳定错误码：调用方据此区分「取消 / 语义化拒绝 / 执行失败 / 未注册工具」。
export const ToolResultCode = {
  OK: "OK",
  ABORTED: "ABORTED",
  PATH_DENIED: "PATH_DENIED",
  ARTIFACT_PATH_DENIED: "ARTIFACT_PATH_DENIED",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
} as const;
export type ToolResultCode = (typeof ToolResultCode)[keyof typeof ToolResultCode];

// 受控结果：modelView 是唯一可进入模型上下文的部分；artifact 是工程侧产物路径。
export interface ManagedToolResult {
  ok: boolean;
  code: string;
  modelView: unknown;
  artifact?: string;
}

// 执行请求：所有工具调用走同一份入参结构，toolCallId 用于与 Tool Call 建立关联。
export interface InvokeRequest {
  toolCallId: string;
  modelName: string;
  // 未经验证的模型参数：始终按不可信输入处理，先过 Schema 再进 handler。
  args: Record<string, unknown>;
  context: DemoExecutionContext;
  signal?: AbortSignal;
}

interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

// 参数 Schema：与 handler 同源注册，避免「校验一套、执行另一套」。
// additionalProperties: false 用于拒绝模型臆造的多余字段。
export const ListFilesArgs = Type.Object(
  {
    path: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const SearchCodeArgs = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    path: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const ReadFileArgs = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const WriteFileArgs = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

interface ToolRegistration {
  readonly schema: TSchema;
  readonly handle: (request: InvokeRequest) => Promise<ManagedToolResult>;
}

// 遍历时跳过依赖目录与版本控制目录。
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git"]);

// 搜索只处理文本类源码与配置文件扩展名。
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
]);

const MAX_MATCHES = 50;

// 语义化拒绝：让「已知拒绝」与「未知异常」在错误归一里区分开。
class ToolDeniedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolDeniedError";
  }
}

export class DemoToolRuntime {
  private readonly callCounts = new Map<string, number>();
  private readonly tools: ReadonlyMap<string, ToolRegistration>;

  constructor() {
    this.tools = new Map<string, ToolRegistration>([
      ["list_files", { schema: ListFilesArgs, handle: (r) => this.listFiles(r) }],
      ["search_code", { schema: SearchCodeArgs, handle: (r) => this.searchCode(r) }],
      ["read_file", { schema: ReadFileArgs, handle: (r) => this.readSourceFile(r) }],
      ["write_file", { schema: WriteFileArgs, handle: (r) => this.writeArtifact(r) }],
    ]);
  }

  // 唯一执行入口：外部只能通过它触发任何工具能力。
  async invoke(request: InvokeRequest): Promise<ManagedToolResult> {
    try {
      const tool = this.tools.get(request.modelName);
      if (!tool) {
        return this.failure(
          ToolResultCode.TOOL_NOT_FOUND,
          `未注册工具：${request.modelName}`,
        );
      }

      // 模型参数视为不可信输入：Schema 不通过则 handler 不执行。
      if (!Value.Check(tool.schema, request.args)) {
        return this.failure(
          ToolResultCode.INVALID_ARGUMENT,
          `参数校验失败：${describeValueErrors(tool.schema, request.args)}`,
        );
      }

      return await tool.handle(request);
    } catch (error) {
      // 统一错误归一：取消 → 取消码；已知拒绝 → 语义化拒绝码；其它 → 执行失败码。
      if (request.signal?.aborted) {
        return this.failure(ToolResultCode.ABORTED, "工具执行已取消");
      }
      if (error instanceof ToolDeniedError) {
        return this.failure(error.code, error.message);
      }
      return this.failure(
        ToolResultCode.TOOL_EXECUTION_FAILED,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // handler 实际执行次数：参数校验失败或工具未注册都不计入。
  getHandlerCallCount(toolName: string): number {
    return this.callCounts.get(toolName) ?? 0;
  }

  // 能力 1：列出代码仓库文件，建立项目全貌。
  private async listFiles(request: InvokeRequest): Promise<ManagedToolResult> {
    this.bump("list_files");
    const rawPath = asRelativePath(request.args.path, ".");
    const directory = resolveWithin(request.context.repoRoot, rawPath);
    const files = await walk(directory, request.signal);

    return this.success(ToolResultCode.OK, {
      basePath: relativeTo(request.context.repoRoot, directory),
      files: files.map((file) => relativeTo(request.context.repoRoot, file)),
    });
  }

  // 能力 2：搜索代码文本或符号，用于尚不知道文件位置或调用方时定位线索。
  private async searchCode(request: InvokeRequest): Promise<ManagedToolResult> {
    this.bump("search_code");
    const query = requiredString(request.args.query, "query");
    const rawPath = asRelativePath(request.args.path, ".");
    const directory = resolveWithin(request.context.repoRoot, rawPath);
    const files = await walk(directory, request.signal);
    const matches: SearchMatch[] = [];

    for (const filePath of files) {
      // 每次迭代都响应取消信号，禁止忽略中止。
      request.signal?.throwIfAborted();

      if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        continue;
      }

      const content = await readFile(filePath, "utf8");
      content.split("\n").forEach((line, index) => {
        if (line.includes(query)) {
          matches.push({
            path: relativeTo(request.context.repoRoot, filePath),
            line: index + 1,
            preview: line.trim(),
          });
        }
      });
    }

    // 稳定排序：先按路径，再按行号。
    matches.sort((left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line);

    return this.success(ToolResultCode.OK, {
      query,
      path: relativeTo(request.context.repoRoot, directory),
      matches: matches.slice(0, MAX_MATCHES),
      total: matches.length,
    });
  }

  // 能力 3：读取源码文件，沿调用链确认真实实现。
  private async readSourceFile(request: InvokeRequest): Promise<ManagedToolResult> {
    this.bump("read_file");
    const rawPath = requiredString(request.args.path, "path");
    const filePath = resolveWithin(request.context.repoRoot, rawPath);
    const content = await readFile(filePath, "utf8");

    return this.success(ToolResultCode.OK, {
      path: relativeTo(request.context.repoRoot, filePath),
      content,
    });
  }

  // 能力 4：写入分析产物，保存代码理解结论。
  private async writeArtifact(request: InvokeRequest): Promise<ManagedToolResult> {
    this.bump("write_file");
    const rawPath = requiredString(request.args.path, "path");
    const content = requiredString(request.args.content, "content");

    // 先 resolve 再校验：以真实路径判断是否落在产物目录内，
    // 避免仅按字符串前缀判断而被 "artifacts/../x" 绕过。
    const filePath = resolveWithin(request.context.projectRoot, rawPath);
    if (!isWithin(request.context.artifactRoot, filePath)) {
      throw new ToolDeniedError(
        ToolResultCode.ARTIFACT_PATH_DENIED,
        `写入路径不在产物目录内：${rawPath}`,
      );
    }

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");

    return this.success(
      ToolResultCode.OK,
      { path: rawPath, bytes: Buffer.byteLength(content, "utf8") },
      rawPath,
    );
  }

  private bump(toolName: string): void {
    this.callCounts.set(toolName, (this.callCounts.get(toolName) ?? 0) + 1);
  }

  // 统一成功构造：禁止散落的成功对象字面量。
  private success(
    code: string,
    modelView: unknown,
    artifact?: string,
  ): ManagedToolResult {
    return { ok: true, code, modelView, artifact };
  }

  // 统一失败构造：失败只把结构化 code + message 交给模型视图。
  private failure(code: string, message: string): ManagedToolResult {
    return { ok: false, code, modelView: { code, message } };
  }
}

function describeValueErrors(schema: TSchema, value: unknown): string {
  const detail = [...Value.Errors(schema, value)]
    .map((error) => `${error.instancePath || "/"}: ${error.message}`)
    .join("; ");
  return detail.length > 0 ? detail : "结构不符合 Schema";
}

function asRelativePath(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`参数 ${field} 必须是非空字符串`);
  }
  return value;
}

// 路径解析后校验：目标必须等于 root 或位于 root 之下，否则视为越界。
function resolveWithin(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  if (!isWithin(root, resolved)) {
    throw new ToolDeniedError(
      ToolResultCode.PATH_DENIED,
      `路径越界：${target}`,
    );
  }
  return resolved;
}

function isWithin(root: string, resolvedTarget: string): boolean {
  const normalizedRoot = path.resolve(root);
  return resolvedTarget === normalizedRoot
    || resolvedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

// 返回给模型的路径一律相对目标仓库根，根本身表示为 "."。
function relativeTo(root: string, target: string): string {
  const relativePath = path.relative(root, target);
  return relativePath.length === 0 ? "." : relativePath;
}

async function walk(root: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    // 每次迭代都响应取消信号，保证遍历可被提前终止。
    signal?.throwIfAborted();

    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        queue.push(path.join(current, entry.name));
        continue;
      }
      if (entry.isFile()) {
        files.push(path.join(current, entry.name));
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}
