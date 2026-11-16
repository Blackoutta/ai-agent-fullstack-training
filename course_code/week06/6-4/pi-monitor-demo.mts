/**
 * 订单查询 Agent 监控演示（一条命令演示三层指标）。
 *
 * 每一轮依次跑两组样本，共同覆盖三层指标：
 *
 *   第一组：五条订单查询（业务层 + Agent 层）
 *     ok               通过验收                        → 业务成功率分子
 *     wrong-tool       模型调了退款工具，工具选错        → Agent 准确率分母、错误
 *     tool-timeout     选对工具但接口超时               → 准确率算对、失败率算失败、转人工
 *     retrieval-miss   检索正常但缺配送规则             → 检索命中率分母、未命中
 *     model-error      模型调用失败                     → 转人工
 *
 *   第二组：五次模型调用（模型层）
 *     100/200/300/400ms 正常返回，500ms 超时
 *
 * 每轮的预期结果：
 *   业务   任务成功率 1÷5 = 20%      人工接管率 2÷5 = 40%
 *   Agent  工具准确率 5÷6 ≈ 83.3%    工具失败率 1÷6 ≈ 16.7%    检索命中率 1÷2 = 50%
 *   模型   平均延迟 1.5s÷5 ≈ 300ms   调用失败率 1÷5 = 20%
 *
 * 运行：
 *   npm run demo                    # 跑一轮后保持 60 秒供 Prometheus 采集
 *   npm run demo:serve              # 常驻，每轮累加，配 Grafana 持续观察
 *
 * 三层指标共用 9464 端口和同一个 Registry，因此 Prometheus 只需一个
 * order-backend 采集任务，Grafana 三张卡片用同一个时间窗口。
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { HandoffQueue, settleQuery, type QueryOutcome } from "./src/business-metrics.mts";
import {
  recordRetrieval, recordToolChoice, recordToolExecution,
} from "./src/agent-metrics.mts";
import { ModelCallTimer, modelCallsTotal } from "./src/model-metrics.mts";
import type { ModelCallOutcome } from "./src/model-metrics.mts";
import { backendRegistry } from "./src/registry.mts";
import { METRICS_PORT, startMetricsServer, stopMetricsServer } from "./src/metrics-server.mts";

/* ------------------------------------------------------------------ *
 * 业务层 + Agent 层：五条订单查询
 * ------------------------------------------------------------------ */

const orderId = "A1001";
const goldDoc = "KB-SHIP-01";
const workflow = "pi-query-delivery";
const expected = { orderId, status: "SHIPPED", workdays: 2, evidenceId: goldDoc };

type ToolResult = { code: string; status?: string; candidates?: string[] };

/** 模拟业务工具：返回演示数据，必要时抛错模拟接口超时。 */
function callTool(name: string, args: { orderId: string }, scenario: string): ToolResult {
  switch (name) {
    case "get_order_status":
      if (scenario === "tool-timeout") throw new Error("ORDER_STATUS_TIMEOUT");
      if (args.orderId !== orderId) return { code: "NOT_FOUND" };
      return { code: "OK", status: "SHIPPED" };
    case "search_delivery_rules":
      return {
        code: "OK",
        candidates: scenario === "retrieval-miss"
          ? ["KB-RETURN-01", "KB-FAQ-01", "KB-PICKUP-01"]
          : [goldDoc, "KB-SHIP-02", "KB-FAQ-01"],
      };
    default:
      return { code: "UNKNOWN_TOOL" };
  }
}

/** 后端验收：核对物流状态和引用依据，全部匹配才算办成。 */
function verifyBusinessResult(status: string | undefined, candidates: string[]): boolean {
  return status === expected.status && candidates.slice(0, 3).includes(goldDoc);
}

type Scenario = {
  name: string;
  /** 模型依次选择的工具，模拟 Agent 的决策 */
  plan: string[];
  /** 预先标注的期望工具序列；没有标注的调用不进入准确率分母 */
  expectedPlan?: string[];
  modelError?: boolean;
};

const scenarios: Scenario[] = [
  {
    name: "ok",
    plan: ["get_order_status", "search_delivery_rules"],
    expectedPlan: ["get_order_status", "search_delivery_rules"],
  },
  {
    // 用户问物流，Agent 却调了退款接口：选择错误，但执行本身成功。
    name: "wrong-tool",
    plan: ["get_refund_status"],
    expectedPlan: ["get_order_status"],
  },
  {
    // 选对了工具和参数，但订单接口超时：准确率算对，失败率算失败。
    name: "tool-timeout",
    plan: ["get_order_status"],
    expectedPlan: ["get_order_status"],
  },
  {
    // 检索正常返回，但前三条里没有配送规则：进命中率分母，未命中。
    name: "retrieval-miss",
    plan: ["get_order_status", "search_delivery_rules"],
    expectedPlan: ["get_order_status", "search_delivery_rules"],
  },
  { name: "model-error", plan: [], modelError: true },
];

const handoffQueue = new HandoffQueue();

