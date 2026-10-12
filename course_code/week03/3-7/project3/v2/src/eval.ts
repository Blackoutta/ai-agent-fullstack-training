import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import type { DeciderRequest } from "./pi/decider.js";
import { runManagedAgent } from "./pi/agent-runner.js";
import { buildPlatform } from "./platform.js";
import { loadTasks, type TaskConfig } from "./tasks.js";

/**
 * 评估执行器：依次跑每类任务，把"执行状态"与"验收结论"分开记账，最后落成两份报告。
 *
 * 三条纪律：
 *   1. 每次评估用独立工作副本与独立账本——上一趟修好的代码不能替下一趟背书。
 *   2. 待审批就是待审批：自动生成报告不等于自动批准，没写入的交付物不算通过。
 *   3. 报告只写证据：产物路径、审批次数、用量都取自审计与 Trace，不采信模型自述。
 */

/** 工作副本里不参与复制的目录：这些是依赖与历史产物，复制它们只会拖慢评估。 */
const SKIP_COPY = /(^|[\\/])(node_modules|\.git|dist|artifacts)([\\/]|$)/;

export interface EvalCase {
  /** 任务类型 id，与 config/tasks.yaml 的键一致。 */
  task: string;
  /** 交给 Agent 的一句话目标；不传就用任务条目自己的展示名。 */
  prompt?: string;
}

/** 归一化之后的评估用例：prompt 一定存在，runCase 才能直接用。 */
interface ResolvedEvalCase {
  task: string;
  prompt: string;
}

export interface EvalOutcome {
  task: string;
  display_name: string;
  run_id: string;
  decider: string;
  /** completed / awaiting_approval / stopped：执行状态，与验收结论分开看。 */
  status: string;
  stop_code: string;
  stop_reason: string;
  /** 交付物是否在审计里有账：这是验收结论，不是执行状态。 */
  accepted: boolean;
  deliverable_path: string | null;
  delivered: boolean;
  claim_without_evidence: boolean;
  tool_calls: number;
  approvals: number;
  tokens: number;
  cost_usd: number;
  elapsed_ms: number;
  /** 本次运行的账本与工作副本位置，供复核。 */
  evidence: { workspace: string; database: string; trace_id: string };
  uncovered: string[];
}

export interface EvalReport {
  generated_at: string;
  decider: string;
  outcomes: EvalOutcome[];
  uncovered: string[];
}

export interface EvalOptions {
  configPath?: string;
  /** 默认 mock（只准离线）：评估要可反复重跑，口径必须固定。 */
  decider?: DeciderRequest;
  /** 报告输出路径，默认 artifacts/eval_report.md；同目录另存一份 JSON。 */
  outFile?: string;
  /** 工作副本根目录，默认 v2 上一级的 .eval-runs。 */
  workRoot?: string;
  /** 想只跑一部分任务时传进来；默认跑 tasks.yaml 里的全部条目。 */
  cases?: EvalCase[];
}

export async function runEval(options: EvalOptions = {}): Promise<EvalReport> {
  const configPath = resolve(options.configPath ?? "config/platform.yaml");
  const configDir = dirname(configPath);
  const rawPlatform = parse(readFileSync(configPath, "utf8")) as Record<string, any>;
  const tasksFile = resolve(configDir, rawPlatform.tasks?.file ?? "tasks.yaml");
  const tasks = loadTasks(tasksFile);
  if (tasks.length === 0) throw new Error(`TASKS_FILE_EMPTY: ${tasksFile} 里没有可评估的任务类型`);

  const requested: EvalCase[] = options.cases ?? tasks.map((task) => ({ task: task.id }));
  const cases: ResolvedEvalCase[] = requested.map((entry) => ({
    task: entry.task,
    prompt: entry.prompt ?? tasks.find((task) => task.id === entry.task)?.displayName ?? entry.task,
  }));
  const decider: DeciderRequest = options.decider ?? "mock";
  const workRoot = options.workRoot ?? resolve(configDir, "..", "..", ".eval-runs");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(workRoot, { recursive: true });

  // 评估全程不依赖审批图：用工程既有的 HITL_MODE 开关退到本地表裁定（但绝不代人批准）。
  // 必须在任何 buildPlatform 之前设置：HITL 客户端是按装配时的口径创建的。
  const previousHitlMode = process.env.HITL_MODE;
  process.env.HITL_MODE = "disabled";
  const outcomes: EvalOutcome[] = [];
  try {
    for (const entry of cases) {
      outcomes.push(await runCase({ entry, tasks, rawPlatform, configPath, workRoot, stamp, decider }));
    }
  } finally {
    if (previousHitlMode === undefined) delete process.env.HITL_MODE;
    else process.env.HITL_MODE = previousHitlMode;
  }

  const report: EvalReport = {
    generated_at: new Date().toISOString(),
    decider,
    outcomes,
    // 汇总层面只保留跨任务都成立的结论；逐任务的待复核项写在各自条目里。
    uncovered: ["任务二的新增测试能力需单独验收：本报告只覆盖既有失败用例驱动的修复闭环"],
  };
  writeReports(report, options.outFile ?? resolve("artifacts/eval_report.md"));
  return report;
}

