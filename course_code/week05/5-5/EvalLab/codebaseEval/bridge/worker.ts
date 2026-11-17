import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { buildPlatform, type Platform } from "../../codebase/src/platform.js";
import { runManagedAgent } from "../../codebase/src/pi/agent-runner.js";

export const CODEBASE = resolve(dirname(fileURLToPath(import.meta.url)), "../../codebase");
const { parse, stringify } = createRequire(join(CODEBASE, "package.json"))("yaml");
export const READ_TOOLS = ["list_files", "search_code", "read_file", "read_directory", "git_diff", "git_status"];

export interface BridgeInput {
  workspace: string;
  run_dir: string;
  task: { prompt: string; [key: string]: unknown };
  strategy: {
    id?: string;
    name?: string;
    system_prompt: string;
    model: string;
    base_url: string;
    api_key_env: string;
    rag_mode?: "off" | "keyword" | "bm25";
    top_k?: number;
    input_price?: number | null;
    output_price?: number | null;
    cache_price?: number | null;
  };
  mode: "live" | "offline";
  max_tokens: number;
  /** 秒，与父端进程超时一致。 */
  timeout: number;
}

type Observer = NonNullable<Parameters<typeof runManagedAgent>[1]["onEvent"]>;
type Event = Parameters<Observer>[0];
export interface ObservedMessage {
  usage: unknown;
  stopReason: string;
  errorMessage: string | null;
  model: string;
  provider: string;
  text: string;
}

export function messageOf(event: Event): ObservedMessage | undefined {
  if (event.type !== "message_end" || event.message.role !== "assistant") return;
  const message = event.message;
  return {
    usage: message.usage,
    stopReason: message.stopReason,
    errorMessage: message.errorMessage ?? null,
    model: message.model,
    provider: message.provider,
    text: message.content.filter((part) => part.type === "text").map((part) => part.text).join(""),
  };
}

function validate(input: BridgeInput): void {
  if (!input || !["live", "offline"].includes(input.mode)) throw new Error("INVALID_INPUT: mode 必须为 live/offline");
  for (const value of [input.workspace, input.run_dir, input.task?.prompt, input.strategy?.system_prompt,
    input.strategy?.model, input.strategy?.base_url, input.strategy?.api_key_env]) {
    if (typeof value !== "string" || !value.trim()) throw new Error("INVALID_INPUT: 缺少路径、任务或策略字段");
  }
  if (!Number.isSafeInteger(input.max_tokens) || input.max_tokens <= 0 ||
    !Number.isFinite(input.timeout) || input.timeout <= 0) throw new Error("INVALID_INPUT: 无效预算");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.strategy.api_key_env)) throw new Error("INVALID_INPUT: 无效凭据环境变量名");
  if (input.mode === "live" && !process.env[input.strategy.api_key_env]?.trim()) {
    throw new Error(`MODEL_UNAVAILABLE: ${input.strategy.api_key_env} 未设置；live 禁止降级`);
  }
}

export function prepareConfig(input: BridgeInput): string {
  validate(input);
  const raw = parse(readFileSync(join(CODEBASE, "config/platform.yaml"), "utf8"));
  const runDir = resolve(input.run_dir);
  mkdirSync(runDir, { recursive: true });
  // 每次创建新账本，即使调用方误用同一个 run_dir 也不串账。
  const configDir = mkdtempSync(join(runDir, "governance-"));
  raw.gateway = { ...raw.gateway, base_url: input.strategy.base_url, api_key_env: input.strategy.api_key_env,
    prompt_name: "eval.bridge", prompt_version: "v1" };
  raw.prompt = { source: "local", file: join(configDir, "prompts.yaml") };
  raw.model = { ...raw.model, id: input.strategy.model, name: input.strategy.model, max_tokens: input.max_tokens,
    input_per_million: input.strategy.input_price ?? 0,
    output_per_million: input.strategy.output_price ?? 0,
    cache_read_per_million: input.strategy.cache_price ?? 0 };
  raw.runtime = { ...raw.runtime, database: join(configDir, "platform.sqlite"),
    max_duration_ms: input.timeout * 1000 };
  raw.sandbox = { ...raw.sandbox, root: resolve(input.workspace), deny_write: ["**"], allow_write: [] };
  raw.policy = { role_permissions: { reviewer: ["repo:read", "git:read"] },
    agent_tool_allowlist: { "eval-bridge": READ_TOOLS } };
  raw.hitl = { ...raw.hitl, gate: "auto", mode: "disabled" };
  raw.memory = { ...raw.memory, enabled: false, bundle: join(configDir, "memory") };
  raw.rag = { ...raw.rag, enabled: false, dir: join(configDir, "rag") };
  raw.tasks = { file: join(configDir, "tasks.yaml") };
  raw.tools = { test_command: [] };
  writeFileSync(raw.tasks.file, stringify({ tasks: {} }));
  writeFileSync(raw.prompt.file, stringify({ prompts: { "eval.bridge": { versions: { v1: {
    required_variables: [],
    template: `${input.strategy.system_prompt}\n\n## 任务\n${input.task.prompt}`,
  } } } } }));
  const path = join(configDir, "platform.yaml");
  writeFileSync(path, stringify(raw));
  return path;
}

