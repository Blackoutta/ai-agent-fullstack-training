// 验收：受控执行基座对真实 login_demo 的边界、错误归一与可观测性。
import { access } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ToolResultCode } from "../src/runtime.js";
import { createTestHarness, type TestHarness } from "./support/harness.js";

const harnesses: TestHarness[] = [];

async function useHarness(): Promise<TestHarness> {
  const harness = await createTestHarness();
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.cleanup()));
});

describe("统一 Tool Runtime 验收", () => {
  it("用四种能力完成一次探索：只读分析 login_demo，并写出说明文档", async () => {
    const harness = await useHarness();

    // 能力 1：列文件，建立项目全貌。
    const listing = await harness.invoke("list_files", { path: "." });
    expect(listing.ok).toBe(true);
    const { files } = listing.modelView as { basePath: string; files: string[] };
    expect(files.length).toBeGreaterThan(0);
    // 返回给模型的路径必须是相对路径，且不含依赖 / 版本控制目录。
    expect(files.every((file) => !path.isAbsolute(file) && !file.startsWith(".."))).toBe(true);
    expect(files.every((file) => !file.split(path.sep).some((segment) => segment === "node_modules" || segment === ".git"))).toBe(true);
    // 稳定排序：升序，且两次调用结果一致。
    expect([...files]).toEqual([...files].sort((left, right) => left.localeCompare(right)));
    const listingAgain = await harness.invoke("list_files", { path: "." });
    expect((listingAgain.modelView as { files: string[] }).files).toEqual(files);

    // 能力 2：搜索定位线索。
    const search = await harness.invoke("search_code", { query: "login" });
    expect(search.ok).toBe(true);
    const searchView = search.modelView as {
      matches: { path: string; line: number }[];
      total: number;
    };
    expect(searchView.total).toBeGreaterThan(0);
    expect(searchView.matches.length).toBeGreaterThan(0);
    expect(searchView.matches).toEqual(
      [...searchView.matches].sort(
        (left, right) => left.path.localeCompare(right.path) || left.line - right.line,
      ),
    );

    // 能力 3：沿调用链读取真实实现（不硬编码目标仓库文件名）。
    const target = searchView.matches[0].path;
    const read = await harness.invoke("read_file", { path: target });
    expect(read.ok).toBe(true);
    const readView = read.modelView as { path: string; content: string };
    expect(readView.path).toBe(target);
    expect(readView.content).toContain("login");

    // 能力 4：把结论与「实际引用过的源码路径」写成产物，全程不改动目标仓库。
    const content = [
      "# 登录流程说明",
      "",
      "引用源码：",
      `- ${readView.path}`,
      "",
    ].join("\n");
    const written = await harness.invoke("write_file", {
      path: harness.context.targetArtifact,
      content,
    });
    expect(written).toMatchObject({
      ok: true,
      code: ToolResultCode.OK,
      artifact: harness.context.targetArtifact,
    });
    expect(await harness.readArtifact("login-flow.md")).toContain(readView.path);
  });

  it("越界读路径被拒绝", async () => {
    const harness = await useHarness();

    const read = await harness.invoke("read_file", { path: "../package.json" });
    expect(read).toMatchObject({ ok: false, code: ToolResultCode.PATH_DENIED });

    const search = await harness.invoke("search_code", { query: "login", path: "../" });
    expect(search).toMatchObject({ ok: false, code: ToolResultCode.PATH_DENIED });
  });

  it("非产物目录写入被拒绝，且不会落盘", async () => {
    const harness = await useHarness();

    const outside = await harness.invoke("write_file", { path: "src/evil.ts", content: "x" });
    expect(outside).toMatchObject({ ok: false, code: ToolResultCode.ARTIFACT_PATH_DENIED });

    // 仅按字符串前缀判断会被该路径绕过，这里必须同样被拒绝。
    const escape = await harness.invoke("write_file", { path: "artifacts/../escaped.md", content: "x" });
    expect(escape).toMatchObject({ ok: false, code: ToolResultCode.ARTIFACT_PATH_DENIED });

    await expect(access(path.join(harness.context.projectRoot, "escaped.md"))).rejects.toThrow();
    await expect(access(path.join(harness.context.projectRoot, "src", "evil.ts"))).rejects.toThrow();
  });

  it("取消信号能让遍历提前结束", async () => {
    const harness = await useHarness();
    const controller = new AbortController();
    controller.abort();

    const result = await harness.invoke(
      "list_files",
      { path: "." },
      { signal: controller.signal },
    );

    expect(result).toMatchObject({ ok: false, code: ToolResultCode.ABORTED });
  });

  it("未注册工具返回明确错误代码", async () => {
    const harness = await useHarness();
    const result = await harness.invoke("delete_repository");

    expect(result).toMatchObject({ ok: false, code: ToolResultCode.TOOL_NOT_FOUND });
  });

  it("handler 执行计数可被读取，且参数校验失败不计入", async () => {
    const harness = await useHarness();
    expect(harness.runtime.getHandlerCallCount("list_files")).toBe(0);

    const listing = await harness.invoke("list_files", { path: "." });
    expect(listing.ok).toBe(true);
    expect(harness.runtime.getHandlerCallCount("list_files")).toBe(1);

    // 多余字段被 additionalProperties: false 拒绝，handler 不应执行。
    const invalid = await harness.invoke("list_files", { path: ".", unexpected: true });
    expect(invalid).toMatchObject({ ok: false, code: ToolResultCode.INVALID_ARGUMENT });
    expect(harness.runtime.getHandlerCallCount("list_files")).toBe(1);

    const { files } = listing.modelView as { files: string[] };
    const read = await harness.invoke("read_file", { path: files[0] });
    expect(read.ok).toBe(true);
    expect(harness.runtime.getHandlerCallCount("read_file")).toBe(1);
  });

  it("空查询词属于参数校验失败，不会进入 handler", async () => {
    const harness = await useHarness();
    const result = await harness.invoke("search_code", { query: "" });

    expect(result).toMatchObject({ ok: false, code: ToolResultCode.INVALID_ARGUMENT });
    expect(harness.runtime.getHandlerCallCount("search_code")).toBe(0);
  });
});
