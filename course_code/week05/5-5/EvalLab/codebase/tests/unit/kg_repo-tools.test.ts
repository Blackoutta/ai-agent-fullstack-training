import { describe, expect, it } from "vitest";
import type { WorkspaceHarness } from "./helpers/workspace.js";
import { createWorkspaceHarness } from "./helpers/workspace.js";

const PASS_COMMAND = ["node", "-e", "console.log('2 tests passed')"];

function opened(): WorkspaceHarness {
  const harness = createWorkspaceHarness({ testCommand: PASS_COMMAND });
  harness.write("src/routes/login.ts", "export function login(user: string) {\n  return user.length > 0;\n}\n");
  harness.write("src/routes/profile.ts", "export const profile = () => null;\n");
  harness.write("src/utils/token.ts", "const SECRET = 'abc';\nexport const sign = () => SECRET;\n");
  harness.write("node_modules/left-pad/index.js", "export const padded = true;\n");
  harness.write("dist/routes/login.js", "export function login(user) { return !!user; }\n");
  harness.write("README.md", "# demo\n\nlogin flow here\n");
  return harness;
}

describe("六件读工具", () => {
  it("list_files 递归匹配 glob，并跳过 node_modules 与 dist", async () => {
    const result = await opened().invoke("list_files", { pattern: "**/*.ts" });

    expect(result.code).toBe("OK");
    expect(String(result.content)).toContain("命中 3 个文件");
    expect(String(result.content)).toContain("src/routes/login.ts");
    expect(String(result.content)).not.toContain("node_modules");
    expect(String(result.content)).not.toContain("dist/");
  });

  it("search_code 输出 路径:行号: 内容，并支持字面量与大小写", async () => {
    const harness = opened();
    const regexp = await harness.invoke("search_code", { pattern: "export function login" });
    expect(String(regexp.content)).toContain("src/routes/login.ts:1: export function login(user: string) {");

    const literal = await harness.invoke("search_code", { pattern: "login(user: string)", literal: true });
    expect(String(literal.content)).toContain("命中 1 处");

    const caseInsensitive = await harness.invoke("search_code", { pattern: "PROFILE", ignoreCase: true });
    expect(String(caseInsensitive.content)).toContain("src/routes/profile.ts:1:");

    const scoped = await harness.invoke("search_code", { pattern: "login", path: "src/routes" });
    expect(String(scoped.content)).toContain("src/routes/login.ts");
    expect(String(scoped.content)).not.toContain("README.md");
  });

  // 契约先行（P2）之后，非法正则不再一路走到 handler：Runtime 门口就拦下来，
  // 于是错误码从执行层的 INVALID_PATTERN 变成契约层的 CONTRACT_PATTERN_NOT_REGEX。
  // 账上只有一条 policy_decision、没有 tool_execution，这一条就是"截得更早"的证据。
  it("search_code 的非法正则被契约层拦下，并给出两种改法", async () => {
    const harness = opened();
    const traceId = "trace-contract-regex";
    const result = await harness.invoke("search_code", { pattern: "([unclosed" }, { traceId });
    expect(result).toMatchObject({ ok: false, code: "CONTRACT_PATTERN_NOT_REGEX" });
    expect(String(result.content)).toContain("literal: true");
    expect(
      harness.store.listAudit(traceId).map((row) => `${String(row.event_type)}:${String(row.code)}`),
    ).toEqual(["policy_decision:CONTRACT_PATTERN_NOT_REGEX"]);
  });

  it("read_file 带行号，超限后给出续读 offset", async () => {
    const harness = opened();
    const whole = await harness.invoke("read_file", { path: "src/routes/login.ts" });
    expect(String(whole.content)).toContain("1| export function login(user: string) {");
    expect(String(whole.content)).toContain("已到文件末尾");

    const binary = harness.write("assets/logo.bin", "PK\u0000\u0000binary");
    const rejected = await harness.invoke("read_file", { path: harness.sandbox.relativeOf(binary) });
    expect(rejected.code).toBe("BINARY_FILE");

    const long = harness.write("src/long.ts", `${"x".repeat(400)}\n`.repeat(200));
    const relativeLong = harness.sandbox.relativeOf(long);
    const clipped = await harness.invoke("read_file", { path: relativeLong });
    const header = String(clipped.content).split("\n")[0];
    expect(header).toContain("续读用 offset=");

    const next = Number(header.match(/offset=(\d+)/)?.[1]);
    const resumed = await harness.invoke("read_file", { path: relativeLong, offset: next });
    expect(String(resumed.content)).toContain(`\n${next}| ${"x".repeat(400)}`);

    const oneLiner = harness.write("vendor/min.js", `${"z".repeat(30_000)}`);
    const atLeastOneLine = await harness.invoke("read_file", { path: harness.sandbox.relativeOf(oneLiner) });
    expect(String(atLeastOneLine.content)).toContain("显示 1-1 · 已到文件末尾");
  });

  it("read_directory 目录排在文件之前，目录名以 / 结尾", async () => {
    const harness = opened();
    const result = await harness.invoke("read_directory", {});
    const lines = String(result.content).split("\n");

    expect(lines[0]).toBe(". · 4 项");
    expect(lines.slice(1, 4)).toEqual(["dist/", "node_modules/", "src/"]);
    expect(lines[4]).toMatch(/^README\.md {2}\d+ B$/);

    const limited = await harness.invoke("read_directory", { limit: 2 });
    expect(String(limited.content)).toContain("· 只列出前 2 条");
  });

  it("未知参数与越权读取在触达文件系统前就被拒", async () => {
    const harness = opened();
    const invalid = await harness.invoke("read_file", { path: "README.md", encoding: "utf8" });
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });

    const outside = await harness.invoke("read_file", { path: "../README.md" });
    expect(outside).toMatchObject({ ok: false, code: "PATH_OUT_OF_WORKSPACE" });
  });
});

