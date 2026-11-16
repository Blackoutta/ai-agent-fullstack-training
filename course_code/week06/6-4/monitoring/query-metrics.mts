/**
 * 一次查完三层指标，用于核对看板口径。
 *
 * 运行：npm run prom:query
 *
 * 直接对 Prometheus 发 PromQL 查询并打印结果。窗口默认 5 分钟，
 * 可用 PROM_WINDOW=10m 覆盖。只做只读查询，不修改任何数据。
 */
const PROM_URL = process.env.PROM_URL ?? "http://127.0.0.1:9092";
const WINDOW = process.env.PROM_WINDOW ?? "5m";
const JOB = "order-backend";

type QuerySpec = { layer: string; name: string; expr: string; format: (v: number) => string };

const asPercent = (v: number) => `${(v * 100).toFixed(1)}%`;
const asMillis = (v: number) => `${(v * 1000).toFixed(0)} ms`;

const queries: QuerySpec[] = [
  {
    layer: "业务",
    name: "任务成功率",
    expr: `sum(increase(order_query_success_total{job="${JOB}"}[${WINDOW}])) / sum(increase(order_query_completed_total{job="${JOB}"}[${WINDOW}]))`,
    format: asPercent,
  },
  {
    layer: "业务",
    name: "人工接管率",
    expr: `sum(increase(order_query_handoff_total{job="${JOB}"}[${WINDOW}])) / sum(increase(order_query_completed_total{job="${JOB}"}[${WINDOW}]))`,
    format: asPercent,
  },
  {
    layer: "Agent",
    name: "工具调用准确率",
    expr: `sum(increase(agent_tool_calls_correct_total{job="${JOB}"}[${WINDOW}])) / sum(increase(agent_tool_calls_checked_total{job="${JOB}"}[${WINDOW}]))`,
    format: asPercent,
  },
  {
    layer: "Agent",
    name: "工具失败率",
    expr: `sum(increase(agent_tool_calls_failed_total{job="${JOB}"}[${WINDOW}])) / sum(increase(agent_tool_calls_finished_total{job="${JOB}"}[${WINDOW}]))`,
    format: asPercent,
  },
  {
    layer: "Agent",
    name: "检索命中率 Hit@3",
    expr: `sum(increase(agent_retrieval_hits_total{job="${JOB}"}[${WINDOW}])) / sum(increase(agent_retrieval_checked_total{job="${JOB}"}[${WINDOW}]))`,
    format: asPercent,
  },
  {
    layer: "模型",
    name: "平均延迟",
    expr: `sum(increase(agent_model_call_duration_seconds_sum{job="${JOB}"}[${WINDOW}])) / sum(increase(agent_model_call_duration_seconds_count{job="${JOB}"}[${WINDOW}]))`,
    format: asMillis,
  },
  {
    layer: "模型",
    name: "调用失败率",
    expr: `sum(increase(agent_model_calls_total{job="${JOB}",outcome="error"}[${WINDOW}])) / (sum(increase(agent_model_calls_total{job="${JOB}",outcome="success"}[${WINDOW}])) + sum(increase(agent_model_calls_total{job="${JOB}",outcome="error"}[${WINDOW}])))`,
    format: asPercent,
  },
  {
    layer: "模型",
    name: "P95 延迟",
    expr: `histogram_quantile(0.95, sum by (le) (rate(agent_model_call_duration_seconds_bucket{job="${JOB}"}[${WINDOW}])))`,
    format: asMillis,
  },
];

async function query(expr: string): Promise<number | string> {
  const url = `${PROM_URL}/api/v1/query?query=${encodeURIComponent(expr)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Prometheus 返回 HTTP ${response.status}`);
  const body = await response.json() as {
    status: string;
    error?: string;
    data?: { result: Array<{ value: [number, string] }> };
  };
  if (body.status !== "success") throw new Error(body.error ?? "查询失败");

  const result = body.data?.result ?? [];
  if (result.length === 0) return "无数据";
  const value = Number.parseFloat(result[0].value[1]);
  return Number.isFinite(value) ? value : "无数据";
}

async function main(): Promise<void> {
  console.log(`Prometheus: ${PROM_URL}`);
  console.log(`时间窗口: ${WINDOW}（可用 PROM_WINDOW 覆盖）\n`);

  let lastLayer = "";
  let failures = 0;

  for (const spec of queries) {
    if (spec.layer !== lastLayer) {
      console.log(`【${spec.layer}层】`);
      lastLayer = spec.layer;
    }
    try {
      const value = await query(spec.expr);
      const text = typeof value === "number" ? spec.format(value) : value;
      console.log(`  ${spec.name.padEnd(16)} ${text}`);
    } catch (error) {
      failures += 1;
      console.log(`  ${spec.name.padEnd(16)} 查询失败: ${String(error)}`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} 项查询失败。检查 Prometheus 是否运行：npm run prom:status`);
    process.exitCode = 1;
    return;
  }

  console.log("\n提示: 若显示「无数据」或 0，先确认 npm run demo:serve 正在运行且已跑过至少一轮。");
}

await main();