async function runCase(input: {
  entry: ResolvedEvalCase;
  tasks: TaskConfig[];
  rawPlatform: Record<string, any>;
  configPath: string;
  workRoot: string;
  stamp: string;
  decider: DeciderRequest;
}): Promise<EvalOutcome> {
  const task = input.tasks.find((item) => item.id === input.entry.task);
  if (!task) throw new Error(`TASK_TYPE_UNKNOWN: 配置里没有任务类型 ${input.entry.task}`);
  if (!task.workspace) throw new Error(`TASK_FIELD_MISSING: ${task.id} 没有 workspace，评估不知道该复制哪个样本`);

  const runRoot = join(input.workRoot, `${input.stamp}-${task.id}`);
  const repo = join(runRoot, "repo");
  const database = join(runRoot, "eval.db");
  cpSync(task.workspace, repo, { recursive: true, filter: (source) => !SKIP_COPY.test(source) });

  // 独立配置副本：只改工作区与账本两处，其余口径与生产一致。
  const configDir = dirname(input.configPath);
  const tmpConfigDir = join(runRoot, "config");
  mkdirSync(tmpConfigDir, { recursive: true });
  const raw = {
    ...input.rawPlatform,
    sandbox: { ...input.rawPlatform.sandbox, root: repo },
    runtime: { ...input.rawPlatform.runtime, database },
  };
  const tmpConfig = join(tmpConfigDir, "platform.yaml");
  writeFileSync(tmpConfig, stringify(raw), "utf8");
  copyFileSync(resolve(configDir, input.rawPlatform.prompt?.file ?? "prompts.yaml"), join(tmpConfigDir, "prompts.yaml"));
  copyFileSync(resolve(configDir, input.rawPlatform.tasks?.file ?? "tasks.yaml"), join(tmpConfigDir, "tasks.yaml"));
  cpSync(resolve(configDir, "scripts"), join(tmpConfigDir, "scripts"), { recursive: true });

  const platform = await buildPlatform({ configPath: tmpConfig, workspace: repo, task: task.id });
  // 审批口径由 runEval 统一退到本地表（HITL_MODE=disabled）：待审批的任务照实记为“待审批”。
  const result = await runManagedAgent(platform, {
    prompt: input.entry.prompt,
    userId: "eval-runner",
    tenantId: "eval",
    roles: ["maintainer"],
    mode: "execute",
    decider: input.decider,
  });

  const approvals = platform.store
    .getTrace(result.trace_id)
    .filter((event) => String(event.event_type) === "tool.approval_requested").length;
  const awaiting = Boolean(result.pending_approval_id);
  const status = awaiting ? "awaiting_approval" : result.stop.code === "COMPLETED" ? "completed" : "stopped";
  const uncovered = awaiting
    ? ["本轮停在审批：完成审批并执行获批操作后才能判定交付"]
    : result.deliverable.delivered
      ? []
      : ["交付物在审计里没有成功写入记录"];

  return {
    task: task.id,
    display_name: task.displayName,
    run_id: result.trace_id,
    decider: result.decider.label,
    status,
    stop_code: result.stop.code,
    stop_reason: result.stop.reason,
    accepted: result.deliverable.delivered,
    deliverable_path: result.deliverable.expected_path,
    delivered: result.deliverable.delivered,
    claim_without_evidence: result.deliverable.claim_without_evidence,
    tool_calls: result.budget.tool_calls,
    approvals,
    tokens: result.budget.total_tokens,
    cost_usd: result.budget.cost_usd,
    elapsed_ms: result.budget.elapsed_ms,
    evidence: { workspace: repo, database, trace_id: result.trace_id },
    uncovered,
  };
}

function writeReports(report: EvalReport, mdPath: string): void {
  mkdirSync(dirname(mdPath), { recursive: true });
  const jsonPath = mdPath.replace(/\.md$/, "") + ".json";
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, renderMarkdown(report), "utf8");
}

export function renderMarkdown(report: EvalReport): string {
  const header =
    "| 任务 | Run ID | 决策来源 | 执行状态 | 停止原因 | 验收结论 | 工具调用 | 审批 | 耗时(ms) | Token | 费用($) | 产物 |";
  const divider = "|---|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = report.outcomes.map((outcome) =>
    [
      outcome.display_name,
      outcome.run_id,
      outcome.decider,
      statusText(outcome.status),
      `${outcome.stop_code}：${outcome.stop_reason}`,
      outcome.accepted ? "交付物有账" : "未通过",
      String(outcome.tool_calls),
      String(outcome.approvals),
      String(outcome.elapsed_ms),
      String(outcome.tokens),
      outcome.cost_usd.toFixed(6),
      outcome.deliverable_path ?? "(未声明)",
    ]
      .map(escapeCell)
      .join(" | "),
  );
  return [
    "# 两类任务评估报告",
    "",
    `生成时间：${report.generated_at}　｜　决策口径：${report.decider}`,
    "",
    "执行状态回答“这一趟怎么结束的”，验收结论回答“交付物有没有账”——两者必须分开看。",
    "",
    header,
    divider,
    ...rows.map((row) => `| ${row} |`),
    "",
    "## 未覆盖与待复核",
    "",
    ...report.uncovered.map((item) => `- ${item}`),
    ...report.outcomes.flatMap((outcome) => outcome.uncovered.map((item) => `- ${outcome.display_name}：${item}`)),
    "",
    "## 复核路径",
    "",
    ...report.outcomes.map(
      (outcome) =>
        `- ${outcome.display_name}：工作副本 \`${outcome.evidence.workspace}\`，账本 \`${outcome.evidence.database}\`，` +
        `Trace \`${outcome.evidence.trace_id}\``,
    ),
    "",
  ].join("\n");
}

function statusText(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "awaiting_approval") return "待审批";
  return "已停止";
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