describe("两件写工具", () => {
  it("write_file 需要审批，批准后落盘，拒绝则不落盘", async () => {
    const harness = opened();
    const executed = await harness.approveAndRun("write_file", {
      path: "docs/notes.md",
      content: "# notes\n",
    });

    expect(executed.code).toBe("OK");
    expect(harness.read("docs/notes.md")).toBe("# notes\n");

    const denied = await harness.invoke("write_file", { path: "docs/x.md", content: "x" });
    harness.store.decideApproval(denied.approvalId!, "reject", "manager-1");
    const rejected = await harness.runtime.executeApproval(denied.approvalId!);
    expect(rejected.code).toBe("APPROVAL_NOT_EXECUTABLE");
    expect(harness.read("docs/notes.md")).toBe("# notes\n");
  });

  it("reviewer 缺 repo:write 与 plan 模式都在写之前拦下", async () => {
    const harness = opened();
    const readOnly = await harness.invoke(
      "write_file",
      { path: "a.md", content: "a" },
      { roles: ["reviewer"] },
    );
    expect(readOnly).toMatchObject({ ok: false, action: "deny", code: "RBAC_DENIED" });

    const planned = await harness.invoke(
      "write_file",
      { path: "a.md", content: "a" },
      { mode: "plan" },
    );
    expect(planned).toMatchObject({ ok: false, code: "PLAN_MODE_DENIED" });
  });

  it("apply_patch 段落按顺序生效并回吐 unified diff", async () => {
    const harness = opened();
    const executed = await harness.approveAndRun("apply_patch", {
      path: "src/routes/login.ts",
      edits: [
        { oldText: "user.length > 0", newText: "user.length >= 3" },
        { oldText: "export function login", newText: "export async function login" },
      ],
    });

    expect(String(executed.content)).toContain("已应用 2 段替换 src/routes/login.ts");
    expect(String(executed.content)).toContain("--- src/routes/login.ts");
    expect(harness.read("src/routes/login.ts")).toContain("export async function login(user: string)");
    expect(harness.read("src/routes/login.ts")).toContain("user.length >= 3");
  });

  it("apply_patch 命中 0 次或多次都整批拒绝，文件保持原样", async () => {
    const harness = opened();
    const missing = await harness.approveAndRun("apply_patch", {
      path: "src/routes/login.ts",
      edits: [
        { oldText: "export function login", newText: "export async function login" },
        { oldText: "不存在的文本", newText: "x" },
      ],
    });
    expect(missing.code).toBe("PATCH_CONTEXT_NOT_FOUND");
    expect(harness.read("src/routes/login.ts")).toContain("export function login");

    const ambiguous = await harness.approveAndRun("apply_patch", {
      path: "src/utils/token.ts",
      edits: [{ oldText: "SECRET", newText: "TOKEN" }],
    });
    expect(ambiguous.code).toBe("PATCH_AMBIGUOUS");
    expect(harness.read("src/utils/token.ts")).toContain("SECRET");
  });

  it("newText 里的 $& 不被当成正则引用展开", async () => {
    const harness = opened();
    await harness.approveAndRun("apply_patch", {
      path: "README.md",
      edits: [{ oldText: "# demo", newText: "# demo $& $1" }],
    });
    expect(harness.read("README.md").startsWith("# demo $& $1")).toBe(true);
  });
});

