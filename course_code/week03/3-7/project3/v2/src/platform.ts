import type { ExecutionContext } from "./domain.js";
import { resolve } from "node:path";
import { verifyContracts } from "./contract.js";
import { loadConfig, type PlatformConfig } from "./config.js";
import { PolicyEngine } from "./policy.js";
import { ToolRegistry } from "./registry.js";
import { Sandbox } from "./sandbox.js";
import { ToolRuntime } from "./runtime.js";
import { createHitlGateway } from "./hitl/client.js";
import { PlatformStore } from "./store.js";
import { createRepoTools } from "./tools/index.js";
import { applyTask, resolveTask } from "./tasks.js";

export interface Platform {
  config: PlatformConfig;
  sandbox: Sandbox;
  store: PlatformStore;
  registry: ToolRegistry;
  policy: PolicyEngine;
  runtime: ToolRuntime;
  close(): Promise<void>;
}

export interface BuildPlatformOptions {
  configPath?: string;
  workspace?: string;
  /** 点名要哪类任务；不给且给了 goal 时按关键词路由。两个都不给就是阶段二行为。 */
  task?: string;
  goal?: string;
}

export async function buildPlatform(options: BuildPlatformOptions = {}): Promise<Platform> {
  const loaded = loadConfig(options.configPath, options.workspace);
  const selected = resolveTask(loaded, { taskId: options.task, goal: options.goal });
  // 优先级：platform.yaml 的默认值 < 任务条目 < 命令行 --dir。
  const config = selected
    ? applyTask(loaded, selected, options.workspace ? resolve(options.workspace) : undefined)
    : loaded;
  const sandbox = new Sandbox(config.sandbox);
  const store = new PlatformStore(config.runtime.database);
  const policy = new PolicyEngine(config.policy, sandbox, config.hitl.gate);
  const registry = new ToolRegistry();
  for (const tool of createRepoTools(config, sandbox)) registry.register(tool);
  // 启动自检：契约本身有毛病（缺说明、缺上界、规则指向不存在的字段）就在装配这一步炸，
  // 而不是等模型跑到第 5 轮、被一条永远不生效的规则放过去之后才发现。
  const problems = verifyContracts(registry.list());
  if (problems.length > 0) {
    throw new Error(
      `CONTRACT_SELF_CHECK_FAILED: 工具契约自检未通过\n${problems.map((item) => `  - ${item}`).join("\n")}`,
    );
  }
  const runtime = new ToolRuntime(
    registry,
    policy,
    store,
    createHitlGateway(config.hitl),
    config.hitl.waitTimeoutMs,
    config.context,
  );
  return {
    config,
    sandbox,
    store,
    registry,
    policy,
    runtime,
    async close() {},
  };
}

export function executionContext(input: {
  userId: string;
  tenantId: string;
  roles: string[];
  agentName?: string;
  mode?: "plan" | "execute";
  traceId: string;
  requestId: string;
  workspace?: string;
}): ExecutionContext {
  return {
    traceId: input.traceId,
    requestId: input.requestId,
    userId: input.userId,
    tenantId: input.tenantId,
    roles: input.roles,
    agentName: input.agentName ?? "codebase-agent",
    mode: input.mode ?? "execute",
    workspace: input.workspace,
  };
}
