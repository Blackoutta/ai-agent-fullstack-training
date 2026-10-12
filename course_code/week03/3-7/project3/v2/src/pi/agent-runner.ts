import { randomUUID } from "node:crypto";
import { runAgentLoop, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, SystemMessage, UserMessage } from "@earendil-works/pi-ai";
import { costUsdOf, freshTokensOf, LoopGuard } from "../loop-guard.js";
import { renderContext, type ContextStats, type RenderableMessage } from "../context-budget.js";
import type { PlatformConfig } from "../config.js";
import type { Platform } from "../platform.js";
import { executionContext } from "../platform.js";
import { deciderLabel, selectDecider, type DeciderRequest, type ScriptedStep } from "./decider.js";
import { deliverableLine, verifyDeliverable } from "../deliverable.js";
import { renderSystemPrompt } from "./prompt-client.js";

export interface RunAgentInput {
  prompt: string;
  userId: string;
  tenantId: string;
  roles: string[];
  agentName?: string;
  mode?: "plan" | "execute";
  onText?: (delta: string) => void;
  /** 给了脚本就用离线脚本决策器，测试与 CI 因此完全不联网。 */
  script?: ScriptedStep[];
  /** 点名一份离线脚本文件；没点名时用任务条目里配的 script。 */
  scriptPath?: string;
  /**
   * 每走一步回调一次"这一步是谁在主事"。决策器可插拔的代价是看不出来是谁在决策，
   * 这两条回调（外加开头那条 selection）就是补上的可见性。
   */
  onDeciderStep?: (line: string) => void;
  /** 开头那句"这一趟由谁决策"：口径、降级原因都在这行里，打印与记账共用一份文本。 */
  onDeciderSelected?: (line: string) => void;
  /** 收口那句"交付物有没有账"：两条入口印同一句话，所以文本由 deliverableLine 统一生成。 */
  onDeliverable?: (line: string) => void;
  /** 决策口径：auto（默认，有离线脚本就离线）/ mock（只准离线）/ real（只准真模型，无密钥可降级但会说破）。 */
  decider?: DeciderRequest;
}

