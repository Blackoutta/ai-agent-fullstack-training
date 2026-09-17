// 停止决策中心验收：单元判定 + 接进 pi 原生 Loop 的真实集成。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  runAgentLoop,
  type AfterToolCallContext,
  type AgentContext,
  type AgentLoopConfig,
  type AgentMessage,
  type BeforeToolCallContext,
  type ShouldStopAfterTurnContext,
} from "@earendil-works/pi-agent-core";

import {
  FINAL_REJECTED,
  LoopGuard,
  StopReason,
  createLoopState,
} from "../src/loop-guard.js";
import { TOOL_NAMES, createCodeUnderstandingTools } from "../src/pi-tools.js";
import { createExecutionContext } from "../src/run-context.js";
import { DemoToolRuntime } from "../src/runtime.js";
import { DEFAULT_REPO_ROOT } from "./support/harness.js";

// 真实 login_demo 中存在的源码文件，仅用于脚本化模型响应。
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

type LlmMessage = Extract<AgentMessage, { role: "user" | "assistant" | "toolResult" }>;

function isLlmMessage(message: AgentMessage): message is LlmMessage {
  return message.role === "user"
    || message.role === "assistant"
    || message.role === "toolResult";
}

// 把 Guard 的四个方法接到 pi 的四个钩子上（钩子归属见报告）。
function buildConfig(guard: LoopGuard, model: Model<any>): AgentLoopConfig {
  return {
    model,
    convertToLlm: (messages) => messages.filter(isLlmMessage),
    maxRetries: 0,
    toolExecution: "sequential",
    beforeToolCall: async (context) => guard.beforeToolCall(context),
    afterToolCall: async (context) => {
      guard.observeToolResult(context);
      return undefined;
    },
    shouldStopAfterTurn: async (context) => guard.afterTurn(context),
    getSteeringMessages: async () => [],
    getFollowUpMessages: async () => guard.drainFollowUps(),
  };
}

async function runScenario(
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  options: { maxTurns: number },
) {
  const faux = fauxProvider({ tokensPerSecond: 10_000 });
  faux.setResponses(responses);

  const projectRoot = await mkdtemp(path.join(tmpdir(), "codebase-guard-"));
  const executionContext = createExecutionContext({
    projectRoot,
    repoRoot: DEFAULT_REPO_ROOT,
    artifactRoot: path.join(projectRoot, "artifacts"),
    targetArtifact: TARGET_ARTIFACT,
  });
  const runtime = new DemoToolRuntime();
  const state = createLoopState(options.maxTurns, executionContext.targetArtifact, "run-guard-test");
  const guard = new LoopGuard(state);
  const agentContext: AgentContext = {
    systemPrompt: "测试：先取证后结论。",
    messages: [],
    tools: createCodeUnderstandingTools(runtime, executionContext),
  };
  const prompt: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: "分析登录逻辑并生成说明文档。" }],
    timestamp: Date.now(),
  };

  const messages = await runAgentLoop(
    [prompt],
    agentContext,
    buildConfig(guard, faux.getModel()),
    async (event) => {
      // 轮次递增归装配层（pi 的 turn_start），Guard 只读取。
      if (event.type === "turn_start") {
        state.turn += 1;
      }
    },
    undefined,
    faux.provider.streamSimple.bind(faux.provider),
  );

  return { faux, runtime, guard, state, executionContext, messages };
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

// 轻量构造钩子输入，只覆盖被测方法会读取的字段。
function beforeContext(name: string, args: Record<string, unknown>): BeforeToolCallContext {
  return { toolCall: { name }, args } as unknown as BeforeToolCallContext;
}

function afterContext(
  name: string,
  args: Record<string, unknown>,
  isError: boolean,
): AfterToolCallContext {
  return { toolCall: { name }, args, isError } as unknown as AfterToolCallContext;
}

function turnContext(toolResults: unknown[]): ShouldStopAfterTurnContext {
  return { toolResults } as unknown as ShouldStopAfterTurnContext;
}

