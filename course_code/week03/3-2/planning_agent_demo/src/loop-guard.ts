// ============================================================================
// LoopGuard：轮数、重复动作、完成契约与 Follow-up。
//
// 与 3.1 相比，本节把两件事接到 Loop 的既有 Hook 上：
//   beforeToolCall  —— 受计划约束的动作必须绑定到已就绪的步骤；
//   shouldStopAfterTurn —— 完成判断改为可注入的 CompletionContract。
// ============================================================================
import { createHash } from "node:crypto";
import type {
  AgentMessage,
  AfterToolCallContext,
  BeforeToolCallContext,
  ShouldStopAfterTurnContext,
} from "@earendil-works/pi-agent-core";

import type { CompletionContract } from "./completion-contract.js";
import { GOVERNED_TOOLS } from "./pi-tools.js";
import type { PlanningSession } from "./plan-store.js";
import type { ToolEvidence } from "./runtime.js";

export interface Evidence {
  readFiles: Set<string>;
  writtenArtifacts: Set<string>;
}

export interface LoopState {
  runId: string;
  turn: number;
  maxTurns: number;
  stopCode?: string;
  actions: Map<string, number>;
  evidence: Evidence;
}

export interface LoopGuardDeps {
  session: PlanningSession;
  contract: CompletionContract;
  /** 当前代码版本，用于把证据绑定到产生它的版本。 */
  getRevision: () => string;
  governedTools?: Set<string>;
}

export class LoopGuard {
  private followUps: AgentMessage[] = [];
  private readonly governedTools: Set<string>;

  constructor(
    readonly state: LoopState,
    private readonly deps: LoopGuardDeps,
  ) {
    this.governedTools = deps.governedTools ?? GOVERNED_TOOLS;
  }

  beforeToolCall(
    context: BeforeToolCallContext,
  ): { block?: boolean; reason?: string } {
    const fingerprint = this.fingerprint(context.toolCall.name, context.args);
    const count = this.state.actions.get(fingerprint) ?? 0;
    this.state.actions.set(fingerprint, count + 1);

    if (count + 1 >= 3) {
      this.state.stopCode = "REPEATED_ACTION";
      return {
        block: true,
        reason: [
          "REPEATED_ACTION：相同工具和参数已出现三次。",
          "本次调用未执行。",
        ].join(" "),
      };
    }

    return this.checkPlanGate(context);
  }

  /** 受计划约束的动作必须绑定步骤，且该步骤当前允许执行。 */
  private checkPlanGate(
    context: BeforeToolCallContext,
  ): { block?: boolean; reason?: string } {
    const plan = this.deps.session.plan;
    if (!plan) return {};

    const args = context.args as Record<string, unknown>;
    const stepId = args.planStepId;
    if (typeof stepId !== "string" || stepId.length === 0) {
      // 读类工具可以不带步骤，但写入、改代码和跑测试必须绑定计划步骤。
      if (!this.governedTools.has(context.toolCall.name)) return {};
      return {
        block: true,
        reason: [
          "PLAN_STEP_REQUIRED：计划已创建，写入、改代码和跑测试必须携带 planStepId。",
          `当前就绪步骤：${plan.readySteps().map((step) => step.id).join(",") || "无"}。`,
        ].join(" "),
      };
    }

    try {
      plan.ensureActive(stepId);
    } catch (error) {
      return {
        block: true,
        reason: [
          "PLAN_STEP_NOT_READY：本次调用未执行。",
          error instanceof Error ? error.message : String(error),
        ].join(" "),
      };
    }

    return {};
  }

  observeToolResult(context: AfterToolCallContext): void {
    if (context.isError) return;

    const args = context.args as Record<string, unknown>;
    if (context.toolCall.name === "read_file" && typeof args.path === "string") {
      this.state.evidence.readFiles.add(args.path);
    }
    if (context.toolCall.name === "write_file" && typeof args.path === "string") {
      this.state.evidence.writtenArtifacts.add(args.path);
    }

    // Runtime 产出的证据草稿，由计划层补全工具调用 ID 与代码版本。
    const details = context.result.details as
      | { evidence?: ToolEvidence }
      | undefined;
    const draft = details?.evidence;
    const stepId = args.planStepId;
    if (!draft || typeof stepId !== "string") return;

    this.deps.session.addEvidence({
      stepId,
      toolCallId: context.toolCall.id,
      artifactVersion: this.deps.getRevision(),
      kind: draft.kind,
      summary: draft.summary,
      payload: draft.payload,
    });
  }

  afterTurn(context: ShouldStopAfterTurnContext): boolean {
    if (this.state.stopCode) return true;

    if (this.state.turn >= this.state.maxTurns) {
      this.state.stopCode = "MAX_TURNS_EXCEEDED";
      return true;
    }

    if (context.toolResults.length === 0) {
      // 没有 Tool Call 只是协议层停止；业务层仍要验证交付证据。
      const missing = this.verifyCompletion();
      if (missing.length === 0) {
        this.state.stopCode = "COMPLETED";
        return true;
      }

      this.followUps.push({
        role: "user",
        content: [{
          type: "text",
          text: [
            "FINAL_REJECTED：完成证据不足。",
            ...missing.map((item) => `- ${item}`),
            "请继续使用工具补齐证据和交付物，不要只给出文字说明。",
          ].join("\n"),
        }],
        timestamp: Date.now(),
      });
    }

    return false;
  }

  drainFollowUps(): AgentMessage[] {
    return this.followUps.splice(0);
  }

  verifyCompletion(): string[] {
    return this.deps.contract.verify({
      plan: this.deps.session.snapshot(),
      evidence: this.deps.session.evidence.list(),
      revision: this.deps.getRevision(),
    });
  }

  private fingerprint(name: string, args: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(this.sortValue({ name, args })))
      .digest("hex");
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortValue(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.sortValue(item)]),
      );
    }
    return value;
  }
}
