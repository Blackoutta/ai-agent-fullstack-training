import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../src/memory.js";
import { renderSystemPrompt } from "../../src/pi/prompt-client.js";
import { createWorkspaceHarness } from "./helpers/workspace.js";

/** 一份跨 Run 值得记住的概念：登录主链 + 一条“不能照搬到生产”的事实。 */
const LOGIN_CONCEPT = {
  id: "concepts/login-flow",
  type: "Code Concept",
  title: "登录调用链",
  description: "从路由到假数据库的登录主链",
  tags: ["auth", "login"],
  body:
    "# 调用链\n\n" +
    "请求经 `src/routes/login.ts` 进入中间件，再交给 Service 与仓储层，底层是内存假数据库。\n\n" +
    "# 不能照搬到生产\n\n" +
    "仓储用的是内存假库，没有真实持久化；生产接入时要替换这一层。",
};

describe("长期记忆（OKF）", () => {
  it("memory_remember 把概念落成合法 OKF 文档，并同步 index.md / log.md", async () => {
    const harness = createWorkspaceHarness();
    const result = await harness.approveAndRun("memory_remember", LOGIN_CONCEPT);
    expect(result.ok).toBe(true);

    const file = join(harness.config.memory.bundle, "concepts/login-flow.md");
    expect(existsSync(file)).toBe(true);
    const parsed = parseFrontmatter(readFileSync(file, "utf8"));
    // OKF 的硬要求：frontmatter 可解析且 type 非空。
    expect(parsed.frontmatter?.type).toBe("Code Concept");
    expect(parsed.frontmatter?.generated).toMatchObject({ by: "codebase-agent/2.0.0" });
    expect(parsed.body).toContain("不能照搬到生产");

    const index = readFileSync(join(harness.config.memory.bundle, "index.md"), "utf8");
    expect(index).toContain("okf_version");
    expect(index).toContain("(/concepts/login-flow.md)");

    const log = readFileSync(join(harness.config.memory.bundle, "log.md"), "utf8");
    expect(log).toMatch(/^#\s+\S+/m);
    expect(log).toMatch(/^##\s+\d{4}-\d{2}-\d{2}\s*$/m);
    expect(log).toContain("**Creation**");

    expect(harness.platform.memory.validate().ok).toBe(true);
  });

  it("memory_recall 支持 query 检索与 id 读全文", async () => {
    const harness = createWorkspaceHarness();
    await harness.approveAndRun("memory_remember", LOGIN_CONCEPT);

    const byQuery = await harness.invoke("memory_recall", { query: "登录" });
    expect(byQuery.ok).toBe(true);
    expect(String(byQuery.content)).toContain("concepts/login-flow");
    expect(String(byQuery.content)).toContain("登录调用链");

    const byId = await harness.invoke("memory_recall", { id: "concepts/login-flow" });
    expect(String(byId.content)).toContain("不能照搬到生产");
    expect(String(byId.content)).toContain("Code Concept");
  });

  it("目录穿越被契约层拦下，空 type 被记忆模块拒绝", async () => {
    const harness = createWorkspaceHarness();

    const escape = await harness.invoke("memory_recall", { id: "../../etc/passwd" });
    expect(escape.ok).toBe(false);
    expect(escape.code).toBe("CONTRACT_MEMORY_ID_ESCAPE");

    const blankType = await harness.approveAndRun("memory_remember", {
      ...LOGIN_CONCEPT,
      id: "concepts/blank",
      type: "   ",
    });
    expect(blankType.ok).toBe(false);
    expect(blankType.code).toBe("MEMORY_INVALID");
  });

  it("开跑前的系统提示词带上长期记忆摘要", async () => {
    const harness = createWorkspaceHarness();
    await harness.approveAndRun("memory_remember", LOGIN_CONCEPT);

    const bundle = await renderSystemPrompt(harness.config, harness.context(), harness.platform.memory);
    expect(bundle.prompt).toContain("## 长期记忆（OKF 知识包）");
    expect(bundle.prompt).toContain("登录调用链");
    expect(bundle.prompt).toContain("/concepts/login-flow.md");
    expect(bundle.memory?.concepts).toBe(1);
  });

  it("跨会话回读：Run A 写进去，Run B 不重读代码也能取回来", async () => {
    const sharedBundle = mkdtempSync(join(tmpdir(), "okf-memory-"));
    const runA = createWorkspaceHarness({ memoryBundle: sharedBundle });
    const written = await runA.approveAndRun("memory_remember", LOGIN_CONCEPT);
    expect(written.ok).toBe(true);

    // 新开一个 platform 实例＝新的一次 Run：只有共享的 OKF bundle 把知识带过去。
    const runB = createWorkspaceHarness({ memoryBundle: sharedBundle });
    expect(runB.platform.memory.digest().text).toContain("登录调用链");

    const recall = await runB.invoke("memory_recall", { query: "登录" });
    expect(recall.ok).toBe(true);
    expect(String(recall.content)).toContain("concepts/login-flow");
  });
});
