// 装配层行为验收：脚本化模型响应，禁止真实网络；产物写入隔离临时目录，不污染目标仓库。
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

import { runCodebaseAgent } from "../src/agent-runner.js";
import { FINAL_REJECTED, StopReason } from "../src/loop-guard.js";
import { TOOL_NAMES } from "../src/pi-tools.js";
import { createExecutionContext } from "../src/run-context.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DEFAULT_REPO_ROOT } from "./support/harness.js";

// 真实 login_demo 中存在的调用链：入口 → 服务 → 数据访问。
const LOGIN_ENTRY = "src/routes/login.ts";
const AUTH_SERVICE = "src/services/auth-service.ts";
const DATABASE = "src/db/database.ts";
const TARGET_ARTIFACT = "artifacts/login-flow.md";

function toolCall(name: string, args: Record<string, unknown>) {
  return fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
}

function finalMessage(text: string) {
  return fauxAssistantMessage(text, { stopReason: "stop" });
}

function followUpTexts(messages: AgentMessage[]): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const block of message.content) {
      if (typeof block === "string") continue;
      if (block.type === "text" && block.text.includes(FINAL_REJECTED)) {
        texts.push(block.text);
      }
    }
  }
  return texts;
}

async function runScenario(
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  options: {
    maxTurns?: number;
    onContext?: (context: Context) => void;
  } = {},
) {
  const faux = fauxProvider({ tokensPerSecond: 10_000 });
  faux.setResponses(responses);
  const projectRoot = await mkdtemp(path.join(tmpdir(), "codebase-agent-run-"));
  const executionContext = createExecutionContext({
    projectRoot,
    repoRoot: DEFAULT_REPO_ROOT,
    artifactRoot: path.join(projectRoot, "artifacts"),
    targetArtifact: TARGET_ARTIFACT,
  });
  const streamFn = (
    model: Parameters<typeof faux.provider.streamSimple>[0],
    context: Context,
    streamOptions?: Parameters<typeof faux.provider.streamSimple>[2],
  ) => {
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
    executionContext,
  });

  return { ...result, faux, executionContext, projectRoot };
}

