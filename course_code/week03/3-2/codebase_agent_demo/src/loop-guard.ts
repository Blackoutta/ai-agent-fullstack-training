// 轮数、重复动作、完成验证、Follow-up。
import {
  createHash,
} from "node:crypto";
import type {
  AgentMessage,
  AfterToolCallContext,
  BeforeToolCallContext,
  ShouldStopAfterTurnContext,
} from "@earendil-works/pi-agent-core";

import type {
  CompletionContract,
  EvidenceRecord,
} from "./completion-contract.js";
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
  evidenceItems: EvidenceRecord[];
}

export interface LoopGuardDeps {
  contract: CompletionContract;
  /** 当前代码版本，用于把证据绑定到产生它的版本。 */
  getRevision: () => string;
}

export class LoopGuard {
  private followUps: AgentMessage[] = [];
  private evidenceSequence = 0;

  constructor(
    readonly state: LoopState,
    private readonly deps: LoopGuardDeps,
  ) {}

  beforeToolCall(
    context: BeforeToolCallContext,
  ): { block?: boolean; reason?: string } {
    const fingerprint = this.fingerprint(
      context.toolCall.name,
      context.args,
    );
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

    return {};
  }

  afterTurn(
    context: ShouldStopAfterTurnContext,
  ): boolean {
    if (this.state.stopCode) {
      return true;
    }

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
            ...missing.map(item => `- ${item}`),
            "请继续使用工具补齐证据和交付物。",
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

  observeToolResult(
    context: AfterToolCallContext,
  ): void {
    if (context.isError) return;

    const args = context.args as Record<string, unknown>;

    // 证据只在成功的工具结果进入 Context 后记录。
    if (context.toolCall.name === "read_file"
        && typeof args.path === "string") {
      this.state.evidence.readFiles.add(args.path);
    }

    if (context.toolCall.name === "write_file"
        && typeof args.path === "string") {
      this.state.evidence.writtenArtifacts.add(args.path);
    }

    // Runtime 产出的证据草稿，由 LoopGuard 补全工具调用 ID 与代码版本。
    const details = context.result.details as
      | { evidence?: ToolEvidence }
      | undefined;
    const draft = details?.evidence;
    if (!draft) return;

    this.state.evidenceItems.push({
      id: `ev-${++this.evidenceSequence}`,
      toolCallId: context.toolCall.id,
      artifactVersion: this.deps.getRevision(),
      kind: draft.kind,
      summary: draft.summary,
      payload: draft.payload,
    });
  }

  verifyCompletion(): string[] {
    return this.deps.contract.verify({
      evidence: this.state.evidenceItems,
      revision: this.deps.getRevision(),
    });
  }

  private fingerprint(
    name: string,
    args: unknown,
  ): string {
    return createHash("sha256")
      .update(JSON.stringify(
        this.sortValue({ name, args })
      ))
      .digest("hex");
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.sortValue(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) =>
            left.localeCompare(right)
          )
          .map(([key, item]) => [
            key,
            this.sortValue(item),
          ])
      );
    }
    return value;
  }
}
