import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { Context } from "@earendil-works/pi-ai";

import { runCodebaseAgent } from "../src/agent-runner.js";
import { createExecutionContext } from "../src/run-context.js";

const FIXTURE_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "demo-app",
);

function toolCall(name: string, args: Record<string, unknown>) {
  return fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
}

function finalMessage(text: string) {
  return fauxAssistantMessage(text, { stopReason: "stop" });
}

async function runWithScriptedResponses(
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  options: { maxTurns?: number; signal?: AbortSignal; onContext?: (context: Context) => void } = {},
) {
  const faux = fauxProvider({ tokensPerSecond: 10_000 });
  faux.setResponses(responses);
  const projectRoot = await mkdtemp(path.join(tmpdir(), "codebase-agent-loop-"));
  const executionContext = createExecutionContext({
    projectRoot,
    repoRoot: FIXTURE_REPO_ROOT,
    artifactRoot: path.join(projectRoot, "artifacts"),
    targetArtifact: "artifacts/login-flow.md",
  });
  const streamFn = (model: Parameters<typeof faux.provider.streamSimple>[0], context: Context, streamOptions?: Parameters<typeof faux.provider.streamSimple>[2]) => {
    options.onContext?.({
      systemPrompt: context.systemPrompt,
      messages: structuredClone(context.messages),
    });
    return faux.provider.streamSimple(model, context, streamOptions);
  };
  const result = await runCodebaseAgent({
    model: faux.getModel(),
    streamFn,
    maxTurns: options.maxTurns,
    signal: options.signal,
    executionContext,
  });
  return { ...result, faux, executionContext };
}

describe("pi Agent Loop TDD 验收", () => {
  it("把 Tool Result 写回后继续请求模型", async () => {
    const contexts: Context[] = [];
    const result = await runWithScriptedResponses([
      toolCall("search_code", { query: "login", path: "." }),
      finalMessage("登录入口位于 src/routes/login.ts"),
    ], { maxTurns: 2, onContext: (context) => contexts.push(context) });

    expect(result.faux.state.callCount).toBe(2);
    expect(contexts[1].messages).toContainEqual(expect.objectContaining({
      role: "toolResult",
      toolCallId: expect.any(String),
    }));
  });

  it("没有完成证据时不接受 Final，而是注入 Follow-up", async () => {
    const contexts: Context[] = [];
    const result = await runWithScriptedResponses([
      finalMessage("登录逻辑已经分析完成"),
      toolCall("read_file", { path: "src/routes/login.ts" }),
      toolCall("read_file", { path: "src/services/auth-service.ts" }),
      toolCall("read_file", { path: "src/auth/session.ts" }),
      toolCall("write_file", { path: "artifacts/login-flow.md", content: "# 登录逻辑" }),
      finalMessage("文档已经生成"),
    ], { onContext: (context) => contexts.push(context) });

    expect(result.faux.state.callCount).toBe(6);
    expect(contexts.flatMap((context) => context.messages))
      .toContainEqual(expect.objectContaining({
        role: "user",
        content: expect.arrayContaining([expect.objectContaining({
          text: expect.stringContaining("FINAL_REJECTED"),
        })]),
      }));
    expect(result.state.stopCode).toBe("COMPLETED");
  });

  it("阻止第三次相同工具调用，handler 不会执行", async () => {
    const call = toolCall("search_code", { query: "login", path: "." });
    const result = await runWithScriptedResponses([call, call, call]);
    const lastToolResult = result.messages.filter((message) => message.role === "toolResult").at(-1);

    expect(result.runtime.getHandlerCallCount("search_code")).toBe(2);
    expect(lastToolResult).toMatchObject({
      isError: true,
      content: expect.arrayContaining([expect.objectContaining({
        text: expect.stringContaining("REPEATED_ACTION"),
      })]),
    });
    expect(result.state.stopCode).toBe("REPEATED_ACTION");
  });

  it("达到最大轮数后结束，不发起第四次模型调用", async () => {
    const result = await runWithScriptedResponses([
      toolCall("search_code", { query: "login", path: "." }),
      toolCall("search_code", { query: "session", path: "." }),
      toolCall("search_code", { query: "token", path: "." }),
      toolCall("search_code", { query: "unused", path: "." }),
    ], { maxTurns: 3 });

    expect(result.state.turn).toBe(3);
    expect(result.state.stopCode).toBe("MAX_TURNS_EXCEEDED");
    expect(result.faux.state.callCount).toBe(3);
  });

  it("取消信号会结束模型等待，并且不会启动工具", async () => {
    const controller = new AbortController();
    const faux = fauxProvider({ tokensPerSecond: 1, tokenSize: { min: 1, max: 1 } });
    faux.setResponses([finalMessage("这是一段足够长的慢速模型输出，用来等待取消信号传播。")]);
    const projectRoot = await mkdtemp(path.join(tmpdir(), "codebase-agent-abort-"));
    const run = runCodebaseAgent({
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple.bind(faux.provider),
      signal: controller.signal,
      executionContext: createExecutionContext({ projectRoot }),
    });

    controller.abort();
    const result = await run;

    expect(result.state.stopCode).toBe("ABORTED");
    expect(result.trace.some((event) => event.type === "tool_execution_start")).toBe(false);
  });

  it("真实工具闭环会生成可核验的登录说明文档", async () => {
    const result = await runWithScriptedResponses([
      toolCall("search_code", { query: "login", path: "." }),
      toolCall("read_file", { path: "src/routes/login.ts" }),
      toolCall("read_file", { path: "src/services/auth-service.ts" }),
      toolCall("read_file", { path: "src/auth/session.ts" }),
      toolCall("write_file", {
        path: "artifacts/login-flow.md",
        content: "# 登录流程\n\n入口：src/routes/login.ts\n服务：src/services/auth-service.ts\n会话：src/auth/session.ts",
      }),
      finalMessage("登录流程说明已生成。"),
    ]);
    const artifact = await readFile(path.join(result.executionContext.projectRoot, "artifacts/login-flow.md"), "utf8");

    expect(result.trace.some((event) => event.type === "tool_execution_end" && !event.isError)).toBe(true);
    expect(artifact).toContain("src/routes/login.ts");
    expect(result.state.stopCode).toBe("COMPLETED");
  });
});