/**
 * 跑一条订单查询并结算业务指标。
 *
 * 结算规则：
 * - 验收通过 → 计入成功任务
 * - 接口超时或模型调用失败 → 尝试交给人工，队列确认接收才计入接管
 * - 选错工具、检索未命中 → 只计入已结束任务
 */
async function runQuery(scenario: Scenario): Promise<QueryOutcome & { taskId: string }> {
  const taskId = randomUUID();
  let status: string | undefined;
  let candidates: string[] = [];
  let upstreamUnavailable = false;

  if (scenario.modelError) {
    upstreamUnavailable = true;
  } else {
    for (const [index, tool] of scenario.plan.entries()) {
      // 工具开始事件：记录选择是否正确
      recordToolChoice({
        workflow,
        tool,
        expectedTool: scenario.expectedPlan?.[index],
        argsMatch: true,
      });

      // 工具结束事件：按 toolCallId 配对，记录成功或失败
      let failed = false;
      try {
        const result = callTool(tool, { orderId }, scenario.name);
        if (tool === "get_order_status" && result.status) status = result.status;
        if (tool === "search_delivery_rules" && result.candidates) {
          candidates = result.candidates;
          recordRetrieval(workflow, goldDoc, candidates);
        }
      } catch {
        failed = true;
        upstreamUnavailable = true;
      }

      recordToolExecution(workflow, tool, failed);
      if (failed) break;
    }
  }

  const success = !upstreamUnavailable && verifyBusinessResult(status, candidates);

  let takeover = false;
  if (!success && upstreamUnavailable) {
    takeover = await handoffQueue.enqueue(taskId, workflow);
  }

  const outcome: QueryOutcome = {
    success,
    takeover,
    outcome: success ? "completed" : takeover ? "handed_off" : "unconfirmed",
  };

  // 每条查询只在这里结算一次
  settleQuery(workflow, outcome);
  return { ...outcome, taskId };
}

/* ------------------------------------------------------------------ *
 * 模型层：五次模型调用
 * ------------------------------------------------------------------ */

const modelWorkflow = "pi-query-model";
const modelId = "scripted-query";

type Sample = { name: string; delayMs: number; outcome: ModelCallOutcome };

const samples: Sample[] = [
  { name: "model-100ms", delayMs: 100, outcome: "success" },
  { name: "model-200ms", delayMs: 200, outcome: "success" },
  { name: "model-300ms", delayMs: 300, outcome: "success" },
  { name: "model-400ms", delayMs: 400, outcome: "success" },
  { name: "model-500ms-timeout", delayMs: 500, outcome: "error" },
];

/**
 * 模拟一次模型调用。
 *
 * 真实实现里这里是 Pi 的流式调用：发起前开计时器，收到 done 或 error 时结束。
 * 演示用固定延迟复现同样的起止边界，因此超时前等待的 500 毫秒也会被计入。
 */
async function callModel(sample: Sample): Promise<number> {
  const timer = new ModelCallTimer(modelWorkflow, modelId);
  await sleep(sample.delayMs);
  return timer.finish(sample.outcome);
}

/* ------------------------------------------------------------------ *
 * 指标读取与输出
 * ------------------------------------------------------------------ */

async function counterValue(name: string): Promise<number> {
  const metric = backendRegistry.getSingleMetric(name);
  if (!metric) return 0;
  const snapshot = await metric.get();
  return snapshot.values.reduce((sum, item) => sum + item.value, 0);
}

async function modelStats(): Promise<{
  sum: number; count: number; success: number; error: number; cancelled: number;
}> {
  const snapshot = await modelCallsTotal.get();
  const byOutcome = new Map<string, number>();
  for (const item of snapshot.values) {
    const key = String(item.labels.outcome ?? "");
    byOutcome.set(key, (byOutcome.get(key) ?? 0) + item.value);
  }

  const metric = backendRegistry.getSingleMetric("agent_model_call_duration_seconds");
  let sum = 0;
  let count = 0;
  if (metric) {
    for (const item of (await metric.get()).values) {
      if (item.metricName.endsWith("_sum")) sum += item.value;
      if (item.metricName.endsWith("_count")) count += item.value;
    }
  }

  return {
    sum, count,
    success: byOutcome.get("success") ?? 0,
    error: byOutcome.get("error") ?? 0,
    cancelled: byOutcome.get("cancelled") ?? 0,
  };
}

const pct = (a: number, b: number) => (b === 0 ? "-" : `${((a / b) * 100).toFixed(1)}%`);

