import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderSystemPrompt } from "../../src/pi/prompt-client.js";
import { runManagedAgent } from "../../src/pi/agent-runner.js";
import { loadConfig } from "../../src/config.js";
import { applyTask, loadTasks, matchTask, resolveTask, taskById } from "../../src/tasks.js";
import { createWorkspaceHarness } from "./helpers/workspace.js";

const TASKS_FILE = "config/tasks.yaml";
const CONFIG_FILE = "config/platform.yaml";

function tasks() {
  return loadTasks(TASKS_FILE);
}

function auditCodes(harness: ReturnType<typeof createWorkspaceHarness>, traceId: string): string[] {
  return harness.store
    .listAudit(traceId)
    .map((row) => `${String(row.event_type)}:${String(row.tool_name)}:${String(row.code)}`);
}

describe("P1 任务知识进配置", () => {
  it("AC-1 一句话目标路由到任务类型，任务条目覆盖平台默认值", () => {
    const config = loadConfig(CONFIG_FILE);
    const goal = "帮我找出该项目的登录逻辑，并生成 Markdown 说明文档";

    const task = resolveTask(config, { goal })!;
    expect(task.id).toBe("understand");

    const merged = applyTask(config, task);
    // 打开哪个仓库、预算多少、测试命令是什么、谁来批：以前散在四个文件里，现在一个条目说了算。
    expect(merged.sandbox.root.endsWith(join("samples", "1_login_demo"))).toBe(true);
    expect(merged.runtime.maxTurns).toBe(task.budget.maxTurns);
    expect(merged.tools.testCommand).toEqual([]);
    expect(merged.hitl.approvers).toEqual(task.approval.approvers);
    expect(merged.hitl.gate).toEqual({ mode: "auto", tools: [] });
    expect(merged.task?.id).toBe("understand");

    // 命令行显式给的目录优先于任务条目：评估器换样本时不必改配置。
    expect(applyTask(config, task, "/tmp/other-repo").sandbox.root).toBe("/tmp/other-repo");
  });

  it("受控例外跟着任务走：deny_write_extra 封片，allow_write_extra 单点放开", () => {
    const config = loadConfig(CONFIG_FILE);
    const merged = applyTask(config, taskById(tasks(), "fix_tests"));
    // 平台默认没有允许例外：不领任务时行为与之前完全一致。
    expect(config.sandbox.allowWrite).toEqual([]);
    expect(merged.sandbox.denyWrite).toEqual(expect.arrayContaining(["tests/**"]));
    expect(merged.sandbox.allowWrite).toEqual(["tests/generated/**"]);
  });

  it("AC-2 配置里没有的目标与没配的类型都直接报错，不默默兜底", () => {
    const loaded = tasks();
    expect(() => matchTask(loaded, "帮我做一件配置里没有的事")).toThrow(/TASK_TYPE_UNMATCHED/);
    expect(() => taskById(loaded, "no_such_task")).toThrow(/TASK_TYPE_UNKNOWN/);
    // 报错信息里要带已有类型：不带上，人就只会去翻代码，配置化就没有意义。
    expect(() => matchTask(loaded, "帮我做一件配置里没有的事")).toThrow(/understand/);
    expect(() => taskById(loaded, "no_such_task")).toThrow(/debt_audit/);
  });

  it("AC-3 debt_audit 只存在于配置里：src 不提它，它却能带着自己的脚本跑完一整轮", async () => {
    const sourceFiles: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith(".ts")) sourceFiles.push(readFileSync(path, "utf8"));
      }
    };
    walk("src");
    const allSource = sourceFiles.join("\n");
    // 新增一类任务的全部痕迹：只有 tasks.yaml 的一个条目加一份决策脚本。
    for (const id of ["understand", "fix_tests", "debt_audit"]) expect(allSource).not.toContain(id);

    const harness = createWorkspaceHarness({ task: "debt_audit" });
    harness.write("src/utils/password.ts", "// Demo-only password check\nexport const x = 1;\n");
    const report = join(harness.workspace, "docs", "tech-debt-audit.md");

    const result = await runManagedAgent(harness.platform, {
      prompt: "给这个仓库做一次技术债巡检",
      userId: "trainer-1",
      tenantId: "tenant_a",
      roles: ["maintainer"],
    });

    // 没传 --script：决策器用的就是任务条目里配的那份脚本。
    expect(result.task).toBe("debt_audit");
    expect(result.decider.kind).toBe("scripted");
    // 记账里的脚本只留文件名：整条绝对路径每台机器都不一样，转录对不上账。
    expect(result.decider.label).toBe("mock:debt-audit.yaml");
    expect(result.stop.code).toBe("COMPLETED");
    // 这一类的审批口径是 gate: none，所以"跑完一整轮"里没有任何人工环节：
    // 报告在这一次运行里就落到了盘上，而不是停在一张等人批的单子上。
    expect(existsSync(report)).toBe(true);
    expect(harness.read("docs/tech-debt-audit.md")).toContain("技术债巡检报告");
    expect(auditCodes(harness, result.trace_id)).toEqual(
      expect.arrayContaining([
        "tool_execution:search_code:OK",
        "tool_execution:read_file:OK",
        // 没人看过这件事本身有账：门口关掉是一条独立的 policy_decision。
        "policy_decision:write_file:APPROVAL_GATE_OFF",
        "tool_execution:write_file:OK",
      ]),
    );
    expect(result.pending_approval_id).toBeUndefined();
    expect(harness.store.listApprovals("pending")).toHaveLength(0);
  });

  it("AC-4 任务没声明 test_command 时，run_test 明确拒绝而不是回落到全局命令", async () => {
    const harness = createWorkspaceHarness({ task: "understand", testCommand: ["node", "-e", "process.exit(0)"] });
    expect(harness.config.tools.testCommand).toEqual([]);

    const result = await harness.invoke("run_test", {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe("TEST_COMMAND_MISSING");
    expect(String(result.content)).toContain("任务类型 understand 未声明 test_command");
  });

  it("AC-5 任务级红线与简报都到位：改测试被沙箱拦下，交付口径进了模型收到的那段话", async () => {
    const harness = createWorkspaceHarness({ task: "fix_tests" });
    // 这条命令来自 fix_tests 的 test_command，不来自 platform.yaml。
    expect(harness.config.tools.testCommand).toEqual(["npm", "test", "--"]);
    expect(harness.config.sandbox.denyWrite).toContain("tests/**");

    const denied = await harness.invoke("write_file", { path: "tests/session-boundary.test.ts", content: "改松断言\n" });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("PATH_DENY_WRITE");

    const allowed = await harness.invoke("write_file", { path: "src/auth/note.md", content: "# 说明\n" });
    expect(allowed.code).toBe("APPROVAL_REQUIRED");

    const bundle = await renderSystemPrompt(harness.config, harness.context());
    expect(bundle.prompt).toContain("任务类型：fix_tests");
    expect(bundle.prompt).toContain("src/auth/session-policy.ts");
    expect(bundle.prompt).toContain("run_test 的退出码为唯一验收标准");

    // 没领任务时这一段回落成通用文案，阶段二那条路不受影响。
    const plain = createWorkspaceHarness();
    expect(plain.config.task).toBeUndefined();
    const plainBundle = await renderSystemPrompt(plain.config, plain.context());
    expect(plainBundle.prompt).toContain("任务类型：未指定");
    expect(plainBundle.prompt).toContain("交付路径与结构要求");
  });
});

