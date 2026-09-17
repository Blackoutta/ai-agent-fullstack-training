// 在 3.1 的 pi Loop 上接入计划层。
// 复用原有接缝，不另写循环：
//   beforeToolCall   计划门禁 + 原重复保护
//   afterToolCall    保存证据 + 原交付物观测
//   prepareNextTurn  刷新计划快照，不堆积历史
//   shouldStopAfterTurn 完成契约 + 原轮数限制
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

import {
  createLoginFixContract,
  type CompletionContract,
} from "./completion-contract.js";
import { LoopGuard, type LoopState } from "./loop-guard.js";
import { createPlanningAgentTools } from "./pi-tools.js";
import { PLANNING_PROMPT, renderPlanSnapshot } from "./planning-prompt.js";
import { PlanningSession, type StepVerifier } from "./plan-store.js";
import { createExecutionContext, type DemoExecutionContext } from "./run-context.js";
import { DemoToolRuntime } from "./runtime.js";

export interface TraceEvent {
  type: AgentEvent["type"];
  turn: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface RunPlanningAgentOptions {
  model: Model<any>;
  streamFn: StreamFn;
  maxTurns?: number;
  maxRevisions?: number;
  signal?: AbortSignal;
  executionContext?: DemoExecutionContext;
  runtime?: DemoToolRuntime;
  taskPrompt?: string;
  verifyStep?: StepVerifier;
  contract?: CompletionContract;
  onText?: (delta: string) => void;
}

export interface RunPlanningAgentResult {
  state: LoopState;
  messages: AgentMessage[];
  trace: TraceEvent[];
  runtime: DemoToolRuntime;
  session: PlanningSession;
}

export const DEFAULT_TASK_PROMPT = [
  "修复登录模块的失败测试，并补充回归验证。",
  "约束：只修改 src/auth/session-policy.ts；不得改变公共 API。",
  "目标用例与约定的登录模块回归必须通过。",
  "完成后把根因、改动、验证命令与未验证项写入 artifacts/login-fix.md。",
].join("\n");

const BASE_SYSTEM_PROMPT = [
  "你是代码任务 Agent。",
  "所有面向用户的自然语言回复必须使用简体中文，不要使用英文解释或英文总结。",
  "工具调用参数中的路径、命令、代码和标识符保持原样，不要翻译。",
  "先取证，再改代码：读取真实实现、复现失败，然后做最小修改。",
  "不得根据文件名猜测实现，不得删除或弱化测试断言。",
].join("\n");

function composeSystemPrompt(base: string, session: PlanningSession): string {
  return [
    base,
    PLANNING_PROMPT,
    renderPlanSnapshot(session.snapshot(), session.evidence.list()),
  ].join("\n\n");
}

export async function runPlanningAgent(
  options: RunPlanningAgentOptions,
): Promise<RunPlanningAgentResult> {
  const executionContext = options.executionContext ?? createExecutionContext();
  const runtime = options.runtime ?? new DemoToolRuntime();
  const session = new PlanningSession({
    maxRevisions: options.maxRevisions ?? 2,
    verifyStep: options.verifyStep,
    getRevision: () => runtime.getRevision(),
  });
  const contract = options.contract ?? createLoginFixContract({
    targetSource: executionContext.targetSource,
    targetArtifact: executionContext.targetArtifact,
  });
  const state = createLoopState(options.maxTurns ?? 80);
  const guard = new LoopGuard(state, {
    session,
    contract,
    getRevision: () => runtime.getRevision(),
  });
  const trace: TraceEvent[] = [];
  const context: AgentContext = {
    systemPrompt: composeSystemPrompt(BASE_SYSTEM_PROMPT, session),
    messages: [],
    tools: createPlanningAgentTools(runtime, executionContext, session),
  };
  const prompt: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: options.taskPrompt ?? DEFAULT_TASK_PROMPT }],
    timestamp: Date.now(),
  };
  const config: AgentLoopConfig = {
    model: options.model,
    convertToLlm: (messages) => messages.filter(isLlmMessage),
    maxRetries: 0,
    toolExecution: "sequential",
    beforeToolCall: async (hookContext) => guard.beforeToolCall(hookContext),
    afterToolCall: async (hookContext) => {
      guard.observeToolResult(hookContext);
      return undefined;
    },
    // 每轮刷新计划快照：模型看到的是当前版本，而不是历次计划的堆积。
    prepareNextTurn: async ({ context: nextContext }) => ({
      context: {
        ...nextContext,
        systemPrompt: composeSystemPrompt(BASE_SYSTEM_PROMPT, session),
      },
    }),
    shouldStopAfterTurn: async (hookContext) => guard.afterTurn(hookContext),
    getSteeringMessages: async () => [],
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

  return { state, messages, trace, runtime, session };
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
    trace.push({
      type: event.type,
      turn: state.turn,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    });
    return;
  }
  if (event.type === "tool_execution_end") {
    trace.push({
      type: event.type,
      turn: state.turn,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
    });
    return;
  }
  if (event.type === "turn_end" && event.message.role === "assistant") {
    if (event.message.stopReason === "aborted") state.stopCode = "ABORTED";
    if (event.message.stopReason === "error") state.stopCode = "MODEL_ERROR";
  }
}

function isLlmMessage(
  message: AgentMessage,
): message is Extract<AgentMessage, { role: "user" | "assistant" | "toolResult" }> {
  return message.role === "user"
    || message.role === "assistant"
    || message.role === "toolResult";
}
