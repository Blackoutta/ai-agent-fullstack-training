#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { buildPlatform, executionContext, type Platform } from "./platform.js";
import { renderContract } from "./contract.js";
import type { InvocationResult } from "./runtime.js";
import { runManagedAgent } from "./pi/agent-runner.js";
import { runEval } from "./eval.js";
import { createHitlGateway } from "./hitl/client.js";
import { loadTasks } from "./tasks.js";

const program = new Command();
program.name("codebase-agent").description("pi 0.87.1 Codebase Agent 工具运行时 CLI").version("2.0.0");
program.option("--config <path>", "平台配置文件", process.env.PLATFORM_CONFIG ?? "config/platform.yaml");
program.option("--dir <path>", "本次打开的仓库目录，覆盖 tasks.yaml 的 workspace 与 platform.yaml 的 sandbox.root");

program
  .command("tools")
  .description("发现并列出模型当前可见的工具")
  .action(async () => {
    await withPlatform(async (platform) => {
      const context = defaultContext(platform);
      print(platform.registry.snapshot(context, platform.policy).map((tool) => ({
        internal_name: tool.metadata.internalName,
        model_name: tool.modelName,
        risk: tool.metadata.risk,
        source: tool.metadata.source,
        requires_confirmation: tool.metadata.requiresConfirmation,
      })));
    });
  });

program
  .command("contract")
  .description("把模型的视角摊开：每件工具的字段、取值边界与语义规则，先对契约再谈实现")
  .option("--model-name <name>", "只看这一件工具，例如 read_file")
  .action(async (options) => {
    await withPlatform(async (platform) => {
      const context = defaultContext(platform);
      const visible = platform.registry.snapshot(context, platform.policy);
      const picked = options.modelName
        ? visible.filter((tool) => tool.metadata.internalName === options.modelName)
        : visible;
      if (picked.length === 0) throw new Error(`没有名为 ${options.modelName} 的可见工具，用 tools 命令看清单`);
      print(renderContract(picked));
      process.stdout.write(`共 ${picked.length} 件工具。这份清单就是模型收到的说明书：它能看见的只有这些。\n`);
    });
  });

program
  .command("tasks")
  .description("列出 config/tasks.yaml 里的任务类型：谁领活儿、领了之后打开哪个仓库")
  .action(async () => {
    await withPlatform(async (platform) => {
      print(loadTasks(platform.config.tasks.file).map((task) => ({
        id: task.id,
        display_name: task.displayName,
        match: task.match,
        workspace: task.workspace,
        script: task.script,
        deliverable: task.deliverable,
        test_command: task.testCommand ?? [],
        budget: task.budget,
        deny_write_extra: task.denyWriteExtra,
        allow_write_extra: task.allowWriteExtra,
        approval: {
          // 两个正交开关加一份名单，一眼能看出这类任务"过不过人、谁来裁定、谁能批"。
          gate: task.approval.gate ?? platform.config.hitl.gate,
          via: task.approval.via ?? (platform.config.hitl.mode === "http" ? "http" : "local"),
          approvers: task.approval.approvers ?? platform.config.hitl.approvers,
        },
      })));
    });
  });

