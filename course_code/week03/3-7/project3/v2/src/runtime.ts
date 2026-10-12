import { validateToolArguments } from "@earendil-works/pi-ai";
import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import type {
  DecisionAction,
  ExecutionContext,
  ManagedTool,
  RegisteredTool,
} from "./domain.js";
import { ToolRuntimeError } from "./domain.js";
import { clipForAudit, DEFAULT_CONTEXT_RULES, type ContextRules } from "./context-budget.js";
import { findContractBreach, describeContractFor } from "./contract.js";
import type { PolicyEngine } from "./policy.js";
import type { ToolRegistry } from "./registry.js";
import { disabledHitlGateway, HitlGatewayError, type HitlGateway, type HitlVerdict } from "./hitl/client.js";
import { approvalDigest, canonicalJson, type PlatformStore } from "./store.js";

/** 轮询审批图的间隔。人工答复本来就是秒级到分钟级的事，250 毫秒足够跟手。 */
const HITL_POLL_INTERVAL_MS = 250;

export interface InvokeRequest {
  context: ExecutionContext;
  toolCallId: string;
  modelName: string;
  args: Record<string, unknown>;
}

export interface InvocationResult {
  ok: boolean;
  action: DecisionAction;
  code: string;
  content: unknown;
  attempts: number;
  approvalId?: string;
}

interface PreparedCall extends InvokeRequest {
  tool: RegisteredTool;
  validatedArgs: Record<string, unknown>;
}

const GENERIC_SENSITIVE_KEYS = /(?:token|secret|password|api[_-]?key|authorization)/i;

