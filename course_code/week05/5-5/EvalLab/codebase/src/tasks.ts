import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { ApprovalGate, PlatformConfig } from "./config.js";
import { hitlModeFromEnv, parseApprovers, parseGate } from "./config.js";
import type { LoopBudgetConfig } from "./loop-guard.js";

/**
 * 一类任务的审批口径（P5）。三个字段都可以不写，不写就沿用 platform.yaml 的默认值：
 *   gate      这道门开不开：auto（工具自带要求说了算）/ none（一个人都不拦）/ 工具名单（点名的额外过人）
 *   via       批的人由谁裁定：local（本地 approvals 表）/ http（LangGraph 那张图）
 *   approvers 审批名单：哪些角色算数
 * 门口开关与裁定开关是正交的：关掉门口不代表放开审批，换成图也不代表门口就开着。
 */
export interface TaskApproval {
  gate?: ApprovalGate;
  via?: "local" | "http";
  approvers?: string[];
}

/**
 * 一类任务的全部知识。字段与 config/tasks.yaml 一一对应，
 * 这里是唯一的读取口：src 下别的地方都不许出现任务名，也不许自己解析那份 YAML。
 */
export interface TaskConfig {
  id: string;
  displayName: string;
  /** 一句话目标里出现任一关键词就路由到这一类。 */
  match: string[];
  /** 本类任务打开的仓库，已按 config 目录解析成绝对路径。 */
  workspace?: string;
  /** 离线决策脚本路径；接真实模型时留空。 */
  script?: string;
  brief: string;
  deliverable?: string;
  /** 缺省即"这类任务不跑测试"，run_test 会明确拒绝而不是回落到全局命令。 */
  testCommand?: string[];
  budget: Partial<LoopBudgetConfig>;
  denyWriteExtra: string[];
  /** 受控例外：命中禁写但落在这份名单里的路径放行，用来给“新增测试”这类写入开一个固定目录。 */
  allowWriteExtra: string[];
  approval: TaskApproval;
}

interface RawTask {
  display_name?: string;
  match?: string[];
  workspace?: string;
  script?: string;
  brief?: string;
  deliverable?: string;
  test_command?: string[];
  budget?: Record<string, number>;
  deny_write_extra?: string[];
  allow_write_extra?: string[];
  approval?: { gate?: unknown; via?: string; approvers?: string[] };
}

export function loadTasks(tasksFile: string): TaskConfig[] {
  if (!existsSync(tasksFile)) return [];
  const raw = parse(readFileSync(tasksFile, "utf8")) as { tasks?: Record<string, RawTask> };
  return Object.entries(raw.tasks ?? {}).map(([id, task]) => toTask(tasksFile, id, task));
}

function toTask(tasksFile: string, id: string, raw: RawTask): TaskConfig {
  if (!raw.display_name) throw new Error(`TASK_FIELD_MISSING: ${id} 缺 display_name（${tasksFile}）`);
  if (!raw.brief) throw new Error(`TASK_FIELD_MISSING: ${id} 缺 brief（${tasksFile}）`);
  if (!Array.isArray(raw.match) || raw.match.length === 0) {
    throw new Error(`TASK_FIELD_MISSING: ${id} 缺非空的 match 关键词表（${tasksFile}）`);
  }
  const directory = resolve(tasksFile, "..");
  return {
    id,
    displayName: raw.display_name,
    match: raw.match,
    workspace: raw.workspace ? resolve(directory, raw.workspace) : undefined,
    script: raw.script ? resolve(directory, raw.script) : undefined,
    brief: raw.brief,
    deliverable: raw.deliverable,
    testCommand: raw.test_command,
    budget: toBudget(id, raw.budget ?? {}),
    denyWriteExtra: raw.deny_write_extra ?? [],
    allowWriteExtra: raw.allow_write_extra ?? [],
    approval: toApproval(id, tasksFile, raw.approval),
  };
}

/** 任务条目里的 approval 段：没写的那几项保持 undefined，好让 platform.yaml 的默认值顶上。 */
function toApproval(id: string, tasksFile: string, raw?: RawTask["approval"]): TaskApproval {
  if (!raw) return {};
  if (raw.via !== undefined && raw.via !== "local" && raw.via !== "http") {
    throw new Error(`APPROVAL_VIA: ${id} 的 approval.via 只能是 local / http，收到 ${JSON.stringify(raw.via)}（${tasksFile}）`);
  }
  return {
    gate: raw.gate === undefined ? undefined : parseGate(raw.gate),
    via: raw.via,
    approvers: raw.approvers === undefined ? undefined : parseApprovers(raw.approvers),
  };
}

