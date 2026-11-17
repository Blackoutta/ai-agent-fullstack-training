import { randomUUID } from "node:crypto";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRuntimeError } from "../../src/domain.js";
import type { HarnessOptions, WorkspaceHarness } from "./helpers/workspace.js";
import { createWorkspaceHarness } from "./helpers/workspace.js";

function opened(options: HarnessOptions = {}): WorkspaceHarness {
  const harness = createWorkspaceHarness(options);
  harness.write("src/login.ts", "export const login = () => true;\n");
  harness.write("package.json", '{ "name": "demo" }\n');
  harness.write(".env", "DEEPSEEK_API_KEY=should-never-be-read\n");
  return harness;
}

describe("Sandbox 三条边界检查", () => {
  it("拒绝工作区之外的相对路径与绝对路径", () => {
    const sandbox = opened().sandbox;
    expect(sandbox.inspect("../../etc/passwd")?.code).toBe("PATH_OUT_OF_WORKSPACE");
    expect(sandbox.inspect("/etc/passwd")?.code).toBe("PATH_OUT_OF_WORKSPACE");
    expect(sandbox.inspect("./src/../src/login.ts")).toBeUndefined();
  });

  it("符号链接指向工作区外时按真实路径判定", () => {
    const outer = createWorkspaceHarness();
    outer.write("outside/secret.txt", "leak\n");
    const inner = opened();
    symlinkSync(join(outer.workspace, "outside"), join(inner.workspace, "link"), "dir");

    expect(inner.sandbox.inspect("link/secret.txt")?.code).toBe("PATH_OUT_OF_WORKSPACE");
    expect(() => inner.sandbox.check("link/secret.txt")).toThrowError(ToolRuntimeError);
  });

  it("deny_read 拦读写两侧，deny_write 只拦写", () => {
    const sandbox = opened().sandbox;
    expect(sandbox.inspect(".env")?.code).toBe("PATH_DENY_READ");
    expect(sandbox.inspect("src/keys/tls.key", { write: true })?.code).toBe("PATH_DENY_READ");
    expect(sandbox.inspect("package.json")).toBeUndefined();
    expect(sandbox.inspect("package.json", { write: true })?.code).toBe("PATH_DENY_WRITE");
    expect(sandbox.inspect("node_modules/left-pad/index.js", { write: true })?.code).toBe("PATH_DENY_WRITE");
  });

  it("allow_write 在 deny_write 上开受控口子：只放行点名的目录", () => {
    // 任务二的口径：整片 tests/ 封死，单点放开 tests/generated/。
    const sandbox = createWorkspaceHarness({ task: "fix_tests" }).sandbox;
    expect(sandbox.inspect("tests/session-policy.test.ts", { write: true })?.code).toBe("PATH_DENY_WRITE");
    expect(sandbox.inspect("tests/generated/new.test.ts", { write: true })).toBeUndefined();
    // 口子只对点名目录有效：平台级的禁写名单不受影响。
    expect(sandbox.inspect(".git/config", { write: true })?.code).toBe("PATH_DENY_WRITE");
  });

  it("越界在工具层被拒，并留下带错误码的审计记录", async () => {
    const harness = opened();
    const context = harness.context();
    const result = await harness.runtime.invoke({
      context,
      toolCallId: randomUUID(),
      modelName: "read_file",
      args: { path: ".env" },
    });

    expect(result).toMatchObject({ ok: false, action: "deny", code: "PATH_DENY_READ" });
    const audit = harness.store.listAudit(context.traceId);
    expect(JSON.stringify(audit)).toContain("PATH_DENY_READ");
    expect(JSON.stringify(audit)).not.toContain("should-never-be-read");
  });
});

describe("Sandbox 子进程隔离", () => {
  it("密钥类环境变量不进子进程", () => {
    process.env.SANDBOX_TEST_TOKEN = "must-not-leak";
    try {
      const env = opened().sandbox.commandEnv();
      expect(env.SANDBOX_TEST_TOKEN).toBeUndefined();
      expect(env.PATH).toBeTruthy();
    } finally {
      delete process.env.SANDBOX_TEST_TOKEN;
    }
  });

  it("子进程 cwd 落在工作区根目录", async () => {
    const harness = opened();
    const result = await harness.sandbox.exec({ argv: ["node", "-e", "console.log(process.cwd())"] });
    expect(result.stdout.trim()).toBe(harness.workspace);
  });

  it("超时后终止进程组并回报 timed_out", async () => {
    const harness = opened({ commandTimeoutMs: 60 });
    const started = Date.now();
    const result = await harness.sandbox.exec({ argv: ["/bin/sh", "-c", "sleep 30"] });

    expect(result).toMatchObject({ timed_out: true });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("子进程输出超过采集上限时丢弃后续内容", async () => {
    const harness = opened({ maxCaptureBytes: 2_048 });
    const result = await harness.sandbox.exec({ argv: ["node", "-e", "console.log('x'.repeat(200000))"] });

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(20_000);
    expect(result.stdout).toContain("字节采集上限");
  });

  it("命令输出先过采集上限，再按 maxOutputChars 裁剪后才进上下文", async () => {
    const harness = opened();
    const executed = await harness.approveAndRun("run_command", {
      command: "node -e \"console.log('y'.repeat(30000))\"",
    });
    const content = String(executed.content);

    expect(executed.code).toBe("OK");
    expect(content).toContain("输出超过");
    expect(content.length).toBeLessThan(harness.config.sandbox.maxOutputChars + 500);
  });
});