program
  .command("agent")
  .description("运行受治理的 pi Agent Loop")
  .argument("<prompt>", "一句话目标：默认按 config/tasks.yaml 的关键词路由到一类任务")
  .option("--task <id>", "点名任务类型，跳过关键词路由")
  .option("--no-route", "不领任务，回到阶段二行为（仓库与测试命令取 platform.yaml）")
  .option("--user-id <id>", "用户 ID", "trainer-1")
  .option("--tenant-id <id>", "租户 ID", "tenant_a")
  .option("--roles <roles>", "逗号分隔角色", "maintainer")
  .option("--mode <mode>", "plan 或 execute", "execute")
  .option("--script <path>", "离线决策脚本 YAML，给了它就盖掉任务条目里配的那份")
  .option("--decider <mode>", "决策口径：real（默认，直连 DeepSeek；没设 DEEPSEEK_API_KEY 时按任务脚本降级并说破）/ auto（有离线脚本就离线）/ mock（只准离线）", "real")
  .action(async (prompt, options) => {
    await withPlatform(
      async (platform) => {
        const routing = describeRouting(platform);
        if (routing) process.stdout.write(`${routing}\n`);
        const result = await runManagedAgent(platform, {
          prompt,
          userId: options.userId,
          tenantId: options.tenantId,
          roles: splitList(options.roles),
          mode: options.mode,
          scriptPath: options.script,
          decider: options.decider,
          onText: (delta) => process.stdout.write(delta),
          onDeciderSelected: (line) => process.stdout.write(`${line}\n`),
          onDeciderStep: (line) => process.stdout.write(`\n${line}\n`),
          onDeliverable: (line) => process.stdout.write(`\n${line}\n`),
        });
        process.stdout.write("\n");
        print(result);
      },
      { task: options.task, goal: options.route === false || options.task ? undefined : prompt },
    );
  });

const approvals = program.command("approvals").description("查看与处理持久化审批");

/**
 * 审批这几条命令也必须能领同一类任务：口径（门口/裁定/名单）是按任务类型分的，
 * 答复那张单时如果不带 --task，问的就不是同一个审批人名单，等在那头的运行永远等不到。
 */
const taskOption = (command: Command) =>
  command.option("--task <id>", "按点名任务类型的审批口径（门口、裁定人、名单都来自它）");

taskOption(
  approvals
    .command("list")
    .option("--status <status>", "按状态过滤", "pending"),
).action(async (options) => {
  await withPlatform(async (platform) => print(platform.store.listApprovals(options.status)), { task: options.task });
});
taskOption(
  approvals
    .command("tickets")
    .description("列出审批图那边的工单（hitl.mode=http 才有内容）"),
).action(async (options) => {
  await withPlatform(async (platform) => {
    if (!platform.config.hitl.mode.startsWith("http")) {
      process.stdout.write("当前是本地审批模式：审批落在 approvals 表里，图那侧没有工单。\n");
      return;
    }
    print(await createHitlGateway(platform.config.hitl).listTickets());
  }, { task: options.task });
});
taskOption(
  approvals
    .command("decide")
    .argument("<approval-id>")
    .requiredOption("--decision <decision>", "approve 或 reject")
    .option("--actor <actor>", "审批人", process.env.USER ?? "operator")
    .option("--roles <roles>", "审批人持有的角色，逗号分隔", "maintainer")
    .option("--feedback <text>", "给人看的批注", ""),
).action(async (id, options) => {
  if (options.decision !== "approve" && options.decision !== "reject") {
    throw new Error("--decision 只能是 approve 或 reject");
  }
  await withPlatform(async (platform) => {
    if (!platform.config.hitl.mode.startsWith("http")) {
      print(platform.store.decideApproval(id, options.decision, options.actor));
      return;
    }
    // 挂在图上时，"能不能批"由图判：这里只把它的答复抄回本地那张执行授权单。
    const verdict = await createHitlGateway(platform.config.hitl).decide(id, {
      action: options.decision,
      actor: options.actor,
      roles: splitList(options.roles),
      feedback: options.feedback,
    });
    print(verdict);
    if (verdict.status === "approved") {
      process.stdout.write(`图已批准。本地这张单可以用：approvals execute ${id}\n`);
    }
  }, { task: options.task });
});
taskOption(
  approvals
    .command("execute")
    .argument("<approval-id>"),
).action(async (id, options) => {
  await withPlatform(async (platform) => printInvocation(await platform.runtime.executeApproval(id)), { task: options.task });
});

program
  .command("audit")
  .description("查看审计记录")
  .option("--trace-id <id>")
  .action(async (options) => {
    await withPlatform(async (platform) => print(platform.store.listAudit(options.traceId)));
  });