export async function runBridge(input: BridgeInput, emit: (event: unknown) => void = () => {}) {
  const messages: ObservedMessage[] = [];
  let platform: Platform | undefined;
  // loadConfig 的课堂环境覆盖不得覆盖本次策略和审批配置。
  const overrides = ["GATEWAY_BASE_URL", "GATEWAY_MODEL_ID", "HITL_MODE"];
  const saved = overrides.map((name) => process.env[name]);
  try {
    const configPath = prepareConfig(input);
    overrides.forEach((name) => delete process.env[name]);
    platform = await buildPlatform({ configPath, workspace: resolve(input.workspace) });
    emit({ type: "start", mode: input.mode, demo: input.mode === "offline" });
    const result = await runManagedAgent(platform, {
      prompt: input.task.prompt,
      userId: "eval-user",
      tenantId: "eval",
      roles: ["reviewer"],
      agentName: "eval-bridge",
      mode: "plan",
      decider: input.mode === "live" ? "real" : "mock",
      ...(input.mode === "offline" ? { script: [
        { tool_calls: [{ name: "read_file", args: { path: "src/policy.ts" } }] },
        { text: "离线脚本演示：已尝试通过真实 Runtime 读取 src/policy.ts，执行证据以 audit 为准。" +
          "本回答不是模型对任务的解答，不代表评测通过或真实模型成绩。" },
      ] } : {}),
      onDeciderSelected: (text) => emit({ type: "decider", text }),
      onEvent: (event) => {
        const message = messageOf(event);
        if (message) {
          messages.push(message);
          emit({ type: "message", ...message });
        } else if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
          emit({ type: event.type, tool_call_id: event.toolCallId, tool_name: event.toolName,
            ...(event.type === "tool_execution_end" ? { is_error: event.isError } : {}) });
        }
      },
    });
    if (input.mode === "live" && (result.decider.kind !== "gateway" || result.decider.degraded)) {
      throw new Error("DECIDER_DOWNGRADE: live 禁止降级");
    }
    return { type: "result", result, trace: platform.store.getTrace(result.trace_id),
      audit: platform.store.listAudit(result.trace_id), messages,
      execution_status: result.stop.code === "COMPLETED" &&
        !messages.some((message) => ["error", "aborted"].includes(message.stopReason)) ? "completed" : "error" };
  } catch (error) {
    return { type: "result", result: { final_answer: "", error: error instanceof Error ? error.message : String(error) },
      trace: platform?.store.listAudit().length ? tracesOf(platform) : [],
      audit: platform?.store.listAudit() ?? [], messages, execution_status: "error" };
  } finally {
    await platform?.close();
    overrides.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
}

function tracesOf(platform: Platform) {
  const ids = new Set(platform.store.listAudit().map((row) => String(row.trace_id)));
  return [...ids].flatMap((id) => platform.store.getTrace(id));
}

async function main() {
  const emit = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const input = JSON.parse(line) as BridgeInput;
      emit(await runBridge(input, emit));
      return;
    }
    throw new Error("INVALID_INPUT: stdin 缺少一行 JSON");
  } catch (error) {
    emit({ type: "result", result: { final_answer: "", error: String(error) },
      trace: [], audit: [], messages: [], execution_status: "error" });
  } finally {
    lines.close();
    process.stdin.pause();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
