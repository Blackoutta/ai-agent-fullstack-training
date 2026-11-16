/**
 * 模型层指标：一次模型调用要等多久，有多少次以错误结束。
 *
 * 关键口径：模型指标按「每一次模型调用」统计，不是按任务。
 * 一次订单查询可能调用模型三次（选订单工具、选检索工具、组织答案），
 * 这三层的分母因此互不相同：业务层按任务、Agent 层按工具调用、模型层按模型调用。
 *
 * 延迟包含了错误结束前的等待时间。超时样本等了 500 毫秒才失败，
 * 这 500 毫秒同样计入统计，因为它真实反映了用户等位的时间。
 */
import { Counter, Histogram } from "prom-client";
import { backendRegistry } from "./registry.mts";

/** 调用结果。cancelled 是用户主动取消，延迟和失败率都不统计这一类。 */
export type ModelCallOutcome = "success" | "error" | "cancelled";

/**
 * 每次模型调用的耗时，单位秒。
 *
 * 桶边界覆盖演示用的 100–500 毫秒，同时也能估算 P95 / P99：
 * 用 histogram_quantile() 读 _bucket 即可，不需要额外指标。
 */
export const modelCallDuration = new Histogram({
  name: "agent_model_call_duration_seconds",
  help: "模型调用从发起请求到结束（返回或报错）的耗时（秒）",
  labelNames: ["workflow", "model"],
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 5, 10],
  registers: [backendRegistry],
});

/** 按 outcome 记录每次模型调用的结果。 */
export const modelCallsTotal = new Counter({
  name: "agent_model_calls_total",
  help: "模型调用累计数量，按调用结果区分",
  labelNames: ["workflow", "model", "outcome"],
  registers: [backendRegistry],
});

/**
 * 记录一次已结束的模型调用。
 *
 * 正常返回和错误结束都写入 Histogram；用户主动取消只计数，不写延迟，
 * 因为取消的等待时长不代表模型服务的表现，混进来会拉低平均延迟。
 */
export function recordModelCall(params: {
  workflow: string;
  model: string;
  outcome: ModelCallOutcome;
  durationSeconds: number;
}): void {
  const { workflow, model, outcome, durationSeconds } = params;

  modelCallsTotal.inc({ workflow, model, outcome });

  if (outcome === "cancelled") return;

  modelCallDuration.observe({ workflow, model }, durationSeconds);
}

/**
 * 计时器：在发起调用前创建，在调用结束时调用 finish()。
 *
 * 用高精度单调时钟，避免系统时间被调整时把耗时算成负数。
 */
export class ModelCallTimer {
  private readonly startedAt = process.hrtime.bigint();
  private readonly workflow: string;
  private readonly model: string;

  constructor(workflow: string, model: string) {
    this.workflow = workflow;
    this.model = model;
  }

  /** 结束计时并记录。 */
  finish(outcome: ModelCallOutcome): number {
    const durationSeconds = Number(process.hrtime.bigint() - this.startedAt) / 1e9;
    recordModelCall({
      workflow: this.workflow,
      model: this.model,
      outcome,
      durationSeconds,
    });
    return durationSeconds;
  }
}

/** 把模型返回的 stopReason 映射成三类结果。 */
export function toOutcome(stopReason: string): ModelCallOutcome {
  if (stopReason === "error") return "error";
  if (stopReason === "aborted") return "cancelled";
  return "success";
}