describe("四件执行工具", () => {
  it("run_test 直接执行配置好的命令，不需要审批", async () => {
    const result = await opened().invoke("run_test", {});

    expect(result.ok).toBe(true);
    expect(String(result.content)).toContain("退出码 0");
    expect(String(result.content)).toContain("2 tests passed");
  });

  // 追加给测试命令的是规范化后的相对路径：回显里不再出现本机绝对路径，
  // 同一条命令在谁的机器上跑都打印同一串字，讲稿里的转录才经得起复跑。
  it("run_test 带 test_file 时把校验过的相对路径追加给命令", async () => {
    const harness = opened();
    const command = harness.config.tools.testCommand.join(" ");
    const result = await harness.invoke("run_test", { test_file: "src/routes/login.ts" });

    expect(String(result.content)).toContain(`$ ${command} src/routes/login.ts`);
    expect(String(result.content)).not.toContain(harness.workspace);
  });

  it("run_test 未配置命令时报 TEST_COMMAND_MISSING", async () => {
    const harness = createWorkspaceHarness({ testCommand: [] });
    const result = await harness.invoke("run_test", {});
    expect(result).toMatchObject({ ok: false, code: "TEST_COMMAND_MISSING" });
  });

  it("测试失败保持 OK 返回，退出码由模型自己读", async () => {
    const harness = createWorkspaceHarness({
      testCommand: ["node", "-e", "console.error('expected true');process.exit(1)"],
    });
    const result = await harness.invoke("run_test", {});

    expect(result.ok).toBe(true);
    expect(String(result.content)).toContain("退出码 1");
    expect(String(result.content)).toContain("--- stderr ---");
  });

  it("run_command 走审批，reviewer 看不到执行权限", async () => {
    const harness = opened();
    const pending = await harness.invoke("run_command", { command: "echo hi" });
    expect(pending).toMatchObject({ ok: false, action: "confirm", code: "APPROVAL_REQUIRED" });

    const executed = await harness.approveAndRun("run_command", { command: "echo hi" });
    expect(String(executed.content)).toContain("$ /bin/sh -c echo hi · 退出码 0");
    expect(String(executed.content)).toContain("hi");

    const denied = await harness.invoke("run_command", { command: "echo hi" }, { roles: ["reviewer"] });
    expect(denied.code).toBe("RBAC_DENIED");
  });

  it("git_status 与 git_diff 反映工作区改动", async () => {
    const harness = opened();
    await initGit(harness);

    expect(String((await harness.invoke("git_status", {})).content)).toBe("工作区干净：没有任何改动");

    harness.write("src/routes/profile.ts", "export const profile = () => ({ name: 'x' });\n");
    const status = await harness.invoke("git_status", {});
    expect(String(status.content)).toContain("M src/routes/profile.ts");

    const diff = await harness.invoke("git_diff", { path: "src/routes/profile.ts" });
    expect(String(diff.content)).toContain("+export const profile = () => ({ name: 'x' });");

    const untracked = await harness.invoke("git_diff", { path: "README.md" });
    expect(String(untracked.content)).toBe("没有差异");
  });
});

async function initGit(harness: WorkspaceHarness): Promise<void> {
  await harness.sandbox.exec({ argv: ["git", "init", "-q"] });
  await harness.sandbox.exec({ argv: ["git", "add", "-A"] });
  await harness.sandbox.exec({
    argv: ["git", "-c", "user.email=trainer@example.com", "-c", "user.name=trainer", "commit", "-qm", "baseline"],
  });
}
