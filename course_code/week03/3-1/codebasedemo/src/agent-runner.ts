// 装配层：把 P1 Runtime/上下文、P2 模型、P3 工具、P4 循环保护接进 pi 原生 Agent Loop。
// 禁止自建循环：底层循环完全由 pi 的 runAgentLoop 提供（I5）；本层不实现任何一层的规则。
import {
  runAgentLoop,
  type AgentContext,
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

import {
  LoopGuard,
  StopReason,
  createLoopState,
  type LoopState,
} from "./loop-guard.js";
import { createCodeUnderstandingTools } from "./pi-tools.js";
import { createExecutionContext, type DemoExecutionContext } from "./run-context.js";
import { DemoToolRuntime } from "./runtime.js";

// 教学默认最大轮数；调用方可覆盖。
export const DEFAULT_MAX_TURNS = 12;

export const USER_TASK = "分析目标仓库的登录逻辑，并生成 Markdown 说明文档。";

// 产物路径取自执行上下文，避免在提示词里硬编码。
export function buildSystemPrompt(context: DemoExecutionContext): string {
  return [
    "你是代码理解 Agent。",
    "必须先搜索并阅读源码，再形成结论。",
    "不得根据文件名猜测实现。",
    `必须生成登录流程说明产物：${context.targetArtifact}。`,
    "最终必须列出实际引用过的源码路径。",
  ].join("\n");
}

// 结构化轨迹：只保留可关联的最小字段，toolCallId 是 Tool Call 与 Tool Result 的连接键。
export interface TraceEvent {
  type: AgentEvent["type"];
  turn: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface RunCodebaseAgentOptions {
  // 模型与流式函数由调用方注入。
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
  // 3) 受控工具 Runtime 与执行上下文。
  const executionContext = options.executionContext ?? createExecutionContext();
  const runtime = options.runtime ?? new DemoToolRuntime();
  // 1) 一次 Run 的运行状态 + 2) 循环保护实例。
  const state = createLoopState(
    options.maxTurns ?? DEFAULT_MAX_TURNS,
    executionContext.targetArtifact,
  );
  const guard = new LoopGuard(state);
  const trace: TraceEvent[] = [];
  // 5) Agent Context（System Prompt + 工具列表）。
  const agentContext: AgentContext = {
    systemPrompt: buildSystemPrompt(executionContext),
    messages: [],
    // 4) 把 Runtime 适配成 pi 工具。
    tools: createCodeUnderstandingTools(runtime, executionContext),
  };
  // 6) 用户任务消息。
  const prompt: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: USER_TASK }],
    timestamp: Date.now(),
  };
  // 7) 把循环保护接入 pi 钩子。
  const config: AgentLoopConfig = {
    model: options.model,
    // 只把用户消息、助手消息、工具结果转换给模型。
    convertToLlm: (messages) => messages.filter(isLlmMessage),
    // 重试由 Gateway 负责，Agent 进程不重复实现。
    maxRetries: 0,
    toolExecution: "sequential",
    beforeToolCall: async (context) => guard.beforeToolCall(context),
    afterToolCall: async (context) => {
      guard.observeToolResult(context);
      return undefined;
    },
    // 预留下一轮准备钩子：本阶段不保存 Checkpoint，也不改写证据。
    prepareNextTurn: async ({ context }) => ({ context }),
    shouldStopAfterTurn: async (context) => guard.afterTurn(context),
    getSteeringMessages: async () => [],
    getFollowUpMessages: async () => guard.drainFollowUps(),
  };
  // 9) 调用 pi 原生 Loop；8) 事件观察与记录。
  const messages = await runAgentLoop(
    [prompt],
    agentContext,
    config,
    async (event) => observeEvent(event, state, guard, trace, options.onText),
    options.signal,
    options.streamFn,
  );

  // 10) 返回运行状态、消息、轨迹与 Runtime。
  return { state, messages, trace, runtime };
}

// 事件观察：只记录，不改变 Loop 的推进。
async function observeEvent(
  event: AgentEvent,
  state: LoopState,
  guard: LoopGuard,
  trace: TraceEvent[],
  onText?: (delta: string) => void,
): Promise<void> {
  switch (event.type) {
    case "turn_start":
      // 轮次开始：当前轮次加一，并记录轨迹。
      state.turn += 1;
      trace.push({ type: event.type, turn: state.turn });
      return;
    case "message_update":
      // 只把模型可见文本增量交给调用方，不记录隐藏推理。
      if (event.assistantMessageEvent.type === "text_delta") {
        onText?.(event.assistantMessageEvent.delta);
      }
      return;
    case "tool_execution_start":
      trace.push({
        type: event.type,
        turn: state.turn,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
      });
      return;
    case "tool_execution_end":
      trace.push({
        type: event.type,
        turn: state.turn,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
      });
      return;
    case "turn_end":
      if (event.message.role === "assistant") {
        if (event.message.stopReason === "aborted") {
          guard.markStop(StopReason.ABORTED);
        }
        if (event.message.stopReason === "error") {
          guard.markStop(StopReason.MODEL_ERROR);
        }
      }
      return;
    default:
      return;
  }
}

function isLlmMessage(
  message: AgentMessage,
): message is Extract<AgentMessage, { role: "user" | "assistant" | "toolResult" }> {
  return message.role === "user"
    || message.role === "assistant"
    || message.role === "toolResult";
}
