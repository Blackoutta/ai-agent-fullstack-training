// 装配 Guard 并启动 pi Loop。
import { randomUUID } from "node:crypto";
import {
  runAgentLoop,
  type AgentContext,
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

import { LoopGuard, type LoopState } from "./loop-guard.js";
import { createCodeUnderstandingTools } from "./pi-tools.js";
import { createExecutionContext, type DemoExecutionContext } from "./run-context.js";
import { DemoToolRuntime } from "./runtime.js";

export interface TraceEvent {
  type: AgentEvent["type"];
  turn: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface RunCodebaseAgentOptions {
  model: Model<any>;
  streamFn: StreamFn;
  maxTurns?: number;
  signal?: AbortSignal;
  executionContext?: DemoExecutionContext;
  runtime?: DemoToolRuntime;
  onText?: (delta: string) => void;
}

export interface RunCodebaseAgentResult {
  state: LoopState;
  messages: AgentMessage[];
  trace: TraceEvent[];
  runtime: DemoToolRuntime;
}

export async function runCodebaseAgent(
  options: RunCodebaseAgentOptions,
): Promise<RunCodebaseAgentResult> {
  const executionContext = options.executionContext ?? createExecutionContext();
  const runtime = options.runtime ?? new DemoToolRuntime();
  const state = createLoopState(options.maxTurns ?? 12);
  const guard = new LoopGuard(state);
  const trace: TraceEvent[] = [];
  const context: AgentContext = {
    systemPrompt: [
      "你是代码理解 Agent。",
      "先搜索和阅读源码，再形成结论。",
      "不得根据文件名猜测实现。",
      "必须把说明写入 artifacts/login-flow.md。",
      "最终列出引用过的相关源码路径。",
    ].join("\n"),
    messages: [],
    tools: createCodeUnderstandingTools(runtime, executionContext),
  };
  const prompt: AgentMessage = {
    role: "user",
    content: [{
      type: "text",
      text: "帮我找出该项目的登录逻辑，并生成 Markdown 说明文档。",
    }],
    timestamp: Date.now(),
  };
  const config: AgentLoopConfig = {
    model: options.model,
    convertToLlm: (messages) => messages.filter(isLlmMessage),
    maxRetries: 0,
    toolExecution: "sequential",
    // 第三次相同动作在 Handler 前被阻断，避免产生无效副作用。
    beforeToolCall: async (hookContext) => guard.beforeToolCall(hookContext),
    afterToolCall: async (hookContext) => {
      guard.observeToolResult(hookContext);
      return undefined;
    },
    prepareNextTurn: async ({ context: nextContext }) => ({ context: nextContext }),
    shouldStopAfterTurn: async (hookContext) => guard.afterTurn(hookContext),
    getSteeringMessages: async () => [],
    // pi 自然停止后读取 Follow-up，再以用户消息驱动下一轮。
    getFollowUpMessages: async () => guard.drainFollowUps(),
  };
  const messages = await runAgentLoop(
    [prompt],
    context,
    config,
    async (event) => observeEvent(event, state, trace, options.onText),
    options.signal,
    options.streamFn,
  );

  return { state, messages, trace, runtime };
}

export function createLoopState(maxTurns: number): LoopState {
  return {
    runId: randomUUID(),
    turn: 0,
    maxTurns,
    actions: new Map(),
    evidence: {
      readFiles: new Set(),
      writtenArtifacts: new Set(),
    },
  };
}

async function observeEvent(
  event: AgentEvent,
  state: LoopState,
  trace: TraceEvent[],
  onText?: (delta: string) => void,
): Promise<void> {
  if (event.type === "turn_start") {
    state.turn += 1;
    trace.push({ type: event.type, turn: state.turn });
    return;
  }
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    onText?.(event.assistantMessageEvent.delta);
    return;
  }
  if (event.type === "tool_execution_start") {
    trace.push({ type: event.type, turn: state.turn, toolCallId: event.toolCallId, toolName: event.toolName });
    return;
  }
  if (event.type === "tool_execution_end") {
    trace.push({ type: event.type, turn: state.turn, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
    return;
  }
  if (event.type === "turn_end" && event.message.role === "assistant") {
    if (event.message.stopReason === "aborted") state.stopCode = "ABORTED";
    if (event.message.stopReason === "error") state.stopCode = "MODEL_ERROR";
  }
}

function isLlmMessage(message: AgentMessage): message is Extract<AgentMessage, { role: "user" | "assistant" | "toolResult" }> {
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}
