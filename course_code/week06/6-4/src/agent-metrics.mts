/**
 * Agent 层指标：工具选得对吗、执行成功吗、检索命中了吗。
 *
 * 三个指标的分子分母口径各不相同，混用会算出错误结论：
 * - 工具调用准确率：分母是「已核对的工具调用」，即实际发生且有标注可对照的调用。
 * - 工具失败率：分母是「已结束的工具调用」，按 toolCallId 配对开始与结束事件。
 * - 检索命中率 Hit@3：分母是「成功返回且有标准证据的检索」，执行错误不计入。
 *
 * 同一次调用可以同时计入准确率（选对了）和失败率（执行失败）。
 * 例如 Agent 正确选择订单工具但接口超时：准确率算对，失败率算失败。
 */
import { Counter } from "prom-client";
import { backendRegistry as agentRegistry } from "./registry.mts";

/** 已核对的工具调用：每次实际发生且有标注的调用，按对错分别计数。 */
export const toolCallsCorrect = new Counter({
  name: "agent_tool_calls_correct_total",
  help: "工具与关键参数选择正确的调用累计数量",
  labelNames: ["workflow", "tool"],
  registers: [agentRegistry],
});

export const toolCallsChecked = new Counter({
  name: "agent_tool_calls_checked_total",
  help: "已核对（实际发生且有标注）的工具调用累计数量",
  labelNames: ["workflow", "tool"],
  registers: [agentRegistry],
});

/** 已结束的工具调用：按执行结果分别计数。 */
export const toolCallsFailed = new Counter({
  name: "agent_tool_calls_failed_total",
  help: "执行失败（抛错或返回错误）的工具调用累计数量",
  labelNames: ["workflow", "tool"],
  registers: [agentRegistry],
});

export const toolCallsFinished = new Counter({
  name: "agent_tool_calls_finished_total",
  help: "已结束（无论成功或失败）的工具调用累计数量",
  labelNames: ["workflow", "tool"],
  registers: [agentRegistry],
});

/** 检索：只在成功返回且有标准证据可核对时计入分母。 */
export const retrievalHits = new Counter({
  name: "agent_retrieval_hits_total",
  help: "目标资料出现在前三条候选里的检索累计数量",
  labelNames: ["workflow", "evidence"],
  registers: [agentRegistry],
});

export const retrievalChecked = new Counter({
  name: "agent_retrieval_checked_total",
  help: "成功返回且有标准证据可核对的检索累计数量",
  labelNames: ["workflow", "evidence"],
  registers: [agentRegistry],
});

export type CheckedToolCall = {
  workflow: string;
  /** 实际调用的工具名 */
  tool: string;
  /** 预先标注的期望工具名；无标注则不进入准确率分母 */
  expectedTool?: string;
  /** 关键参数是否与标注一致 */
  argsMatch?: boolean;
};

/**
 * 记录一次工具调用的「选择是否正确」。
 *
 * 只有存在标注的调用才计入分母，避免把无法核对的调用算成错误。
 */
export function recordToolChoice(call: CheckedToolCall): void {
  if (!call.expectedTool) return;
  toolCallsChecked.inc({ workflow: call.workflow, tool: call.expectedTool });
  const correct = call.tool === call.expectedTool && call.argsMatch !== false;
  if (correct) {
    toolCallsCorrect.inc({ workflow: call.workflow, tool: call.expectedTool });
  }
}

/** 记录一次工具调用的执行结果，按 toolCallId 在结束时调用。 */
export function recordToolExecution(
  workflow: string,
  tool: string,
  failed: boolean,
): void {
  toolCallsFinished.inc({ workflow, tool });
  if (failed) toolCallsFailed.inc({ workflow, tool });
}

/** 记录一次检索结果。仅在成功返回且有标准证据时调用。 */
export function recordRetrieval(
  workflow: string,
  evidenceId: string,
  candidates: string[],
): void {
  retrievalChecked.inc({ workflow, evidence: evidenceId });
  if (candidates.slice(0, 3).includes(evidenceId)) {
    retrievalHits.inc({ workflow, evidence: evidenceId });
  }
}
