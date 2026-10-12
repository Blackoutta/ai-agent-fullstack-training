import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import type { ContextRules } from "./context-budget.js";
import type { LoopBudgetConfig } from "./loop-guard.js";
import type { PolicyConfig } from "./domain.js";
import type { SandboxConfig } from "./sandbox.js";
import type { TaskConfig } from "./tasks.js";

export interface PlatformConfig {
  gateway: {
    baseUrl: string;
    apiKeyEnv: string;
    promptName: string;
    promptVersion: string;
  };
  /** source=gateway 走阶段一的 Prompt Registry；source=local 直接读同一份 prompts.yaml。 */
  prompt: { source: "gateway" | "local"; file: string };
  model: {
    providerId: string;
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion: number;
  };
  runtime: LoopBudgetConfig & { database: string };
  /** 上下文预算：渲染进模型的对话与写进审计的文本各自的上限，全在 src/context-budget.ts 里执行。 */
  context: ContextRules;
  /**
   * 审批工作流住在哪儿。
   * http：hitl/service.py 那张 LangGraph 图说了算（谁能批、能不能自批都在图上）。
   * disabled：回到阶段二行为，审批落在本地 SQLite，由 CLI 直接决定，一次 HTTP 都不发。
   */
  hitl: HitlConfig;
  policy: PolicyConfig;
  sandbox: SandboxConfig;
  tools: { testCommand: string[] };
  /** 任务知识住在 config/tasks.yaml；这里只记它的位置，读取全在 src/tasks.ts。 */
  tasks: { file: string };
  /** 这次运行领了哪一类任务的活儿。没领就是阶段二行为：仓库与测试命令都取 platform.yaml 的默认值。 */
  task?: TaskConfig;
}

/**
 * 门口开关（gate）：这一类任务里"要不要过人"。
 * mode=auto 时由工具自带的 requiresConfirmation 说了算；mode=none 一个都不拦（审计留 APPROVAL_GATE_OFF）；
 * tools 是追加名单：即使某个工具自带不需确认（例如 run_command），点名的这次也要过人。
 */
export interface ApprovalGate {
  mode: "auto" | "none";
  tools: string[];
}

export interface HitlConfig {
  /** 裁定开关（enabled 那一维）：批的人由谁裁定。disabled=本地 approvals 表说了算，http=LangGraph 那张图说了算。 */
  mode: "http" | "disabled";
  baseUrl: string;
  apiKeyEnv: string;
  /** 审批名单：哪些角色算数。够不够由图判（发起人和审批人都要落在这份名单里），运行时只负责把名单写进单子。 */
  approvers: string[];
  gate: ApprovalGate;
  /** 单次 HTTP 请求的超时。 */
  timeoutMs: number;
  /** pi 的 tool_call 门口最多等多久让人答复。超了这次调用作废，单子留在图上。 */
  waitTimeoutMs: number;
}

