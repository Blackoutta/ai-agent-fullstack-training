/**
 * 业务层指标：订单查询的任务成功与人工接管。
 *
 * 口径说明（与口播稿一致）：
 * - order_query_completed_total：一条有效订单查询进入终态时加一。
 * - order_query_success_total：这条查询通过业务验收时加一。
 * - order_query_handoff_total：人工队列确认接收这条查询时加一。
 *
 * 一次订单查询可能调用多个工具，但业务层只按「一个任务」结算一次，
 * 因此这三个计数器的分母始终是任务数，而不是工具调用次数。
 */
import { Counter, Histogram } from "prom-client";
import { backendRegistry as registry } from "./registry.mts";

export const completedTotal = new Counter({
  name: "order_query_completed_total",
  help: "有效订单查询进入终态的累计数量",
  labelNames: ["workflow"],
  registers: [registry],
});

export const successTotal = new Counter({
  name: "order_query_success_total",
  help: "通过业务验收的订单查询累计数量",
  labelNames: ["workflow"],
  registers: [registry],
});

export const handoffTotal = new Counter({
  name: "order_query_handoff_total",
  help: "人工队列确认接收的订单查询累计数量",
  labelNames: ["workflow"],
  registers: [registry],
});

/**
 * 人工接管请求到受理的耗时。接管率看的是「有没有被收下」，
 * 这个直方图回答的是「排队等了多久」，用于区分积压和拒绝两种情形。
 */
export const handoffAcceptLatency = new Histogram({
  name: "order_query_handoff_accept_seconds",
  help: "人工接管请求从入队到队列确认受理的耗时（秒）",
  labelNames: ["workflow"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export type QueryOutcome = {
  /** 是否通过业务验收 */
  success: boolean;
  /** 人工队列是否确认接收 */
  takeover: boolean;
  /** 终态描述，用于日志和 Trace 输出 */
  outcome: "completed" | "handed_off" | "unconfirmed";
};

/**
 * 一次订单查询的结算入口。
 *
 * 无论成功、接管还是「无法确认」，都只在这里结算一次，
 * 保证已结束任务数与实际任务数一一对应。
 */
export function settleQuery(workflow: string, outcome: QueryOutcome): void {
  completedTotal.inc({ workflow });
  if (outcome.success) successTotal.inc({ workflow });
  if (outcome.takeover) handoffTotal.inc({ workflow });
}

/**
 * 人工接管队列（演示用内存实现）。
 *
 * 只有队列确认收下任务，才计入 handoff_total。
 * 这与「尝试交接」区分开：入队了但队列拒收，不算接管。
 */
export class HandoffQueue {
  private readonly pending = new Set<string>();

  /** 尝试把任务交给人工。返回队列是否确认接收。 */
  async enqueue(taskId: string, workflow: string): Promise<boolean> {
    const startedAt = process.hrtime.bigint();
    // 演示里用内存 Set 模拟受理，真实系统这里是队列的 ack。
    this.pending.add(taskId);
    const accepted = this.pending.has(taskId);
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e9;
    handoffAcceptLatency.observe({ workflow }, elapsed);
    return accepted;
  }

  /** 人工处理完成后移出队列。 */
  resolve(taskId: string): void {
    this.pending.delete(taskId);
  }

  get size(): number {
    return this.pending.size;
  }
}