export class ToolRuntime {
  private readonly prepared = new Map<string, PreparedCall>();
  private readonly auditedCalls = new Set<string>();
  private readonly pendingApprovalByTrace = new Map<string, string>();
  private readonly confirmByToolCall = new Map<string, InvocationResult>();
  private readonly grantedByToolCall = new Map<string, string>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: PolicyEngine,
    private readonly store: PlatformStore,
    /** 审批工作流的去向。不传就是阶段二行为：审批只落在本地 approvals 表，不发 HTTP。 */
    private readonly hitl: HitlGateway = disabledHitlGateway(),
    private readonly hitlWaitTimeoutMs = 120_000,
    /** 审计入库的截断上限。不给就用 config/platform.yaml 里那组默认值。 */
    private readonly contextRules: ContextRules = DEFAULT_CONTEXT_RULES,
  ) {}

  async invoke(request: InvokeRequest): Promise<InvocationResult> {
    // 图刚刚批下来的那次调用走 executeApproval：参数指纹、一次性领取、策略复核都在那条路上。
    const grantedId = this.grantFor(request.toolCallId);
    if (grantedId) return this.executeApproval(grantedId);
    const prepared = this.prepare(request);
    if (!("tool" in prepared)) return prepared;
    return this.executePrepared(prepared);
  }

  prepare(request: InvokeRequest): PreparedCall | InvocationResult {
    let tool: RegisteredTool;
    try {
      tool = this.registry.getByModelName(request.modelName);
    } catch {
      return this.reject(request, "TOOL_NOT_FOUND", "没有注册该工具");
    }

    let validatedArgs: Record<string, unknown>;
    try {
      validatedArgs = validateToolArguments(
        toolToPi(tool),
        callToPi(request.toolCallId, request.modelName, request.args),
      ) as Record<string, unknown>;
    } catch (error) {
      // 结构层：字段名、类型、边界。上游那份文案已经点到字段，但只说"不合格"，
      // 不说合格长什么样。这段回喂文案是给模型看的，所以把契约一并贴上。
      const detail = error instanceof Error ? error.message : "参数校验失败";
      return this.reject(
        request,
        "INVALID_ARGUMENT",
        `${detail}\n${describeContractFor(tool)}\n只改上面点名的字段，其余字段保持原样；同一份参数重发会被判成 REPEATED_TOOL_CALL。`,
      );
    }

    // 语义层：schema 表达不了、又注定办不成事的参数。策略与执行都在它后面，
    // 所以被这里拦下的调用一次文件系统都不会触达。
    const breach = findContractBreach(tool, validatedArgs, request.context);
    if (breach) return this.reject(request, breach.code, breach.reason, validatedArgs);

    const decision = this.policy.evaluate(request.context, tool, validatedArgs);
    if (decision.action === "deny") return this.reject(request, decision.code, decision.reason, validatedArgs);
    if (decision.action === "confirm") return this.openApproval(request, tool, validatedArgs, decision);
    if (decision.code === "APPROVAL_GATE_OFF") {
      // 放行也要留痕：这一类任务把门口关掉了，事后翻账必须能看出"这次写没有人看过"，
      // 所以它单独占一条 policy_decision，而不是混在后面那条 tool_execution:OK 里。
      this.store.addAudit({
        eventType: "policy_decision",
        context: request.context,
        toolCallId: request.toolCallId,
        toolName: tool.metadata.internalName,
        status: "allow",
        code: "APPROVAL_GATE_OFF",
        input: redact(validatedArgs, tool.metadata.sensitiveFields),
      });
    }

    const prepared: PreparedCall = { ...request, tool, validatedArgs };
    this.prepared.set(request.toolCallId, prepared);
    return prepared;
  }

  /**
   * 只开本地那张执行授权单，不发 HTTP：策略层要保持同步、可离线、可单测。
   * 同一张工具调用第二次问到这儿，直接复用第一次的结果，不再开第二张单。
   */
  private openApproval(
    request: InvokeRequest,
    tool: RegisteredTool,
    validatedArgs: Record<string, unknown>,
    decision: { code: string; reason: string },
  ): InvocationResult {
    const cached = this.confirmByToolCall.get(request.toolCallId);
    if (cached) return cached;
    const approval = this.store.createApproval({
      context: request.context,
      toolCallId: request.toolCallId,
      toolName: request.modelName,
      args: validatedArgs,
    });
    this.pendingApprovalByTrace.set(request.context.traceId, approval.id);
    this.store.addAudit({
      eventType: "policy_decision",
      context: request.context,
      toolCallId: request.toolCallId,
      toolName: tool.metadata.internalName,
      status: "confirm",
      code: decision.code,
      input: redact(validatedArgs, tool.metadata.sensitiveFields),
    });
    this.auditedCalls.add(request.toolCallId);
    this.store.addTrace({
      traceId: request.context.traceId,
      eventType: "tool.approval_requested",
      payload: {
        tool_call_id: request.toolCallId,
        tool_name: request.modelName,
        approval_id: approval.id,
        workflow: this.hitl.enabled ? "langgraph" : "local",
      },
    });
    const result: InvocationResult = {
      ok: false,
      action: "confirm",
      code: decision.code,
      content: decision.reason,
      attempts: 0,
      approvalId: approval.id,
    };
    this.confirmByToolCall.set(request.toolCallId, result);
    return result;
  }

  /**
   * pi 的 tool_call 门口。策略要求人确认时，如果审批工作流挂在 LangGraph 上，就在这里等那个人答复；
   * 批下来之后不在这里执行，只记下"这次调用被哪张单授权"，让 execute 去走 executeApproval
   * 那条硬路径——参数指纹、一次性领取、策略复核全都在那儿，两条入口共用同一套护栏。
   *
   * 返回体里 reason 是回喂给模型的那段文字（pi 与我们的 Loop 都会把它当成工具结果），
   * message 是给人看的那句原话，code 用来筛审计。reason 用纯文本而不是 JSON：模型要多花 tokens 解析
   * 一层包装，并不会更听话。
   */
  async gateForPi(request: InvokeRequest): Promise<{
    block: boolean;
    code?: string;
    reason?: string;
    message?: string;
    terminate?: boolean;
  }> {
    const prepared = this.prepare(request);
    if ("tool" in prepared) return { block: false };
    const approvalId = prepared.approvalId;
    if (prepared.action !== "confirm" || !this.hitl.enabled || !approvalId) {
      return {
        block: true,
        code: prepared.code,
        message: String(prepared.content),
        reason: `${prepared.code}: ${prepared.content}`,
      };
    }

    const block = (code: string, message: string, terminate = true) => {
      // 三条拦截路（没人有资格批、图连不上、人工拒绝）都有同一个共同点：
      // 这张单已经拿到终局了，Loop 不该再为它挂着"待审批"。
      this.settleApproval(request.context.traceId, approvalId);
      return {
        block: true as const,
        code,
        message,
        reason: `${code}: ${message}${approvalId ? `（审批单 ${approvalId}）` : ""}`,
        ...(terminate ? { terminate: true } : {}),
      };
    };

    const ticket = await this.openGraphTicket(request, approvalId);
    if ("error" in ticket) {
      // 提单都没提上去，就等于"没有人批"。这张本地单必须当场关掉：
      // 留在 pending 的话，监控上看着像"在等人"，实际上永远不会有审批人收到这张单。
      this.store.closeApproval(approvalId, ticket.error.code);
      return block(ticket.error.code, ticket.error.message);
    }
    if (ticket.status === "rejected") {
      // 图上第一道门就没过：发起名单里没人有资格批，这单不必再等人，直接拒。
      this.store.closeApproval(approvalId, ticket.code);
      return block(ticket.code, ticket.feedback ?? "没有合格的审批人");
    }

    // 停在门口等人答复：把单号打到 stderr，课堂上的第二个终端才知道要批哪一张。
    process.stderr.write(
      `等待人工审批：单号 ${approvalId} · 工具 ${request.modelName} · 仓库 ${request.context.workspace ?? "未知"}\n` +
      `  另一个终端先看队列：approvals tickets\n` +
      `  再答复：approvals decide ${approvalId} --decision approve --actor <审批人> --roles <角色>\n`,
    );

    const verdict = await this.waitForVerdict(approvalId);
    if ("error" in verdict) {
      // 等答复的途中断了（图挂了、超时）同提单失败一个性质：这张单已经作废，不能挂着。
      this.store.closeApproval(approvalId, verdict.error.code);
      return block(verdict.error.code, verdict.error.message);
    }
    if (verdict.status !== "approved") {
      this.store.decideQuietly(approvalId, "reject", verdict.decidedBy ?? "langgraph");
      return block(verdict.code, verdict.feedback ?? "人工拒绝了这次写入");
    }
    this.store.decideQuietly(approvalId, "approve", verdict.decidedBy ?? "langgraph");
    this.settleApproval(request.context.traceId, approvalId);
    this.grantedByToolCall.set(request.toolCallId, approvalId);
    this.store.addTrace({
      traceId: request.context.traceId,
      eventType: "hitl.approved",
      payload: { approval_id: approvalId, decided_by: verdict.decidedBy, feedback: verdict.feedback ?? "" },
    });
    return { block: false };
  }

  /**
   * 摘掉这条 trace 上的"待审批"标记。Loop 每轮收尾都会问一次 pendingApproval：
   * 挂着标记就停在原地等阶段二那种"下一次运行再来批"，摘掉才允许它继续转下一轮。
   * 审批挂在图上时这次运行就会拿到答复，所以拿到终局的那一刻必须摘。
   */
  private settleApproval(traceId: string, approvalId: string): void {
    if (this.pendingApprovalByTrace.get(traceId) === approvalId) {
      this.pendingApprovalByTrace.delete(traceId);
    }
  }

  /** 提单给图。图不在或连不上，一律当成"没有人批准"，不能当成"批过了"。 */
  private async openGraphTicket(
    request: InvokeRequest,
    approvalId: string,
  ): Promise<HitlVerdict | { error: { code: string; message: string } }> {
    const approval = this.store.getApproval(approvalId);
    const tool = this.registry.getByModelName(request.modelName);
    if (!approval || !tool) return { error: { code: "APPROVAL_NOT_FOUND", message: "本地审批单或工具定义丢失" } };
    try {
      const verdict = await this.hitl.openTicket({
        ticketId: approval.id,
        traceId: request.context.traceId,
        tenantId: request.context.tenantId,
        userId: request.context.userId,
        roles: request.context.roles,
        toolName: request.modelName,
        argsDigest: approval.args_digest,
        workspace: request.context.workspace ?? "unknown",
        risk: tool.metadata.risk,
        reason: "该动作必须绑定参数后由人确认",
      });
      this.store.addTrace({
        traceId: request.context.traceId,
        eventType: "hitl.ticket_opened",
        payload: { ticket_id: verdict.ticketId, status: verdict.status, code: verdict.code },
      });
      return verdict;
    } catch (error) {
      const code = error instanceof HitlGatewayError ? error.code : "HITL_UNREACHABLE";
      return { error: { code, message: error instanceof Error ? error.message : "审批服务不可达" } };
    }
  }

  /**
   * 轮询到图给出终局答复为止。图那侧的 interrupt 状态落在 checkpoint 里，
   * 所以这个等待过程不依赖任何内存：服务重启、审批人在另一个终端答复，都接得上。
   */
  private async waitForVerdict(approvalId: string): Promise<HitlVerdict | { error: { code: string; message: string } }> {
    const deadline = Date.now() + this.hitlWaitTimeoutMs;
    for (;;) {
      try {
        const verdict = await this.hitl.getTicket(approvalId);
        if (verdict.status !== "awaiting_human") return verdict;
      } catch (error) {
        const code = error instanceof HitlGatewayError ? error.code : "HITL_UNREACHABLE";
        return { error: { code, message: error instanceof Error ? error.message : "审批服务不可达" } };
      }
      if (Date.now() >= deadline) {
        return {
          error: { code: "APPROVAL_TIMEOUT", message: `等待人工审批超过 ${this.hitlWaitTimeoutMs} 毫秒，这次调用作废` },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, HITL_POLL_INTERVAL_MS));
    }
  }

  /** execute 拿这张条去走 executeApproval；取一次就作废，避免同一张单被复用。 */
  grantFor(toolCallId: string): string | undefined {
    const id = this.grantedByToolCall.get(toolCallId);
    this.grantedByToolCall.delete(toolCallId);
    return id;
  }

  async executePreparedById(
    context: ExecutionContext,
    toolCallId: string,
    modelName: string,
    args: Record<string, unknown>,
  ): Promise<InvocationResult> {
    const grantedId = this.grantFor(toolCallId);
    if (grantedId) return this.executeApproval(grantedId);
    const prepared = this.prepared.get(toolCallId);
    if (!prepared) return this.invoke({ context, toolCallId, modelName, args });
    this.prepared.delete(toolCallId);
    return this.executePrepared(prepared);
  }

  async executeApproval(id: string, suppliedArgs?: Record<string, unknown>): Promise<InvocationResult> {
    const approval = this.store.getApproval(id);
    if (!approval || approval.status !== "approved") {
      return failure("APPROVAL_NOT_EXECUTABLE", "审批不存在、已过期或已被消费");
    }
    const context = JSON.parse(approval.context_json) as ExecutionContext;
    const storedArgs = JSON.parse(approval.args_json) as Record<string, unknown>;
    const args = suppliedArgs ?? storedArgs;
    const expected = approvalDigest({
      traceId: approval.trace_id,
      toolCallId: approval.tool_call_id,
      toolName: approval.tool_name,
      context,
      args,
    });
    if (expected !== approval.args_digest || canonicalJson(args) !== canonicalJson(storedArgs)) {
      return failure("APPROVAL_BINDING_MISMATCH", "工具参数已变化，旧审批失效");
    }
    if (!this.store.claimApproval(id)) return failure("APPROVAL_NOT_EXECUTABLE", "审批已被其他执行者占用");

    let tool: RegisteredTool;
    let validatedArgs: Record<string, unknown>;
    try {
      tool = this.registry.getByModelName(approval.tool_name);
      validatedArgs = validateToolArguments(
        toolToPi(tool),
        callToPi(approval.tool_call_id, approval.tool_name, args),
      ) as Record<string, unknown>;
    } catch (error) {
      this.store.finishApproval(id, "failed", "INVALID_ARGUMENT");
      return failure("INVALID_ARGUMENT", error instanceof Error ? error.message : "参数校验失败");
    }
    // 审批单里的参数是从数据库读回来的，没有任何上游校验器看过它。契约与策略在这条路上要重跑一遍：
    // 批"往 src/a.ts 写"不等于批"往任何地方写"，也不等于批"这个参数本身是合法的"。
    const breach = findContractBreach(tool, validatedArgs, context);
    if (breach) {
      this.store.finishApproval(id, "failed", breach.code);
      return failure(breach.code, breach.reason);
    }
    const policy = this.policy.evaluate(context, tool, validatedArgs, { approvalSatisfied: true });
    if (policy.action !== "allow") {
      this.store.finishApproval(id, "failed", policy.code);
      return failure(policy.code, policy.reason);
    }

    const result = await this.executePrepared({
      context,
      toolCallId: approval.tool_call_id,
      modelName: approval.tool_name,
      args,
      tool,
      validatedArgs,
    });
    this.store.finishApproval(id, result.ok ? "consumed" : "failed", result.ok ? undefined : result.code);
    return result;
  }

  pendingApproval(traceId: string): string | undefined {
    return this.pendingApprovalByTrace.get(traceId);
  }

  wasAudited(toolCallId: string): boolean {
    return this.auditedCalls.has(toolCallId);
  }

  recordPiImmediateFailure(input: {
    context: ExecutionContext;
    toolCallId: string;
    modelName: string;
    args: Record<string, unknown>;
    code?: string;
    message: string;
  }): void {
    if (this.wasAudited(input.toolCallId)) return;
    this.reject(
      {
        context: input.context,
        toolCallId: input.toolCallId,
        modelName: input.modelName,
        args: input.args,
      },
      input.code ?? "PI_TOOL_ERROR",
      input.message,
    );
  }

  private reject(
    request: InvokeRequest,
    code: string,
    reason: string,
    validatedArgs: Record<string, unknown> = request.args,
  ): InvocationResult {
    let internalName = request.modelName;
    let sensitiveFields: string[] | undefined;
    try {
      const tool = this.registry.getByModelName(request.modelName);
      internalName = tool.metadata.internalName;
      sensitiveFields = tool.metadata.sensitiveFields;
    } catch {
      // Unknown calls still need an audit record.
    }
    this.store.addAudit({
      eventType: "policy_decision",
      context: request.context,
      toolCallId: request.toolCallId,
      toolName: internalName,
      status: "deny",
      code,
      input: redact(validatedArgs, sensitiveFields),
    });
    this.auditedCalls.add(request.toolCallId);
    this.store.addTrace({
      traceId: request.context.traceId,
      eventType: "tool.denied",
      payload: { tool_call_id: request.toolCallId, tool_name: request.modelName, code, reason },
    });
    return { ok: false, action: "deny", code, content: reason, attempts: 0 };
  }

  private async executePrepared(prepared: PreparedCall): Promise<InvocationResult> {
    const startedAt = Date.now();
    const { tool } = prepared;
    const maxAttempts = tool.metadata.idempotent ? tool.metadata.maxRetries + 1 : 1;
    let lastError: unknown;
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsUsed = attempt;
      const timeoutController = new AbortController();
      try {
        const output = await runWithDeadline(
          () => tool.handler({
            toolCallId: prepared.toolCallId,
            args: prepared.validatedArgs,
            context: prepared.context,
            signal: timeoutController.signal,
          }),
          tool.metadata.timeoutMs,
          timeoutController,
          // 基准用 risk == read（而不是仅仅 idempotent）做最终兑底：即使配置把写操作
          // 误标成 idempotent，写操作也绝不会因超时重试。
          tool.metadata.risk === "read",
        );
        return this.success(prepared, output, attempt, Date.now() - startedAt);
      } catch (error) {
        lastError = error;
        const retryable = lastError instanceof ToolRuntimeError && lastError.retryable;
        if (!retryable || attempt >= maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(25 * 2 ** (attempt - 1), 100)));
      }
    }

    if (tool.fallbackHandler && lastError instanceof ToolRuntimeError && lastError.retryable) {
      try {
        const fallbackController = new AbortController();
        const output = await runWithDeadline(
          () => tool.fallbackHandler!({
            toolCallId: prepared.toolCallId,
            args: prepared.validatedArgs,
            context: prepared.context,
            signal: fallbackController.signal,
          }),
          tool.metadata.timeoutMs,
          fallbackController,
          false, // fallback 是最后一道防线，其自身超时不应再进入重试
        );
        return this.success(prepared, output, attemptsUsed, Date.now() - startedAt, "FALLBACK_OK");
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }

    const code = lastError instanceof ToolRuntimeError ? lastError.code : "TOOL_EXECUTION_FAILED";
    const message = lastError instanceof Error ? lastError.message : "工具执行失败";
    this.store.addAudit({
      eventType: "tool_execution",
      context: prepared.context,
      toolCallId: prepared.toolCallId,
      toolName: tool.metadata.internalName,
      status: "error",
      code,
      input: redact(prepared.validatedArgs, tool.metadata.sensitiveFields),
      output: clipForAudit(message, this.contextRules),
      latencyMs: Date.now() - startedAt,
    });
    this.auditedCalls.add(prepared.toolCallId);
    this.store.addTrace({
      traceId: prepared.context.traceId,
      eventType: "tool.failed",
      payload: { tool_call_id: prepared.toolCallId, tool_name: tool.modelName, code },
    });
    return { ok: false, action: "deny", code, content: message, attempts: attemptsUsed };
  }

  private success(
    prepared: PreparedCall,
    rawOutput: unknown,
    attempts: number,
    latencyMs: number,
    code = "OK",
  ): InvocationResult {
    const output = redact(rawOutput, prepared.tool.metadata.sensitiveFields);
    this.store.addAudit({
      eventType: "tool_execution",
      context: prepared.context,
      toolCallId: prepared.toolCallId,
      toolName: prepared.tool.metadata.internalName,
      status: "success",
      code,
      input: redact(prepared.validatedArgs, prepared.tool.metadata.sensitiveFields),
      // 模型拿到的是整份工具输出，数据库拿到的是按行截断的那一份加全量哈希。
      // 两边不是一份文本，这件事必须写在账上，不然事后对账会以为审计丢了内容。
      output: clipForAudit(output, this.contextRules),
      latencyMs,
    });
    this.auditedCalls.add(prepared.toolCallId);
    this.store.addTrace({
      traceId: prepared.context.traceId,
      eventType: "tool.completed",
      payload: {
        tool_call_id: prepared.toolCallId,
        tool_name: prepared.modelName,
        attempts,
        latency_ms: latencyMs,
        code,
      },
    });
    return { ok: true, action: "allow", code, content: output, attempts };
  }
}

async function runWithDeadline<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  controller: AbortController,
  retryOnTimeout = true,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      // 超时默认不再标记为 retryable。调用方（executePrepared）是否为幂等工具决定
      // 是否允许重试：超时意味着结果不可知，重试非幂等操作会放大“幽灵副作用”风险。
      reject(new ToolRuntimeError("TOOL_TIMEOUT", "工具执行超时", retryOnTimeout));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function toolToPi(tool: RegisteredTool): Tool {
  return {
    name: tool.modelName,
    description: tool.metadata.description,
    parameters: tool.metadata.parameters,
  };
}

function callToPi(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { type: "toolCall", id, name, arguments: structuredClone(args) as ToolCall["arguments"] };
}

function failure(code: string, message: string): InvocationResult {
  return { ok: false, action: "deny", code, content: message, attempts: 0 };
}

export function redact(value: unknown, configured: string[] = []): unknown {
  const sensitive = new Set(configured.map((item) => item.toLowerCase()));
  if (Array.isArray(value)) return value.map((item) => redact(item, configured));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitive.has(key.toLowerCase()) || GENERIC_SENSITIVE_KEYS.test(key) ? "***" : redact(item, configured),
      ]),
    );
  }
  return value;
}
