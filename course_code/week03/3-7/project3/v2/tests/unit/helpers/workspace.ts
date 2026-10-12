import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { loadConfig, type PlatformConfig } from "../../../src/config.js";
import type { ExecutionContext } from "../../../src/domain.js";
import type { Platform } from "../../../src/platform.js";
import { PolicyEngine } from "../../../src/policy.js";
import { ToolRegistry } from "../../../src/registry.js";
import { applyTask, resolveTask } from "../../../src/tasks.js";
import { createRepoTools } from "../../../src/tools/index.js";
import { ToolRuntime, type InvocationResult } from "../../../src/runtime.js";
import { Sandbox } from "../../../src/sandbox.js";
import { PlatformStore } from "../../../src/store.js";

const BASE_CONFIG_PATH = "config/platform.yaml";

export interface WorkspaceHarness {
  config: PlatformConfig;
  platform: Platform;
  workspace: string;
  sandbox: Sandbox;
  store: PlatformStore;
  registry: ToolRegistry;
  policy: PolicyEngine;
  runtime: ToolRuntime;
  root: string;
  write(relativePath: string, content: string): string;
  read(relativePath: string): string;
  context(overrides?: Partial<ExecutionContext>): ExecutionContext;
  invoke(modelName: string, args: Record<string, unknown>, overrides?: Partial<ExecutionContext>): Promise<InvocationResult>;
  approveAndRun(modelName: string, args: Record<string, unknown>): Promise<InvocationResult>;
}

/**
 * 真实 config/platform.yaml + 临时工作区 + 临时 SQLite。
 * 策略名单、角色权限、工具白名单都取生产配置，测试不改 AC 也不改名单。
 */
export interface HarnessOptions {
  testCommand?: string[];
  maxCaptureBytes?: number;
  commandTimeoutMs?: number;
  /**
   * 领一类任务的活儿：把真实 config/tasks.yaml 也拷到临时 config 旁边，按任务条目覆盖默认值。
   * 工作区仍然钉在这个临时目录——任务里写的仓库路径不参与，否则单测会往样本仓库里写文件。
   */
  task?: string;
  goal?: string;
  /** 上下文窗口：最近几步逐字保留。测试用它把压缩触发点提前，几步的小脚本就能验收到摘要。 */
  keepRecentTurns?: number;
  /** 允许例外名单：给“命中禁写但放行”的用例用。 */
  allowWrite?: string[];
}

export function createWorkspaceHarness(options: HarnessOptions = {}): WorkspaceHarness {
  const root = mkdtempSync(join(tmpdir(), "pi-codebase-"));
  mkdirSync(join(root, "repo"), { recursive: true });
  // macOS 的 tmpdir 走 /var → /private/var 符号链接，取真实路径后再当工作区根，
  // 这样 Sandbox.root 与断言里用的路径是同一个字符串。
  const workspace = realpathSync(join(root, "repo"));

  const raw = parse(readFileSync(join(process.cwd(), BASE_CONFIG_PATH), "utf8")) as any;
  raw.sandbox.root = workspace;
  if (options.maxCaptureBytes !== undefined) raw.sandbox.max_capture_bytes = options.maxCaptureBytes;
  if (options.commandTimeoutMs !== undefined) raw.sandbox.command_timeout_ms = options.commandTimeoutMs;
  if (options.testCommand) raw.tools.test_command = options.testCommand;
  if (options.allowWrite) raw.sandbox.allow_write = options.allowWrite;
  if (options.keepRecentTurns !== undefined) {
    raw.runtime.context = { ...(raw.runtime.context ?? {}), keep_recent_turns: options.keepRecentTurns };
  }
  const configPath = join(root, "config", "platform.yaml");
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(configPath, stringify(raw), "utf8");
  // prompt.file 与 tasks.file 都相对配置文件解析，所以真实那两份也要落到临时 config 目录旁边；
  // tasks.yaml 里的 script 又是相对 config 目录的，整份 scripts 目录一起拷过来。
  copyFileSync(join(process.cwd(), "config", "prompts.yaml"), join(root, "config", "prompts.yaml"));
  copyFileSync(join(process.cwd(), "config", "tasks.yaml"), join(root, "config", "tasks.yaml"));
  cpSync(join(process.cwd(), "config", "scripts"), join(root, "config", "scripts"), { recursive: true });

  const loaded = loadConfig(configPath);
  const selected = resolveTask(loaded, { taskId: options.task, goal: options.goal });
  const config = selected ? applyTask(loaded, selected, workspace) : loaded;
  const sandbox = new Sandbox(config.sandbox);
  const store = new PlatformStore(config.runtime.database);
  const policy = new PolicyEngine(config.policy, sandbox, config.hitl.gate);
  const registry = new ToolRegistry();
  for (const tool of createRepoTools(config, sandbox)) registry.register(tool);
  const runtime = new ToolRuntime(registry, policy, store);

  const context = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
    traceId: randomUUID(),
    requestId: randomUUID(),
    userId: "trainer-1",
    tenantId: "tenant_a",
    roles: ["maintainer"],
    agentName: "codebase-agent",
    mode: "execute",
    ...overrides,
  });

  const invoke = (
    modelName: string,
    args: Record<string, unknown>,
    overrides: Partial<ExecutionContext> = {},
  ): Promise<InvocationResult> =>
    runtime.invoke({ context: context(overrides), toolCallId: randomUUID(), modelName, args });

  const write = (relativePath: string, content: string): string => {
    const absolutePath = join(workspace, relativePath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
    return absolutePath;
  };

  return {
    config,
    platform: { config, sandbox, store, registry, policy, runtime, async close() {} },
    workspace,
    sandbox,
    store,
    registry,
    policy,
    runtime,
    root,
    write,
    read: (relativePath) => readFileSync(join(workspace, relativePath), "utf8"),
    context,
    invoke,
    async approveAndRun(modelName, args) {
      const toolCallId = randomUUID();
      const pending = await runtime.invoke({ context: context(), toolCallId, modelName, args });
      if (!pending.approvalId) return pending;
      store.decideApproval(pending.approvalId, "approve", "manager-1");
      return await runtime.executeApproval(pending.approvalId, args);
    },
  };
}