/** 跑一轮：先五条订单查询，再五次模型调用。 */
async function runRound(round: number, verbose: boolean): Promise<void> {
  console.log(`\n──────────── 第 ${round} 轮 ────────────`);

  // 业务层 + Agent 层
  const results = [];
  for (const scenario of scenarios) {
    const result = await runQuery(scenario);
    results.push(result);
    if (verbose) {
      console.log(
        `  ${scenario.name.padEnd(15)} success=${String(result.success).padEnd(5)} ` +
        `takeover=${String(result.takeover).padEnd(5)} ${result.outcome}`,
      );
    }
  }

  // 模型层
  const durations: number[] = [];
  for (const sample of samples) {
    const seconds = await callModel(sample);
    durations.push(seconds);
    if (verbose) {
      console.log(
        `  ${sample.name.padEnd(20)} outcome=${sample.outcome.padEnd(8)} ` +
        `${(seconds * 1000).toFixed(0)}ms`,
      );
    }
  }

  // 本轮增量
  const completed = results.length;
  const succeeded = results.filter((r) => r.success).length;
  const handedOff = results.filter((r) => r.takeover).length;
  const modelTotal = durations.reduce((sum, item) => sum + item, 0);
  const modelCounted = samples.filter((s) => s.outcome !== "cancelled").length;
  const modelErrors = samples.filter((s) => s.outcome === "error").length;

  console.log("\n  【业务层】");
  console.log(`  任务成功率   ${succeeded} ÷ ${completed} = ${pct(succeeded, completed)}`);
  console.log(`  人工接管率   ${handedOff} ÷ ${completed} = ${pct(handedOff, completed)}`);

  const checked = await counterValue("agent_tool_calls_checked_total");
  const correct = await counterValue("agent_tool_calls_correct_total");
  const finished = await counterValue("agent_tool_calls_finished_total");
  const failed = await counterValue("agent_tool_calls_failed_total");
  const retrieval = await counterValue("agent_retrieval_checked_total");
  const hits = await counterValue("agent_retrieval_hits_total");

  console.log("\n  【Agent 层】累计");
  console.log(`  工具调用准确率 ${correct} ÷ ${checked} = ${pct(correct, checked)}`);
  console.log(`  工具失败率     ${failed} ÷ ${finished} = ${pct(failed, finished)}`);
  console.log(`  检索命中率     ${hits} ÷ ${retrieval} = ${pct(hits, retrieval)}`);

  console.log("\n  【模型层】本轮");
  console.log(
    `  平均延迟     ${modelTotal.toFixed(2)} 秒 ÷ ${modelCounted} = ` +
    `${((modelTotal / modelCounted) * 1000).toFixed(0)} 毫秒`,
  );
  console.log(`  调用失败率   ${modelErrors} ÷ ${modelCounted} = ${pct(modelErrors, modelCounted)}`);
}

/** 单轮收尾：打印累计值并与预期核对。 */
async function printFinalSummary(): Promise<void> {
  const checked = await counterValue("agent_tool_calls_checked_total");
  const correct = await counterValue("agent_tool_calls_correct_total");
  const finished = await counterValue("agent_tool_calls_finished_total");
  const failed = await counterValue("agent_tool_calls_failed_total");
  const retrieval = await counterValue("agent_retrieval_checked_total");
  const hits = await counterValue("agent_retrieval_hits_total");
  const model = await modelStats();
  const modelCounted = model.success + model.error;

  console.log("\n=== 累计计数器 ===");
  console.log(`已核对工具调用 ${checked}，选对 ${correct}`);
  console.log(`已结束工具调用 ${finished}，失败 ${failed}`);
  console.log(`已核对检索 ${retrieval}，前三条命中 ${hits}`);
  console.log(
    `模型调用 success=${model.success} error=${model.error} cancelled=${model.cancelled}；` +
    `直方图 _sum=${model.sum.toFixed(3)} _count=${model.count}`,
  );

  const ok =
    checked === 6 && correct === 5 && finished === 6 && failed === 1 &&
    retrieval === 2 && hits === 1 &&
    model.success === 4 && model.error === 1 && model.count === 5;

  console.log(
    ok
      ? "\n✓ 三层计数均与口播稿预期一致"
      : "\n✗ 计数与预期不一致，请检查上面的采样数据",
  );
}

async function main(): Promise<void> {
  const serveMode = process.argv.includes("--serve");
  const server = await startMetricsServer();
  console.log(`指标端点已启动: http://127.0.0.1:${METRICS_PORT}/metrics`);

  if (serveMode) {
    const intervalSec = Number(process.env.DEMO_INTERVAL_SECONDS ?? 30);
    console.log(`常驻模式：每 ${intervalSec} 秒跑一轮，Ctrl+C 退出。`);
    console.log("先让 Prometheus 抓到初始值，再看 increase() 的窗口增量。");

    let round = 0;
    const tick = async () => {
      round += 1;
      await runRound(round, false);
    };

    await tick();
    const timer = setInterval(() => void tick(), intervalSec * 1000);

    const shutdown = async () => {
      clearInterval(timer);
      console.log("\n已停止。");
      await stopMetricsServer(server);
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await new Promise<never>(() => {});
  }

  console.log("\n本轮逐条样本：");
  await runRound(1, true);
  await printFinalSummary();

  console.log("\n端点保持 60 秒，方便 Prometheus 采集增量。");
  console.log("要让 Grafana 持续观察到变化，改用: npm run demo:serve");
  await sleep(60_000);
  await stopMetricsServer(server);
}

await main();
