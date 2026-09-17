// Run 级停止决策中心：只做四件事。
// 1) 第三次相同动作不执行；2) 达到最大轮数停止；
// 3) 从成功工具结果收集完成证据；4) 模型提前结束但证据不足时拒绝 Final 并以 Follow-up 继续。
// 边界：不调用模型、不执行工具、不访问文件系统、不实现 Planner/状态机/Checkpoint/Sandbox。
import { createHash, randomUUID } from "node:crypto";
import type {
  AfterToolCallContext,
  AgentMessage,
  BeforeToolCallContext,
  ShouldStopAfterTurnContext,
} from "@earendil-works/pi-agent-core";

import { TOOL_NAMES } from "./pi-tools.js";

// 全部停止原因。
export const StopReason = {
  COMPLETED: "COMPLETED",
  MAX_TURNS_EXCEEDED: "MAX_TURNS_EXCEEDED",
  REPEATED_ACTION: "REPEATED_ACTION",
  ABORTED: "ABORTED",
  MODEL_ERROR: "MODEL_ERROR",
} as const;
export type StopReason = (typeof StopReason)[keyof typeof StopReason];

// Follow-up 的稳定标识；缺失项逐条列出，便于把缺口回传给模型。
export const FINAL_REJECTED = "FINAL_REJECTED";
export const MIN_READ_FILES = 3;

// 同一动作出现到该次数即被阻止（第一次与第二次允许执行）。
const BLOCK_AT_COUNT = 3;

export interface Evidence {
  readFiles: Set<string>;
  writtenArtifacts: Set<string>;
}

export interface LoopState {
  // Run 唯一标识。
  runId: string;
  // 当前轮次（由装配层在 pi 的 turn_start 事件处递增）。
  turn: number;
  maxTurns: number;
  // 本次任务的交付物（来自 P1 执行上下文）。
  targetArtifact: string;
  // 停止原因；一旦设置不得被后续覆盖。
  stopReason?: StopReason;
  // 已执行动作（指纹）及其次数。
  actions: Map<string, number>;
  // 完成证据。
  evidence: Evidence;
}

export function createLoopState(
  maxTurns: number,
  targetArtifact: string,
  runId: string = randomUUID(),
): LoopState {
  return {
    runId,
    turn: 0,
    maxTurns,
    targetArtifact,
    actions: new Map(),
    evidence: {
      readFiles: new Set(),
      writtenArtifacts: new Set(),
    },
  };
}

export class LoopGuard {
  // 待注入的 Follow-up 消息；属于同一个 Run，注入时不重置轮次与动作计数。
  private followUps: AgentMessage[] = [];

  constructor(
    readonly state: LoopState,
  ) {}

  // 接入 pi 的 beforeToolCall：动作指纹去重，第三次相同动作在 Runtime handler 之前被阻止。
  beforeToolCall(
    context: BeforeToolCallContext,
  ): { block?: boolean; reason?: string } {
    const fingerprint = fingerprintOf(context.toolCall.name, context.args);
    // 每次工具执行前先累加计数。
    const count = (this.state.actions.get(fingerprint) ?? 0) + 1;
    this.state.actions.set(fingerprint, count);

    if (count >= BLOCK_AT_COUNT) {
      this.stop(StopReason.REPEATED_ACTION);
      return {
        block: true,
        reason: [
          `${StopReason.REPEATED_ACTION}：相同工具与参数已出现 ${count} 次。`,
          "本次调用未执行。",
        ].join(" "),
      };
    }

    return {};
  }

  // 接入 pi 的 afterToolCall：证据只能来自成功工具结果。
  observeToolResult(
    context: AfterToolCallContext,
  ): void {
    if (context.isError) return;

    const args = context.args as Record<string, unknown>;
    const path = typeof args.path === "string" ? args.path : undefined;
    if (path === undefined) return;

    if (context.toolCall.name === TOOL_NAMES.READ_FILE) {
      this.state.evidence.readFiles.add(path);
    }
    if (context.toolCall.name === TOOL_NAMES.WRITE_FILE) {
      this.state.evidence.writtenArtifacts.add(path);
    }
  }

  // 接入 pi 的 shouldStopAfterTurn：停止判定顺序不可调换。
  // 轮次由装配层在 pi 的 turn_start 事件处递增，本层只读取 state.turn。
  afterTurn(
    context: ShouldStopAfterTurnContext,
  ): boolean {
    // 1) 已存在停止原因 → 立即停止。
    if (this.state.stopReason) {
      return true;
    }

    // 2) 达到最大轮数 → 以最大轮数原因停止。
    if (this.state.turn >= this.state.maxTurns) {
      this.stop(StopReason.MAX_TURNS_EXCEEDED);
      return true;
    }

    // 3) 本轮无工具结果 = 模型只在协议层准备自然结束 → 执行完成校验。
    if (context.toolResults.length === 0) {
      const missing = this.verifyCompletion();
      if (missing.length === 0) {
        this.stop(StopReason.COMPLETED);
        return true;
      }
      this.followUps.push(this.buildFollowUp(missing));
    }

    // 4) 本轮有工具结果且未命中停止条件 → 允许继续。
    return false;
  }

  // 接入 pi 的 getFollowUpMessages。
  drainFollowUps(): AgentMessage[] {
    return this.followUps.splice(0);
  }

  // 外部事件（取消 / 模型错误）登记停止原因，同样遵守「一旦设置不覆盖」。
  markStop(reason: StopReason): void {
    this.stop(reason);
  }

  // 完成校验：返回缺失项列表（不是布尔值），便于把缺口回传给模型。
  verifyCompletion(): string[] {
    const missing: string[] = [];
    const { readFiles, writtenArtifacts } = this.state.evidence;

    if (readFiles.size < MIN_READ_FILES) {
      const lack = MIN_READ_FILES - readFiles.size;
      missing.push(
        `成功读取的源码文件不足：已 ${readFiles.size}/${MIN_READ_FILES} 个，还缺 ${lack} 个`,
      );
    }
    if (!writtenArtifacts.has(this.state.targetArtifact)) {
      missing.push(`尚未成功写入产物：${this.state.targetArtifact}`);
    }

    return missing;
  }

  private buildFollowUp(missing: string[]): AgentMessage {
    return {
      role: "user",
      content: [{
        type: "text",
        text: [
          `${FINAL_REJECTED}：完成证据不足。`,
          ...missing.map((item) => `- ${item}`),
          "请继续使用工具补齐证据与交付物。",
        ].join("\n"),
      }],
      timestamp: Date.now(),
    };
  }

  // 停止原因一旦设置，不得被后续覆盖为其它值。
  private stop(reason: StopReason): void {
    if (!this.state.stopReason) {
      this.state.stopReason = reason;
    }
  }
}

// 动作 = 工具名 + 规范化参数（递归排序对象字段）。
function fingerprintOf(name: string, args: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortValue({ name, args })))
    .digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