describe("停止决策中心验收", () => {
  it("同一动作第三次被阻止，Runtime handler 实际只执行两次", async () => {
    const call = toolCall(TOOL_NAMES.SEARCH_CODE, { query: "login", path: "." });
    const result = await runScenario([call, call, call], { maxTurns: 8 });

    expect(result.runtime.getHandlerCallCount(TOOL_NAMES.SEARCH_CODE)).toBe(2);
    expect(result.state.stopReason).toBe(StopReason.REPEATED_ACTION);
    expect([...result.state.actions.values()]).toEqual([3]);

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

  it("参数字段顺序变化无法绕过重复检测", () => {
    const state = createLoopState(5, TARGET_ARTIFACT, "run-fingerprint");
    const guard = new LoopGuard(state);

    expect(guard.beforeToolCall(beforeContext(TOOL_NAMES.SEARCH_CODE, {
      query: "login",
      path: ".",
      nested: { a: 1, b: 2 },
    }))).toEqual({});
    expect(guard.beforeToolCall(beforeContext(TOOL_NAMES.SEARCH_CODE, {
      nested: { b: 2, a: 1 },
      path: ".",
      query: "login",
    }))).toEqual({});

    const third = guard.beforeToolCall(beforeContext(TOOL_NAMES.SEARCH_CODE, {
      path: ".",
      query: "login",
      nested: { a: 1, b: 2 },
    }));

    expect(third.block).toBe(true);
    expect(third.reason).toContain(StopReason.REPEATED_ACTION);
    expect(state.stopReason).toBe(StopReason.REPEATED_ACTION);
  });

  it("达到最大轮数后不再发起下一轮模型调用", async () => {
    const result = await runScenario([
      toolCall(TOOL_NAMES.SEARCH_CODE, { query: "login" }),
      toolCall(TOOL_NAMES.SEARCH_CODE, { query: "session" }),
      toolCall(TOOL_NAMES.SEARCH_CODE, { query: "token" }),
      toolCall(TOOL_NAMES.SEARCH_CODE, { query: "unused" }),
    ], { maxTurns: 3 });

    expect(result.state.turn).toBe(3);
    expect(result.state.stopReason).toBe(StopReason.MAX_TURNS_EXCEEDED);
    expect(result.faux.state.callCount).toBe(3);
  });

  it("证据不足时拒绝 Final 并注入含缺失项的 Follow-up，补齐后以成功原因结束", async () => {
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
    // 第一次拒绝：源码与产物都缺。
    expect(followUps[0]).toContain(FINAL_REJECTED);
    expect(followUps[0]).toContain("源码文件");
    expect(followUps[0]).toContain(TARGET_ARTIFACT);
    // 第二次拒绝：产物已补齐，只缺源码文件。
    expect(followUps[1]).toContain("源码文件");
    expect(followUps[1]).not.toContain(TARGET_ARTIFACT);

    expect(result.state.evidence.readFiles.size).toBe(3);
    expect(result.state.evidence.writtenArtifacts.has(TARGET_ARTIFACT)).toBe(true);
    expect(result.state.stopReason).toBe(StopReason.COMPLETED);
  });

  it("错误工具结果不计入证据", () => {
    const state = createLoopState(5, TARGET_ARTIFACT, "run-evidence");
    const guard = new LoopGuard(state);

    guard.observeToolResult(afterContext(TOOL_NAMES.READ_FILE, { path: LOGIN_ENTRY }, true));
    guard.observeToolResult(afterContext(TOOL_NAMES.WRITE_FILE, { path: TARGET_ARTIFACT }, true));
    expect(state.evidence.readFiles.size).toBe(0);
    expect(state.evidence.writtenArtifacts.size).toBe(0);

    guard.observeToolResult(afterContext(TOOL_NAMES.READ_FILE, { path: LOGIN_ENTRY }, false));
    expect(state.evidence.readFiles.has(LOGIN_ENTRY)).toBe(true);
  });

  it("完成校验返回缺失项列表而不是布尔值", () => {
    const guard = new LoopGuard(createLoopState(5, TARGET_ARTIFACT, "run-verify"));

    const missing = guard.verifyCompletion();
    expect(missing).toHaveLength(2);
    expect(missing[0]).toContain("源码文件");
    expect(missing[1]).toContain(TARGET_ARTIFACT);
  });

  it("停止判定顺序不可调换，且停止原因不被后续覆盖", () => {
    const state = createLoopState(1, TARGET_ARTIFACT, "run-order");
    const guard = new LoopGuard(state);

    // 证据齐全，但 maxTurns=1 先命中：仍以最大轮数原因停止。
    for (const file of [LOGIN_ENTRY, AUTH_SERVICE, DATABASE]) {
      guard.observeToolResult(afterContext(TOOL_NAMES.READ_FILE, { path: file }, false));
    }
    guard.observeToolResult(afterContext(TOOL_NAMES.WRITE_FILE, { path: TARGET_ARTIFACT }, false));
    expect(guard.verifyCompletion()).toEqual([]);

    // 模拟装配层在 turn_start 处递增轮次。
    state.turn = 1;
    expect(guard.afterTurn(turnContext([]))).toBe(true);
    expect(state.stopReason).toBe(StopReason.MAX_TURNS_EXCEEDED);

    // 已存在停止原因 → 立即停止，且不被覆盖。
    expect(guard.afterTurn(turnContext([]))).toBe(true);
    expect(state.stopReason).toBe(StopReason.MAX_TURNS_EXCEEDED);
  });
});