const BUDGET_KEYS: Record<string, keyof LoopBudgetConfig> = {
  max_turns: "maxTurns",
  max_tool_calls: "maxToolCalls",
  max_repeated_call: "maxRepeatedCall",
  max_total_tokens: "maxTotalTokens",
  max_cost_usd: "maxCostUsd",
  max_duration_ms: "maxDurationMs",
};

function toBudget(id: string, raw: Record<string, number>): Partial<LoopBudgetConfig> {
  const budget: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const target = BUDGET_KEYS[key];
    if (!target) throw new Error(`TASK_BUDGET_UNKNOWN: ${id} 的 budget 里有不认识的键 ${key}`);
    budget[target] = value;
  }
  return budget as Partial<LoopBudgetConfig>;
}

export function taskById(tasks: TaskConfig[], id: string): TaskConfig {
  const task = tasks.find((item) => item.id === id);
  if (!task) {
    throw new Error(`TASK_TYPE_UNKNOWN: 配置里没有任务类型 ${id}；已有 ${describeIds(tasks)}`);
  }
  return task;
}

/** 自上而下第一个命中的赢：这与决策规则序列同一条语义，顺序就是路由结果。 */
export function matchTask(tasks: TaskConfig[], goal: string): TaskConfig {
  const task = tasks.find((item) => item.match.some((keyword) => goal.includes(keyword)));
  if (!task) {
    throw new Error(
      `TASK_TYPE_UNMATCHED: 这句话没命中任何任务类型的关键词；已有 ${describeIds(tasks)}。` +
        `要接这类活儿，在 config/tasks.yaml 给对应条目加关键词，或者加一个新条目。`,
    );
  }
  return task;
}

/**
 * 选哪类任务：命令行点名 > 从目标里的关键词路由 > 不选。
 * 不选时返回 undefined，工程退回阶段二行为（platform.yaml 自己说打开哪个仓库、用什么测试命令），
 * 老的单测与命令因此不受影响。
 */
export function resolveTask(
  config: PlatformConfig,
  selector: { taskId?: string; goal?: string },
): TaskConfig | undefined {
  if (!selector.taskId && !selector.goal) return undefined;
  const tasks = loadTasks(config.tasks.file);
  if (tasks.length === 0) throw new Error(`TASKS_FILE_EMPTY: ${config.tasks.file} 里没有可用的任务类型`);
  return selector.taskId ? taskById(tasks, selector.taskId) : matchTask(tasks, selector.goal as string);
}

/**
 * 任务知识覆盖平台默认值：工作区、预算、测试命令、审批口径，外加把任务独有的红线追加进禁写名单、
 * 把受控例外追加进允许名单（deny_write 先封，allow_write 再开，后者只针对点名目录）。
 * 命令行显式给的 --dir 在最后再覆盖一次，所以优先级是
 * platform.yaml < tasks.yaml < 命令行。
 */
export function applyTask(config: PlatformConfig, task: TaskConfig, workspaceOverride?: string): PlatformConfig {
  return {
    ...config,
    task,
    sandbox: {
      ...config.sandbox,
      root: workspaceOverride ?? task.workspace ?? config.sandbox.root,
      denyWrite: [...config.sandbox.denyWrite, ...task.denyWriteExtra],
      allowWrite: [...(config.sandbox.allowWrite ?? []), ...task.allowWriteExtra],
    },
    runtime: { ...config.runtime, ...task.budget },
    tools: { testCommand: task.testCommand ?? [] },
    hitl: {
      ...config.hitl,
      gate: task.approval.gate ?? config.hitl.gate,
      approvers: task.approval.approvers ?? config.hitl.approvers,
      // 命令行/环境变量那一层始终最大：同一条命令加个 HITL_MODE=local 前缀就能脱离图跑，
      // 这是课堂与 CI 的逃生口，不能被任务条目反过来锁住。
      mode: hitlModeFromEnv() ?? (task.approval.via === undefined ? config.hitl.mode : task.approval.via === "http" ? "http" : "disabled"),
    },
  };
}

function describeIds(tasks: TaskConfig[]): string {
  return tasks.length === 0 ? "（一份配置都没读到）" : tasks.map((task) => task.id).join(" / ");
}
