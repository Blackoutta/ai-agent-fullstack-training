import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExecutionContext } from "../domain.js";
import { costUsdOf, freshTokensOf, LoopGuard } from "../loop-guard.js";
import { renderContext, textOf, type RenderableMessage } from "../context-budget.js";
import { deliverableLine, verifyDeliverable } from "../deliverable.js";
import { buildPlatform, executionContext, type Platform } from "../platform.js";
import { deciderLabel, selectDecider, type DeciderRequest, type DeciderSelection } from "./decider.js";
import { renderSystemPrompt, sha256 } from "./prompt-client.js";

/**
 * pi 的扩展点入口：pi --extension src/pi/coding-agent-extension.ts
 * 十件工具不是 MCP server，是进程内注册进来的 ManagedTool，每一次调用都要过 Runtime。
 */
export default function managedRuntimeExtension(pi: ExtensionAPI): void {
  pi.registerFlag("managed-config", { description: "平台配置文件", type: "string" });
  pi.registerFlag("managed-dir", { description: "本次打开的仓库目录", type: "string" });
  pi.registerFlag("managed-task", { description: "任务类型 ID：仓库、决策脚本、预算、审批口径都按 config/tasks.yaml 的条目装配", type: "string" });
  pi.registerFlag("managed-script", { description: "离线决策脚本 YAML：给了它就不连网关，用于课堂演示与 CI", type: "string" });
  pi.registerFlag("managed-decider", { description: "决策口径：real（默认，直连 DeepSeek；没设 DEEPSEEK_API_KEY 时按 tasks.yaml 的脚本降级并说破）/ auto（有离线脚本就离线）/ mock（只准离线）", type: "string", default: "real" });
  pi.registerFlag("managed-roles", { description: "逗号分隔角色", type: "string", default: "maintainer" });
  pi.registerFlag("managed-user-id", { description: "业务用户 ID", type: "string", default: "trainer-1" });
  pi.registerFlag("managed-tenant-id", { description: "租户 ID", type: "string", default: "tenant_a" });
  pi.registerFlag("managed-mode", { description: "plan 或 execute", type: "string", default: "execute" });

  let platform: Platform | undefined;
  let context: ExecutionContext | undefined;
  let guard: LoopGuard | undefined;
  let managedToolNames = new Set<string>();
  let governedPrompt: string | undefined;
  let governedHash: string | undefined;
  const traceId = randomUUID();
  let contextRenders = 0;
  let deciderSelection: DeciderSelection | undefined;
  let deciderSteps = 0;
  const flag = (name: string): string | undefined => {
    const value = pi.getFlag(name);
    return value === undefined ? undefined : String(value);
  };

  pi.on("session_start", async (_event, ctx) => {
    platform = await buildPlatform({
      configPath: flag("managed-config") ?? process.env.PLATFORM_CONFIG,
      workspace: flag("managed-dir") ?? process.env.PLATFORM_WORKSPACE,
      // pi 的 session_start 拿不到用户那句目标，所以这里不能按关键词路由，只能点名。
      // 点名的收益是后面三个开关都不用写：仓库、脚本、预算、审批口径全在任务条目里。
      task: flag("managed-task"),
    });
    // 决策器由同一个 selectDecider 选：这条入口和 CLI 那条对"换脑袋"的规则完全一致。
    const { decider, selection } = selectDecider(platform.config, {
      requested: flag("managed-decider") as DeciderRequest | undefined,
      scriptPath: flag("managed-script"),
    });
    deciderSelection = selection;
    platform.store.addTrace({
      traceId,
      eventType: "decider.selected",
      payload: { label: deciderLabel(selection), ...selection },
    });
    console.log(`[决策器] ${deciderLabel(selection)} · ${selection.reason}`);
    decider.registerTo(pi);
    if (!(await pi.setModel(decider.model))) {
      throw new Error(
        decider.kind === "gateway"
          ? `MODEL_UNAVAILABLE: 先设置 ${platform.config.gateway.apiKeyEnv}（DeepSeek 密钥），或加 --managed-script 用离线脚本`
          : "MODEL_UNAVAILABLE: 脚本决策器注册失败",
      );
    }
    const runContext = executionContext({
      traceId,
      requestId: randomUUID(),
      userId: flag("managed-user-id") ?? "trainer-1",
      tenantId: flag("managed-tenant-id") ?? "tenant_a",
      roles: (flag("managed-roles") ?? "maintainer").split(",").map((item) => item.trim()).filter(Boolean),
      mode: flag("managed-mode") === "plan" ? "plan" : "execute",
      workspace: platform.config.sandbox.root,
    });
    context = runContext;
    const runtime = platform.runtime;

    const visible = platform.registry.snapshot(runContext, platform.policy);
    guard = new LoopGuard(platform.config.runtime);
    managedToolNames = new Set(visible.map((tool) => tool.modelName));
    for (const tool of visible) {
      pi.registerTool({
        name: tool.modelName,
        label: tool.metadata.internalName,
        description: tool.metadata.description,
        promptSnippet: `${tool.metadata.internalName}（${tool.metadata.risk}）`,
        promptGuidelines: [`${tool.modelName} 的调用必须服从 Runtime 的权限、审批与预算结果。`],
        parameters: tool.metadata.parameters,
        executionMode: tool.metadata.executionMode,
        async execute(toolCallId, params) {
          const result = await runtime.invoke({
            context: runContext,
            toolCallId,
            modelName: tool.modelName,
            args: params as Record<string, unknown>,
          });
          return {
            content: [{ type: "text", text: typeof result.content === "string" ? result.content : JSON.stringify(result.content) }],
            details: { governed: true, trace_id: traceId, code: result.code, approval_id: result.approvalId },
            isError: !result.ok,
          };
        },
      });
    }
    ctx.ui.notify(
      `受治理的 ${visible.length} 件仓库工具已注册（决策器：${decider.kind}）` +
        `，任务=${platform.config.task?.id ?? "未指定"} · 仓库=${platform.config.sandbox.root}，trace=${traceId}`,
      "info",
    );

    const bundle = await renderSystemPrompt(platform.config, runContext);
    platform.store.addTrace({
      traceId,
      eventType: "prompt_rendered",
      payload: {
        prompt_name: platform.config.gateway.promptName,
        source: bundle.source,
        version: bundle.version,
        content_hash: bundle.contentHash,
        task_id: platform.config.task?.id ?? null,
      },
    });
    governedPrompt = bundle.prompt;
    governedHash = bundle.contentHash;
  });

  pi.on("before_agent_start", (event) => {
    if (!platform || !governedPrompt) return undefined;
    // pi 自带一套编码提示词，我们那份治理规则追加在后面；
    // 这里把交出去的那一份也留一条底，事后能核对模型收到的到底是哪版规则。
    const assembled = `${event.systemPrompt}\n\n${governedPrompt}`;
    platform.store.addTrace({
      traceId,
      eventType: "prompt_delivered",
      payload: {
        pi_chars: event.systemPrompt.length,
        governed_chars: governedPrompt.length,
        delivered_hash: sha256(assembled),
        governed_hash: governedHash,
      },
    });
    return { systemPrompt: assembled };
  });

  /**
   * P3 的上下文渲染在两条入口上必须走同一个函数：CLI 的 runAgentLoop 用 transformContext，
   * pi 自己转 Loop 时用这个钩子。钩子每次请求模型前触发，返回的 messages 就是发出去的那一份，
   * 所以压缩只在这里做一次决定，别处不再各写一份裁剪逻辑。
   */
  pi.on("context_with_system", (event) => {
    if (!platform) return undefined;
    const messages = event.messages as unknown as RenderableMessage[];
    try {
      const rendered = renderContext(messages, platform.config.context);
      // 探针核实（0.87.1）：这个钩子每次模型请求触发一次；messages[0] 确实是 system，
      // 但 content 是空串——真正的系统提示词由 pi 在钩子之后拼装，钩子里看不到。
      // 所以这条入口上被压缩的只有对话正文；系统提示词由 pi 自己补回，我们碰不到也不需要碰。
      // 不管压没压都记一行：这一串 seq 就是"pi 在一次 Run 里把 context_with_system 调了几次"的实证。
      // CLI 入口每请求一次记一次，这里也照同样口径记账，两边才数得出同一件事。
      platform.store.addTrace({
        traceId,
        eventType: "context.rendered",
        payload: { source: "pi", seq: (contextRenders += 1), ...rendered.stats },
      });
      if (rendered.stats.steps_summarized === 0) return undefined;
      return { messages: rendered.messages as never };
    } catch {
      // pi 不许这个钩子抛错：渲染失败就交回原文，上下文胖一点总比这轮跑挂。
      return undefined;
    }
  });

  pi.on("tool_call", async (event) => {
    // LoopGuard 原本只在我们自己的 Loop 上生效；pi 自己转圈时它不在环上。
    // pi 没有「这一轮要不要继续」的钩子，所以把预算检查压到工具调用这道门口：
    // 轮数、token、金额、时限任一耗尽，或者还挂着待审批，下一次工具调用就被拦死。
    if (!platform || !guard || !context) return undefined;
    const exhausted = guard.shouldStop(platform.runtime.pendingApproval(traceId));
    const budget = exhausted.stop
      ? { allow: false as const, code: exhausted.code, reason: exhausted.reason }
      : guard.beforeToolCall(event.toolName, event.input);
    if (!budget.allow) {
      if (managedToolNames.has(event.toolName)) {
        platform.runtime.recordPiImmediateFailure({
          context,
          toolCallId: event.toolCallId,
          modelName: event.toolName,
          args: event.input,
          code: budget.code,
          message: budget.reason,
        });
      }
      return { block: true, reason: `${budget.code}: ${budget.reason}`, terminate: true };
    }
    // 预算放过去之后，才轮到策略与审批。审批挂在 LangGraph 上时，这一句会停在这里等真人答复。
    if (!managedToolNames.has(event.toolName)) return undefined;
    const gate = await platform.runtime.gateForPi({
      context,
      toolCallId: event.toolCallId,
      modelName: event.toolName,
      args: event.input,
    });
    if (!gate.block) return undefined;
    // terminate 由 Runtime 判：契约拒绝、权限不足是"这一条不许，换条路"，回喂给模型就够；
    // 只有审批拿到终局（人工拒绝、图连不上、没人有资格批）才停整个 Run。
    // 这里原先硬编码 terminate: true，第一次契约拒绝就把 pi 的 Loop 掐死了：
    // 回喂在最该起作用的入口上失效，模型连改参数的机会都没有。
    return { block: true, reason: gate.reason, ...(gate.terminate ? { terminate: true } : {}) };
  });

  pi.on("turn_end", (event) => {
    if (!guard || !platform) return;
    guard.observeTurn();
    if (event.message.role === "assistant") {
      guard.observeAssistantUsage({
        totalTokens: freshTokensOf(event.message.usage),
        costUsd: costUsdOf(event.message.usage, platform.config.model),
      });
      // 每一步报一次身份：CLI 那条入口也报同一句，两条路对账时数得出"这一趟是谁在主事"。
      if (deciderSelection) {
        deciderSteps += 1;
        const label = deciderLabel(deciderSelection);
        platform.store.addTrace({
          traceId,
          eventType: "decider.step",
          payload: { step: deciderSteps, label, source: "pi" },
        });
        console.log(`[决策器 · 第${deciderSteps}步] ${label}`);
      }
    }
  });

  pi.on("agent_end", (event) => {
    if (!platform || !guard) return;
    platform.store.addTrace({ traceId, eventType: "loop.budget", payload: guard.snapshot() });
    const task = platform.config.task;
    if (!deciderSelection || !task) return;
    // 交付物回读：模型在最终回答里说了什么不算数，审计里那次成功的写入才算数。
    const finalAnswer = textOf(
      [...(event.messages as unknown as RenderableMessage[])].reverse().find((message) => message.role === "assistant")?.content,
    );
    const verification = verifyDeliverable(platform.store, {
      traceId,
      task: { id: task.id, label: task.displayName, deliverable: task.deliverable, approvers: platform.config.hitl.approvers },
      decider: {
        kind: deciderSelection.kind,
        label: deciderLabel(deciderSelection),
        script: deciderSelection.script,
        degraded: deciderSelection.degraded,
      },
      finalAnswer,
    });
    platform.store.addTrace({ traceId, eventType: "deliverable.verified", payload: verification as unknown as Record<string, unknown> });
    console.log(deliverableLine(verification));
  });

  pi.on("tool_result", (event) => {
    if (!platform || platform.runtime.wasAudited(event.toolCallId)) return;
    platform.store.addTrace({
      traceId,
      eventType: "pi.tool_result",
      payload: { tool_call_id: event.toolCallId, tool_name: event.toolName, is_error: event.isError },
    });
  });

  pi.on("session_shutdown", async () => {
    await platform?.close();
    platform = undefined;
  });
}