export function loadConfig(
  path = process.env.PLATFORM_CONFIG ?? "config/platform.yaml",
  workspace?: string,
): PlatformConfig {
  const absolutePath = resolve(path);
  const directory = dirname(absolutePath);
  const raw = parse(readFileSync(absolutePath, "utf8")) as any;
  return {
    gateway: {
      baseUrl: process.env.GATEWAY_BASE_URL ?? raw.gateway.base_url,
      apiKeyEnv: raw.gateway.api_key_env,
      promptName: raw.gateway.prompt_name,
      promptVersion: raw.gateway.prompt_version,
    },
    prompt: {
      source: raw.prompt?.source === "gateway" ? "gateway" : "local",
      file: resolve(directory, raw.prompt?.file ?? "prompts.yaml"),
    },
    model: {
      providerId: raw.model.provider_id,
      // 网关换地址时路由名通常也要跟着换（直连 DeepSeek 就得写它家的模型名），
      // 所以这个键和 GATEWAY_BASE_URL 一样支持环境变量覆盖：不写文件也能换真模型。
      id: process.env.GATEWAY_MODEL_ID ?? raw.model.id,
      name: raw.model.name,
      contextWindow: raw.model.context_window,
      maxTokens: raw.model.max_tokens,
      inputPerMillion: raw.model.input_per_million,
      outputPerMillion: raw.model.output_per_million,
      cacheReadPerMillion: raw.model.cache_read_per_million,
    },
    runtime: {
      database: resolve(directory, raw.runtime.database),
      maxTurns: raw.runtime.max_turns,
      maxToolCalls: raw.runtime.max_tool_calls,
      maxRepeatedCall: raw.runtime.max_repeated_call,
      maxTotalTokens: raw.runtime.max_total_tokens,
      maxCostUsd: raw.runtime.max_cost_usd,
      maxDurationMs: raw.runtime.max_duration_ms,
    },
    context: {
      // 最近这几步逐字留在上下文里，更早的压成一行摘要；审计入库则按行截断。
      keepRecentTurns: raw.runtime.context?.keep_recent_turns ?? 2,
      auditMaxLines: raw.runtime.context?.audit_max_lines ?? 40,
      auditMaxChars: raw.runtime.context?.audit_max_chars ?? 4_000,
    },
    hitl: {
      mode: hitlModeFromEnv() ?? (raw.hitl?.mode === "http" ? "http" : "disabled"),
      baseUrl: process.env.HITL_BASE_URL ?? raw.hitl?.base_url ?? "http://127.0.0.1:8383",
      apiKeyEnv: raw.hitl?.api_key_env ?? "HITL_API_KEY",
      approvers: parseApprovers(raw.hitl?.approvers),
      gate: parseGate(raw.hitl?.gate),
      timeoutMs: raw.hitl?.timeout_ms ?? 5000,
      waitTimeoutMs: raw.hitl?.wait_timeout_ms ?? 120_000,
    },
    policy: {
      rolePermissions: raw.policy.role_permissions,
      agentToolAllowlist: raw.policy.agent_tool_allowlist,
    },
    sandbox: {
      // 配置里的 root 跟着配置文件走；命令行传进来的 --dir 跟着当前目录走。
      root: workspace ? resolve(workspace) : resolve(directory, raw.sandbox.root),
      denyRead: raw.sandbox.deny_read ?? [],
      denyWrite: raw.sandbox.deny_write ?? [],
      // 允许例外：命中 deny_write 但落在这份名单里的路径放行（例如任务二只放开新增测试的目录）。
      allowWrite: raw.sandbox.allow_write ?? [],
      maxReadChars: raw.sandbox.max_read_chars ?? 12_000,
      maxOutputChars: raw.sandbox.max_output_chars ?? 12_000,
      maxCaptureBytes: raw.sandbox.max_capture_bytes ?? 4_194_304,
      commandTimeoutMs: raw.sandbox.command_timeout_ms ?? 20_000,
      killGraceMs: raw.sandbox.kill_grace_ms ?? 2_000,
      secretEnvPattern: raw.sandbox.secret_env_pattern ?? "(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)$",
    },
    tools: {
      // 测试命令从 P1 起是任务知识，写在 config/tasks.yaml 的任务条目里；
      // 这里只剩没有任务可领时的兜底。
      testCommand: raw.tools?.test_command ?? [],
    },
    tasks: { file: resolve(directory, raw.tasks?.file ?? "tasks.yaml") },
  };
}

/**
 * HITL_MODE 是给课堂和 CI 用的开关：同一条命令加个前缀就能在"问图"和"本地决定"之间切。
 * 抽成函数是因为任务条目也要读它一次——命令行那一层必须永远大过 tasks.yaml。
 */
export function hitlModeFromEnv(): HitlConfig["mode"] | undefined {
  if (process.env.HITL_MODE === "disabled") return "disabled";
  if (process.env.HITL_MODE === "http") return "http";
  return undefined;
}

/**
 * 门口开关的三种写法：auto（工具自带的确认要求说了算）、none（这一类任务一个人都不拦）、
 * 或者一份工具名单（点名的这些即使自带不需确认也要过人）。写错就炸在装配这一步，
 * 不炸的代价是"以为有人看着，其实一道门都没关"。
 */
export function parseGate(value: unknown): ApprovalGate {
  if (value === undefined || value === null || value === "auto") return { mode: "auto", tools: [] };
  if (value === "none") return { mode: "none", tools: [] };
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return { mode: "auto", tools: value as string[] };
  }
  throw new Error(`APPROVAL_GATE: gate 只能是 auto / none / 工具名单，收到 ${JSON.stringify(value)}`);
}

/** 审批名单。没写就是空名单：没人能批，图会在第一道门就把单子弹回（宁可开不了工，也不悄悄放开）。 */
export function parseApprovers(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value as string[];
  throw new Error(`APPROVAL_ROSTER: approvers 必须是角色名单，收到 ${JSON.stringify(value)}`);
}