describe("P5 审批口径按任务类型分置", () => {
  const byId = (id: string) => taskById(tasks(), id);
  const base = () => loadConfig(CONFIG_FILE);

  it("AC-6 三类任务各自的门口、裁定人、名单互不相同，且都来自配置", () => {
    const understand = applyTask(base(), byId("understand"));
    const fix = applyTask(base(), byId("fix_tests"));
    const debt = applyTask(base(), byId("debt_audit"));

    // 门口（要不要过人）：auto / 追加名单 / 关掉，三种写法各占一类。
    expect(understand.hitl.gate).toEqual({ mode: "auto", tools: [] });
    expect(fix.hitl.gate).toEqual({ mode: "auto", tools: ["run_test"] });
    expect(debt.hitl.gate).toEqual({ mode: "none", tools: [] });

    // 裁定（谁说了算）：任务二交给 LangGraph 那张图，另外两类留在本地表。
    expect(understand.hitl.mode).toBe("disabled");
    expect(fix.hitl.mode).toBe("http");
    expect(debt.hitl.mode).toBe("disabled");

    // 名单（谁批算数）：够不够由图判，运行时只负责把它写进单子。
    expect(understand.hitl.approvers).toEqual(["maintainer"]);
    expect(fix.hitl.approvers).toEqual(["maintainer", "tech_lead"]);
  });

  it("AC-7 gate=none：写文件不等人了，但审计单独留一条说破这次没人看过", async () => {
    const harness = createWorkspaceHarness({ task: "debt_audit" });
    const traceId = "trace-gate-off";
    const result = await harness.invoke(
      "write_file",
      { path: "docs/tech-debt-audit.md", content: "# 巡检\n" },
      { traceId },
    );

    expect(result.ok).toBe(true);
    expect(harness.read("docs/tech-debt-audit.md")).toContain("# 巡检");
    // 放行不等于无痕：门口关掉这件事本身要能翻出来。
    expect(auditCodes(harness, traceId)).toEqual(
      expect.arrayContaining(["policy_decision:write_file:APPROVAL_GATE_OFF"]),
    );
    expect(harness.store.listApprovals("pending")).toHaveLength(0);
  });

  it("AC-8 gate 点名的工具：run_test 自带不需确认，任务二里仍要过人", async () => {
    const harness = createWorkspaceHarness({ task: "fix_tests", testCommand: ["node", "-e", "process.exit(0)"] });
    const gated = await harness.invoke("run_test", {});
    expect(gated.code).toBe("APPROVAL_REQUIRED");
    // 理由要说清是任务条目的点名，不是工具自带的要求——否则读的人会以为改错了地方。
    expect(String(gated.content)).toContain("本类任务把这件工具点名进了审批门口");

    // 同一件 run_test，换一份没点名的配置就照旧直接执行：门口是任务级的，不是工具级的。
    const plain = createWorkspaceHarness({ testCommand: ["node", "-e", "process.exit(0)"] });
    const open = await plain.invoke("run_test", {});
    expect(open.ok).toBe(true);
    expect(open.code).toBe("OK");
  });

  it("AC-9 门口与裁定是正交的两维：via 只换裁定人，不动门口；命令行那一层最大", () => {
    const config = base();
    const fix = byId("fix_tests");

    // 只盖 via：门口与名单都回落到 platform.yaml 的默认值，一点没被顺手改宽。
    const viaOnly = applyTask(config, { ...fix, approval: { via: "http" } });
    expect(viaOnly.hitl.mode).toBe("http");
    expect(viaOnly.hitl.gate).toEqual(config.hitl.gate);
    expect(viaOnly.hitl.approvers).toEqual(config.hitl.approvers);

    // 只盖 gate：裁定人还是 platform.yaml 那位，门口关了也没换成图。
    const gateOnly = applyTask(config, { ...fix, approval: { gate: { mode: "none", tools: [] } } });
    expect(gateOnly.hitl.mode).toBe(config.hitl.mode);
    expect(gateOnly.hitl.gate).toEqual({ mode: "none", tools: [] });

    // 环境变量这一层大过任务条目：图没起来时同一条命令加前缀就能退到本地表，
    // 但退的只是裁定人，门口名单照旧按任务条目说的算。
    process.env.HITL_MODE = "disabled";
    try {
      const escaped = applyTask(config, fix);
      expect(escaped.hitl.mode).toBe("disabled");
      expect(escaped.hitl.gate).toEqual({ mode: "auto", tools: ["run_test"] });
    } finally {
      delete process.env.HITL_MODE;
    }
  });

  it("AC-10 审批口径写错就炸在装配这一步，不留下以为有人看着的配置", () => {
    const root = mkdtempSync(join(tmpdir(), "kg-approval-"));
    const file = join(root, "tasks.yaml");
    const write = (approval: string) =>
      writeFileSync(file, `tasks:\n  fix_tests:\n    display_name: T\n    brief: B\n    match: [x]\n${approval}`, "utf8");

    write("    approval:\n      gate: sometimes");
    expect(() => loadTasks(file)).toThrow(/APPROVAL_GATE/);
    write("    approval:\n      via: carrier-pigeon");
    expect(() => loadTasks(file)).toThrow(/APPROVAL_VIA/);
    write("    approval:\n      approvers: maintainer");
    expect(() => loadTasks(file)).toThrow(/APPROVAL_ROSTER/);

    // 没写 approvers 是空名单而不是默认角色：失败关闭，宁可开不了工，也不悄悄放开。
    write("    approval:\n      gate: none");
    const task = loadTasks(file)[0]!;
    expect(task.approval.approvers).toBeUndefined();
    expect(applyTask(base(), task).hitl.approvers).toEqual(base().hitl.approvers);
    expect(applyTask(base(), { ...task, approval: { ...task.approval, approvers: [] } }).hitl.approvers).toEqual([]);
  });
});