export async function runManagedAgent(platform: Platform, input: RunAgentInput) {
  const traceId = randomUUID();
  const context = executionContext({
    traceId,
    requestId: randomUUID(),
    userId: input.userId,
    tenantId: input.tenantId,
    roles: input.roles,
    agentName: input.agentName,
    mode: input.mode,
    workspace: platform.config.sandbox.root,
  });
  const promptBundle = await renderSystemPrompt(platform.config, context);
  platform.store.addTrace({
    traceId,
    eventType: "prompt_rendered",
    payload: {
      prompt_name: platform.config.gateway.promptName,
      source: promptBundle.source,
      version: promptBundle.version,
      content_hash: promptBundle.contentHash,
      task_id: platform.config.task?.id ?? null,
    },
  });
  const { decider, selection } = selectDecider(platform.config, {
    requested: input.decider,
    scriptPath: input.scriptPath,
    inlineScript: input.script,
  });
  const { models, model } = decider;
  const selectionLine = `[决策器] ${deciderLabel(selection)} · ${selection.reason}`;
  platform.store.addTrace({
    traceId,
    eventType: "decider.selected",
    payload: { label: deciderLabel(selection), ...selection },
  });
  input.onDeciderSelected?.(selectionLine);  const guard = new LoopGuard(platform.config.runtime);
  /**
   * 每次请求模型之前渲染一次上下文（P3）。这里攒的是每次渲染的统计：
   * 交付时要能说出"第几轮压掉了多少步、剩多少字符"，而不是"我觉得上下文变短了"。
   */
  const contextRenders: ContextStats[] = [];
  const tools = platform.registry.snapshot(context, platform.policy).map<AgentTool>((tool) => ({
    name: tool.modelName,
    label: tool.metadata.internalName,
    description: tool.metadata.description,
    parameters: tool.metadata.parameters,
    executionMode: tool.metadata.executionMode,
    async execute(toolCallId, args) {
      const result = await platform.runtime.executePreparedById(
        context,
        toolCallId,
        tool.modelName,
        args as Record<string, unknown>,
      );
      if (!result.ok) throw new Error(`${result.code}: ${asText(result.content)}`);
      return {
        content: [{ type: "text", text: asText(result.content) }],
        details: { code: result.code, attempts: result.attempts, governed: true },
      };
    },
  }));
  const systemMessage: SystemMessage = { role: "system", content: promptBundle.prompt, timestamp: Date.now() };
  const userMessage: UserMessage = { role: "user", content: input.prompt, timestamp: Date.now() };
  let stop = { stop: false, code: "CONTINUE", reason: "预算允许继续" };
  let blockedByGate = false;
  /**
   * 模型发出的原始参数，按 toolCallId 存一份。上游校验器（pi 那一层）会在我们的门口之前
   * 就把不合格的参数挡掉，这类调用不会走到 prepare()，审计里的 input 就成了空的——
   * 事后翻账看不出"它当时到底发了什么"。这里补上，被拒的调用也留得下原始参数。
   */
  const rawArgsByToolCall = new Map<string, Record<string, unknown>>();
  /** 第几步 = 第几次拿到 assistant 消息；这一位只用来打印身份。 */
  const stepIdentity = { label: deciderLabel(selection), steps: 0 };

  const messages = await runAgentLoop(
    [systemMessage, userMessage],
    { messages: [], tools },
    {
      model,
      convertToLlm: (items) => items.filter(isLlmMessage),
      transformContext: async (messages) => {
        // pi 写明这个钩子不许抛：渲染出岔子就把原文交回去，宁可多烧一点上下文也不能把 Loop 弄断。
        try {
          const rendered = renderContext(messages as unknown as RenderableMessage[], platform.config.context);
          contextRenders.push(rendered.stats);
          platform.store.addTrace({
            traceId,
            eventType: "context.rendered",
            payload: { source: "cli", seq: contextRenders.length, ...rendered.stats },
          });
          return rendered.messages as unknown as typeof messages;
        } catch {
          return messages;
        }
      },
      reasoning: undefined,
      maxTokens: platform.config.model.maxTokens,
      beforeToolCall: async ({ toolCall, args }) => {
        const guardDecision = guard.beforeToolCall(toolCall.name, args as Record<string, unknown>);
        if (!guardDecision.allow) {
          platform.runtime.recordPiImmediateFailure({
            context,
            toolCallId: toolCall.id,
            modelName: toolCall.name,
            args: args as Record<string, unknown>,
            code: guardDecision.code,
            message: guardDecision.reason,
          });
          return { block: true, reason: `${guardDecision.code}: ${guardDecision.reason}` };
        }
        const decision = await platform.runtime.gateForPi({
          context,
          toolCallId: toolCall.id,
          modelName: toolCall.name,
          args: args as Record<string, unknown>,
        });
        if (!decision.block) return undefined;
        // 人工拒了、图连不上、没人有资格批——这三条路都给 terminate：这一批工具结果之后 Loop 就收口，
        // 最终回答停在"被拦死"这个事实上。让模型接着讲一个和结局相反的收尾，是 Harness 不该纵容的事。
        if (decision.terminate) {
          blockedByGate = true;
          stop = { stop: true, code: decision.code ?? "GATE_BLOCKED", reason: decision.message ?? "Runtime 拦下了这次调用" };
          return { block: true, reason: decision.reason, terminate: true };
        }
        return { block: true, reason: decision.reason };
      },
      afterToolCall: async ({ result, isError }) => ({
        details: { ...(asRecord(result.details)), governed: true, trace_id: traceId },
        isError,
      }),
      finishTurn: async (turn) => {
        // 门口已经被拦死过一次，这一轮就没有"继续"可言：结局由拦死的那条决定说话。
        if (blockedByGate) return { action: "end" as const };
        const budgetStop = guard.shouldStop(platform.runtime.pendingApproval(traceId));
        if (budgetStop.stop) {
          stop = budgetStop;
          return { action: "end" as const };
        }
        // 这一轮模型没有要任何工具 = 它给的就是最终回答，Loop 到此收口。
        const askedForWork = turn.message.content.some((part) => part.type === "toolCall");
        stop = askedForWork
          ? { stop: false, code: "CONTINUE", reason: "预算允许继续" }
          : { stop: true, code: "COMPLETED", reason: "模型给出最终回答，Loop 正常收口" };
        return { action: askedForWork ? "continue" : "end" };
      },
    },
    async (event) => observeEvent(platform, context, guard, event, rawArgsByToolCall, input, stepIdentity),
    undefined,
    models.streamSimple.bind(models),
  );

  const lastAssistant = [...messages].reverse().find((message): message is AssistantMessage => message.role === "assistant");
  const finalAnswer = lastAssistant?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("") ?? "";
  const task = platform.config.task;
  const verification = verifyDeliverable(platform.store, {
    traceId,
    // 名单取装配之后的那份（platform.config.hitl），不是 tasks.yaml 原文：命令行覆盖掉的东西不该被写进账。
    task: task ? { id: task.id, label: task.displayName, deliverable: task.deliverable, approvers: platform.config.hitl.approvers } : undefined,
    decider: { kind: selection.kind, label: deciderLabel(selection), script: selection.script, degraded: selection.degraded },
    finalAnswer,
  });
  // 两条入口留同一类事件：事后翻账时，CLI 跑的那趟和 pi 跑的那趟要能放在一起比。
  platform.store.addTrace({ traceId, eventType: "deliverable.verified", payload: verification as unknown as Record<string, unknown> });
  input.onDeliverable?.(deliverableLine(verification));
  return {
    trace_id: traceId,
    task: task?.id ?? null,
    decider: {
      kind: selection.kind,
      requested: selection.requested,
      label: deciderLabel(selection),
      script: selection.script,
      model_id: selection.modelId,
      reason: selection.reason,
      degraded: selection.degraded,
      steps: stepIdentity.steps,
    },
    /** 交付物回读：模型说没说是一回事，审计里有没有那次成功的写入是另一回事。 */
    deliverable: verification,
    prompt_source: promptBundle.source,
    prompt_version: promptBundle.version,
    prompt_hash: promptBundle.contentHash,
    final_answer: finalAnswer,
    stop,
    pending_approval_id: platform.runtime.pendingApproval(traceId),
    budget: guard.snapshot(),
    context: {
      renders: contextRenders.length,
      rules: platform.config.context,
      last: contextRenders[contextRenders.length - 1] ?? null,
    },
    message_count: messages.length,
  };
}