program
  .command("trace")
  .description("查看一次 Agent Run 的 Trace")
  .argument("<trace-id>")
  .action(async (traceId) => {
    await withPlatform(async (platform) => print(platform.store.getTrace(traceId)));
  });

program
  .command("eval")
  .description("依次跑各类任务，汇总成可复核的评估报告（默认离线；待审批不计为完成）")
  .option("--case <task...>", "只评估点名的任务类型，可给多个")
  .option("--decider <mode>", "决策口径：mock（默认，只准离线）/ auto / real", "mock")
  .option("--out <path>", "Markdown 报告路径（同目录另存 JSON）", "artifacts/eval_report.md")
  .action(async (options) => {
    const report = await runEval({
      decider: options.decider,
      outFile: options.out,
      cases: options.case?.length ? options.case.map((task: string) => ({ task })) : undefined,
    });
    print(report);
  });

program
  .command("invoke")
  .description("绕过模型但不绕过 Runtime，便于确定性验收")
  .argument("<model-tool-name>")
  .argument("<json-args>")
  .option("--task <id>", "按点名任务类型的口径跑（工作区、测试命令、禁写名单都来自它）")
  .action(async (modelName, rawArgs, options) => {
    await withPlatform(async (platform) => {
      const routing = describeRouting(platform);
      if (routing) process.stdout.write(`${routing}\n`);
      const context = defaultContext(platform);
      const result = await platform.runtime.invoke({
        context,
        toolCallId: randomUUID(),
        modelName,
        args: parseObject(rawArgs),
      });
      printInvocation(result, context.traceId);
      process.stdout.write(`用 audit --trace-id ${context.traceId} 看这次调用的审计与 Trace\n`);
    }, { task: options.task });
  });

// 配置写错、任务名点错这类错误要念得出来，不要把 Node 的未捕获堆栈甩给人：
// 第一行就是错什么、下一步改哪儿。
await program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function defaultContext(platform?: Platform) {
  return executionContext({
    traceId: randomUUID(),
    requestId: randomUUID(),
    userId: "trainer-1",
    tenantId: "tenant_a",
    roles: ["maintainer"],
    workspace: platform?.config.sandbox.root,
  });
}

async function withPlatform(
  work: (platform: Platform) => Promise<void>,
  taskSelector: { task?: string; goal?: string } = {},
) {
  const { config, dir } = program.opts();
  const platform = await buildPlatform({ configPath: config, workspace: dir, ...taskSelector });
  try {
    await work(platform);
  } finally {
    await platform.close();
  }
}

/** 领了任务就把这次的口径念一遍：仓库、交付物、审批三件（门口/裁定/名单）都是任务条目说了算。 */
function describeRouting(platform: Platform): string | undefined {
  const task = platform.config.task;
  if (!task) return undefined;
  const hitl = platform.config.hitl;
  const gate = hitl.gate.mode === "none" ? "none" : hitl.gate.tools.length > 0 ? `[${hitl.gate.tools.join(", ")}]` : "auto";
  return (
    `任务类型=${task.id}（${task.displayName}） · 仓库=${platform.config.sandbox.root}` +
    ` · 交付物=${task.deliverable ?? "未声明"}` +
    ` · 审批门口=${gate} · 由谁裁定=${hitl.mode === "http" ? "LangGraph 图" : "本地表"}` +
    ` · 名单=${hitl.approvers.join(", ") || "(空)"}`
  );
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("参数必须是 JSON 对象");
  return parsed;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printInvocation(result: InvocationResult, traceId?: string): void {
  const approval = result.approvalId ? ` · approval=${result.approvalId}` : "";
  const header = `${result.ok ? "OK" : result.action} · ${result.code}${approval}${traceId ? ` · trace=${traceId}` : ""}`;
  const body = typeof result.content === "string" ? result.content : JSON.stringify(result.content, null, 2);
  process.stdout.write(`${header}\n${body}\n`);
}