describe("装配层行为验收", () => {
  it("场景一：Tool Result 回写后继续请求模型，toolCallId 与原 Tool Call 对应", async () => {
    const searchCall = fauxToolCall(TOOL_NAMES.SEARCH_CODE, { query: "login", path: "." });
    const contexts: Context[] = [];

    const result = await runScenario([
      fauxAssistantMessage(searchCall, { stopReason: "toolUse" }),
      finalMessage("登录入口已定位。"),
    ], { maxTurns: 2, onContext: (context) => contexts.push(context) });

    expect(result.faux.state.callCount).toBe(2);
    const toolResult = contexts[1].messages.find((message) => message.role === "toolResult");
    expect(toolResult).toBeDefined();
    expect(toolResult?.toolCallId).toBe(searchCall.id);
  });

  it("场景二：证据不足拒绝 Final 并注入 FINAL_REJECTED，补齐后成功结束", async () => {
    const result = await runScenario([
      finalMessage("登录逻辑已经分析完成"),
      toolCall(TOOL_NAMES.READ_FILE, { path: LOGIN_ENTRY }),
      toolCall(TOOL_NAMES.READ_FILE, { path: AUTH_SERVICE }),
      toolCall(TOOL_NAMES.WRITE_FILE, { path: TARGET_ARTIFACT, content: "# 登录流程" }),
      finalMessage("已经完成"),
      toolCall(TOOL_NAMES.READ_FILE, { path: DATABASE }),
      finalMessage("完成"),
    ], { maxTurns: 12 });

    const followUps = followUpTexts(result.messages);
    expect(followUps).toHaveLength(2);
    expect(followUps[0]).toContain(FINAL_REJECTED);
    expect(followUps[0]).toContain("源码文件");
    expect(followUps[0]).toContain(TARGET_ARTIFACT);
    expect(followUps[1]).toContain("源码文件");

    expect(result.state.evidence.readFiles.size).toBe(3);
    expect(result.state.stopReason).toBe(StopReason.COMPLETED);
  });

  it("场景三：连续三次相同调用，第三次在 handler 前被阻止", async () => {
    const call = toolCall(TOOL_NAMES.SEARCH_CODE, { query: "login", path: "." });
    const result = await runScenario([call, call, call], { maxTurns: 8 });

    expect(result.runtime.getHandlerCallCount(TOOL_NAMES.SEARCH_CODE)).toBe(2);
    expect(result.state.stopReason).toBe(StopReason.REPEATED_ACTION);

    const lastToolResult = result.messages
      .filter((message) => message.role === "toolResult")
      .at(-1);
    expect(lastToolResult).toMatchObject({
      isError: true,
      content: expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining(StopReason.REPEATED_ACTION),
        }),
      ]),
    });
  });

  it("场景四：最大轮数为 3 时模型调用恰为 3 次", async () => {
    const result = await runScenario([
      toolCall(TOOL_NAMES.SEARCH_CODE, { query: "login" }),
      toolCall(TOOL_NAMES.SEARCH_CODE, { query: "session" }),
      toolCall(TOOL_NAMES.SEARCH_CODE, { query: "token" }),
      toolCall(TOOL_NAMES.SEARCH_CODE, { query: "unused" }),
    ], { maxTurns: 3 });

    expect(result.faux.state.callCount).toBe(3);
    expect(result.state.turn).toBe(3);
    expect(result.state.stopReason).toBe(StopReason.MAX_TURNS_EXCEEDED);
  });

  it("场景五：取消信号结束运行，且不再开始任何工具执行", async () => {
    const controller = new AbortController();
    const faux = fauxProvider({ tokensPerSecond: 1, tokenSize: { min: 1, max: 1 } });
    faux.setResponses([finalMessage("这是一段足够长的慢速模型输出，用来等待取消信号传播。")]);

    const projectRoot = await mkdtemp(path.join(tmpdir(), "codebase-agent-cancel-"));
    const run = runCodebaseAgent({
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple.bind(faux.provider),
      signal: controller.signal,
      executionContext: createExecutionContext({
        projectRoot,
        repoRoot: DEFAULT_REPO_ROOT,
        artifactRoot: path.join(projectRoot, "artifacts"),
        targetArtifact: TARGET_ARTIFACT,
      }),
    });

    controller.abort();
    const result = await run;

    expect(result.state.stopReason).toBe(StopReason.ABORTED);
    expect(result.trace.some((event) => event.type === "tool_execution_start")).toBe(false);
  });

  it("场景六：完整代码理解闭环，轨迹可按 runId/turn/toolCallId 还原", async () => {
    const searchCall = fauxToolCall(TOOL_NAMES.SEARCH_CODE, { query: "login", path: "." });
    const result = await runScenario([
      fauxAssistantMessage(searchCall, { stopReason: "toolUse" }),
      toolCall(TOOL_NAMES.READ_FILE, { path: LOGIN_ENTRY }),
      toolCall(TOOL_NAMES.READ_FILE, { path: AUTH_SERVICE }),
      toolCall(TOOL_NAMES.READ_FILE, { path: DATABASE }),
      toolCall(TOOL_NAMES.WRITE_FILE, {
        path: TARGET_ARTIFACT,
        content: `# 登录流程\n\n引用源码：${LOGIN_ENTRY}`,
      }),
      finalMessage("登录流程说明已生成。"),
    ], { maxTurns: 12 });

    // 成功结束，且证据齐备。
    expect(result.state.stopReason).toBe(StopReason.COMPLETED);
    expect(result.state.runId.length).toBeGreaterThan(0);
    expect(result.state.evidence.readFiles.size).toBe(3);
    expect(result.state.evidence.writtenArtifacts.has(TARGET_ARTIFACT)).toBe(true);

    // 产物真实落盘，且其中引用的路径在目标仓库真实存在。
    const artifact = await readFile(path.join(result.projectRoot, TARGET_ARTIFACT), "utf8");
    expect(artifact).toContain(LOGIN_ENTRY);
    await expect(access(path.join(DEFAULT_REPO_ROOT, LOGIN_ENTRY))).resolves.toBeUndefined();

    // 至少一次 Tool Call → Tool Result → 下一轮模型调用。
    expect(result.faux.state.callCount).toBeGreaterThanOrEqual(2);
    expect(result.trace.some(
      (event) => event.type === "tool_execution_end" && event.isError === false,
    )).toBe(true);

    // toolCallId 贯穿：Tool Call 的首个 id == 首个 tool_execution_start == 对应 Tool Result。
    const traceIds = result.trace
      .filter((event) => event.type === "tool_execution_start")
      .map((event) => event.toolCallId);
    const toolResultIds = result.messages
      .filter((message) => message.role === "toolResult")
      .map((message) => (message as { toolCallId: string }).toolCallId);
    expect(traceIds).toHaveLength(5); // 1 次搜索 + 3 次读取 + 1 次写入
    expect(traceIds[0]).toBe(searchCall.id);
    expect(toolResultIds).toEqual(traceIds);

    // 轨迹可按 turn 还原：轮次单调递增且覆盖到工具事件。
    const turns = result.trace.map((event) => event.turn);
    expect([...turns]).toEqual([...turns].sort((left, right) => left - right));
    expect(result.trace.some((event) => event.type === "turn_start")).toBe(true);
  });
});
