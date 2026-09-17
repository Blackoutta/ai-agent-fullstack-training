// 适配层验收：注入替代 Runtime，断言转发与结果转换；不触碰真实文件系统。
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import type { Context } from "@earendil-works/pi-ai";

import { createCodeUnderstandingTools } from "../src/pi-tools.js";
import { createExecutionContext } from "../src/run-context.js";
import {
  DemoToolRuntime,
  ListFilesArgs,
  ReadFileArgs,
  SearchCodeArgs,
  ToolResultCode,
  WriteFileArgs,
  type InvokeRequest,
  type ManagedToolResult,
} from "../src/runtime.js";

// 替代 Runtime：只记录被转发过来的调用，不执行任何真实逻辑。
class StubRuntime extends DemoToolRuntime {
  readonly requests: InvokeRequest[] = [];

  constructor(private readonly response: ManagedToolResult) {
    super();
  }

  override async invoke(request: InvokeRequest): Promise<ManagedToolResult> {
    this.requests.push(request);
    return this.response;
  }
}

function success(modelView: unknown, artifact?: string): ManagedToolResult {
  return { ok: true, code: ToolResultCode.OK, modelView, artifact };
}

function failure(code: string, message: string): ManagedToolResult {
  return { ok: false, code, modelView: { code, message } };
}

function buildTools(response: ManagedToolResult) {
  const runtime = new StubRuntime(response);
  const context = createExecutionContext();
  return { runtime, context, tools: createCodeUnderstandingTools(runtime, context) };
}

describe("pi 工具适配层验收", () => {
  it("四种工具可在 Agent Context 中注册，顺序稳定且契约完整", () => {
    const { context, tools } = buildTools(success({}));
    const piContext: Context = { messages: [], tools };

    expect(piContext.tools?.map((tool) => tool.name)).toEqual([
      "list_files",
      "search_code",
      "read_file",
      "write_file",
    ]);

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.executionMode).toBe("sequential");
    }

    // 参数契约与 Runtime 同源，不产生第二套 Schema。
    expect(tools[0].parameters).toBe(ListFilesArgs);
    expect(tools[1].parameters).toBe(SearchCodeArgs);
    expect(tools[2].parameters).toBe(ReadFileArgs);
    expect(tools[3].parameters).toBe(WriteFileArgs);
    expect(context.repoRoot.length).toBeGreaterThan(0);
  });

  it("每次执行都进入唯一 Runtime，toolCallId 与参数原样到达（I1/I3）", async () => {
    const { runtime, tools } = buildTools(success({ ok: true }));
    const callArgs: Record<string, Record<string, unknown>> = {
      list_files: { path: "." },
      search_code: { query: "login" },
      read_file: { path: "src/app.ts" },
      write_file: { path: "artifacts/login-flow.md", content: "# 登录流程" },
    };

    for (const [index, tool] of tools.entries()) {
      await tool.execute(`call-${index}`, callArgs[tool.name]);
    }

    expect(runtime.requests.map((request) => request.toolCallId))
      .toEqual(["call-0", "call-1", "call-2", "call-3"]);
    expect(runtime.requests.map((request) => request.modelName))
      .toEqual(["list_files", "search_code", "read_file", "write_file"]);
    expect(runtime.requests.map((request) => request.args))
      .toEqual(tools.map((tool) => callArgs[tool.name]));
  });

  it("取消信号原样传入 Runtime", async () => {
    const { runtime, tools } = buildTools(success({}));
    const controller = new AbortController();

    await tools[0].execute("call-abort", { path: "." }, controller.signal);

    expect(runtime.requests[0].signal).toBe(controller.signal);
  });

  it("成功结果：模型可见内容只取模型视图，治理信息留在附加信息（I4）", async () => {
    const modelView = { files: ["src/app.ts"] };
    const { tools } = buildTools(success(modelView, "artifacts/login-flow.md"));

    const result = await tools[3].execute("call-write", {
      path: "artifacts/login-flow.md",
      content: "# 登录流程",
    });

    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(modelView) },
    ]);
    expect(result.details).toEqual({
      code: ToolResultCode.OK,
      artifact: "artifacts/login-flow.md",
    });
  });

  it("Runtime 失败最终表现为错误工具结果，错误代码可读", async () => {
    const { tools } = buildTools(failure(ToolResultCode.PATH_DENIED, "路径越界：../package.json"));
    const error = await tools[2]
      .execute("call-fail", { path: "../package.json" })
      .then(() => undefined, (reason: unknown) => reason as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain(ToolResultCode.PATH_DENIED);
    expect(error?.message).toContain("路径越界");
  });

  it("非法参数由严格 Schema 在执行前拒绝，且禁止未声明额外参数", () => {
    const { tools } = buildTools(success({}));
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const listSchema = byName.get("list_files")!.parameters;
    const searchSchema = byName.get("search_code")!.parameters;
    const writeSchema = byName.get("write_file")!.parameters;

    // 未声明额外参数
    expect(Value.Check(listSchema, { path: ".", unexpected: true })).toBe(false);
    // 必填非空 / 可选
    expect(Value.Check(searchSchema, {})).toBe(false);
    expect(Value.Check(searchSchema, { query: "" })).toBe(false);
    expect(Value.Check(searchSchema, { query: "login" })).toBe(true);
    expect(Value.Check(listSchema, {})).toBe(true);
    expect(Value.Check(listSchema, { path: "" })).toBe(false);
    // 产物路径与内容均必填非空
    expect(Value.Check(writeSchema, { path: "artifacts/x.md" })).toBe(false);
    expect(Value.Check(writeSchema, { path: "artifacts/x.md", content: "" })).toBe(false);

    for (const schema of [listSchema, searchSchema, writeSchema]) {
      expect((schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });

  it("适配层不存在直连文件系统的旁路", async () => {
    const source = await readFile(
      new URL("../src/pi-tools.ts", import.meta.url),
      "utf8",
    );
    const forbidden = [
      "node:fs",
      "fs/promises",
      "readFile",
      "writeFile",
      "readdir",
      "mkdir",
      "node:path",
    ];

    expect(forbidden.filter((token) => source.includes(token))).toEqual([]);
  });
});