/** 观察并记账：pi 的每个事件都落一条 Trace，模型自述不进这里。 */
async function observeEvent(
  platform: Platform,
  context: ReturnType<typeof executionContext>,
  guard: LoopGuard,
  event: AgentEvent,
  rawArgsByToolCall: Map<string, Record<string, unknown>>,
  input: RunAgentInput,
  stepIdentity: { label: string; steps: number },
): Promise<void> {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    input.onText?.(event.assistantMessageEvent.delta);
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    // 每一步都报一次"这一步是谁在主事"：mock 与 real 换着用之后，这是唯一能当场看出来的地方。
    stepIdentity.steps += 1;
    platform.store.addTrace({
      traceId: context.traceId,
      eventType: "decider.step",
      payload: { step: stepIdentity.steps, label: stepIdentity.label },
    });
    input.onDeciderStep?.(`[决策器 · 第${stepIdentity.steps}步] ${stepIdentity.label}`);
    for (const part of event.message.content) {
      if (part.type === "toolCall") {
        rawArgsByToolCall.set(part.id, part.arguments as Record<string, unknown>);
      }
    }
    guard.observeAssistantUsage({
      totalTokens: freshTokensOf(event.message.usage),
      costUsd: costUsdOf(event.message.usage, platform.config.model),
    });
  }
  if (event.type === "turn_end") guard.observeTurn();
  if (event.type === "tool_execution_end" && event.isError && !platform.runtime.wasAudited(event.toolCallId)) {
    platform.runtime.recordPiImmediateFailure({
      context,
      toolCallId: event.toolCallId,
      modelName: event.toolName,
      args: rawArgsByToolCall.get(event.toolCallId) ?? {},
      message: event.result.content
        .map((part: { type: string; text?: string }) => (part.type === "text" ? part.text ?? "" : "[image]"))
        .join("\n"),
    });
  }
  platform.store.addTrace({
    traceId: context.traceId,
    eventType: `pi.${event.type}`,
    payload: summarizeEvent(event),
  });
}

function summarizeEvent(event: AgentEvent): Record<string, unknown> {
  if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
    return { tool_call_id: event.toolCallId, tool_name: event.toolName, is_error: "isError" in event ? event.isError : false };
  }
  if (event.type === "turn_end") return { tool_result_count: event.toolResults.length };
  if (event.type === "message_end") return { role: event.message.role };
  return { type: event.type };
}

function isLlmMessage(message: any): message is Message {
  return message.role === "system" || message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
