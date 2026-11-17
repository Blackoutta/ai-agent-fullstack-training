import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxThinking, fauxText } from "../../codebase/node_modules/@earendil-works/pi-ai/dist/index.js";
import { afterEach, describe, expect, it, vi } from "../../codebase/node_modules/vitest/dist/index.js";
import { buildPlatform } from "../../codebase/src/platform.js";
import { loadConfig } from "../../codebase/src/config.js";
import * as decider from "../../codebase/src/pi/decider.js";
import { CODEBASE, messageOf, prepareConfig, READ_TOOLS, runBridge, type BridgeInput } from "./worker.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function input(): BridgeInput {
  return { workspace: CODEBASE, run_dir: mkdtempSync(join(tmpdir(), "eval-bridge-")),
    task: { prompt: "说明策略引擎，附注：Python 检索证据" },
    strategy: { system_prompt: "只读审查策略", model: "test-model", base_url: "http://127.0.0.1:1",
      api_key_env: "EVAL_BRIDGE_TEST_KEY", rag_mode: "bm25", top_k: 3 },
    mode: "offline", max_tokens: 2048, timeout: 45 };
}

describe("治理桥接", () => {
  it("离线通过真实 Runtime 读源码，输出演示而非成绩", async () => {
    const request = input();
    const events: unknown[] = [];
    const final = await runBridge(request, (event) => events.push(event));
    expect(final.execution_status).toBe("completed");
    expect(final.messages).toHaveLength(2);
    expect(final.messages.every((message) => message.provider === "managed-script")).toBe(true);
    expect(JSON.stringify(final.result)).toContain("不代表评测通过");
    expect(final.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool_name: "read_file", event_type: "tool_execution", code: "OK" }),
    ]));
    const read = final.audit.find((row) => row.event_type === "tool_execution");
    expect(String(read?.input_json)).toContain("src/policy.ts");
    expect(String(read?.output_json)).toContain("PolicyEngine");
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "tool_execution_end" })]));
  });

  it("从原 YAML 重写绝对路径、固定权限并隔离每次账本", async () => {
    const request = input();
    const path = prepareConfig(request);
    const config = loadConfig(path);
    expect(config.runtime.database).not.toBe(loadConfig(join(CODEBASE, "config/platform.yaml")).runtime.database);
    expect(config.runtime.database).not.toBe(loadConfig(prepareConfig(request)).runtime.database);
    expect(config.memory.enabled).toBe(false);
    expect(config.rag.enabled).toBe(false);
    expect(config.hitl.gate).toEqual({ mode: "auto", tools: [] });
    expect(config.policy.rolePermissions).toEqual({ reviewer: ["repo:read", "git:read"] });
    expect(config.sandbox.denyRead).toContain("**/.env");
    expect(config.model.maxTokens).toBe(2048);
    expect(readFileSync(config.prompt.file, "utf8")).toContain(request.task.prompt);
    expect(readFileSync(config.prompt.file, "utf8")).toContain(request.strategy.system_prompt);
    const platform = await buildPlatform({ configPath: path });
    expect(platform.registry.snapshot({
      traceId: "test", requestId: "test", tenantId: "eval", userId: "test",
      agentName: "eval-bridge", roles: ["reviewer"], mode: "plan",
    }, platform.policy).map((tool) => tool.modelName).sort()).toEqual([...READ_TOOLS].sort());
    await platform.close();
  });

  it("live 缺凭据失败关闭，没有脚本降级", async () => {
    vi.stubEnv("EVAL_BRIDGE_TEST_KEY", " ");
    const final = await runBridge({ ...input(), mode: "live" });
    expect(final.execution_status).toBe("error");
    expect(final.messages).toEqual([]);
    expect(JSON.stringify(final.result)).toContain("live 禁止降级");
  });

  it("不让课堂环境变量覆盖本次策略，并恢复环境", async () => {
    vi.stubEnv("GATEWAY_MODEL_ID", "wrong-model");
    vi.stubEnv("GATEWAY_BASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("HITL_MODE", "http");
    const final = await runBridge(input());
    expect(final.execution_status).toBe("completed");
    expect(process.env.GATEWAY_MODEL_ID).toBe("wrong-model");
    expect(process.env.HITL_MODE).toBe("http");
  });

  it("消息投影保留 usage/error，不包含 thinking", () => {
    const message = fauxAssistantMessage([fauxThinking("private-thinking"), fauxText("public")],
      { stopReason: "error", errorMessage: "failure" });
    const projected = messageOf({ type: "message_end", message });
    expect(projected).toMatchObject({ text: "public", stopReason: "error", errorMessage: "failure", usage: message.usage });
    expect(JSON.stringify(projected)).not.toContain("private-thinking");
  });

  it.each(["error", "aborted"] as const)("worker 保留实际 %s 消息，并返回 error", async (stopReason) => {
    const original = decider.selectDecider;
    vi.spyOn(decider, "selectDecider").mockImplementation((config, options) => {
      const selected = original(config, options);
      const faux = fauxProvider({ provider: decider.SCRIPTED_PROVIDER, api: decider.SCRIPTED_API,
        models: [{ id: decider.SCRIPTED_MODEL_ID }] });
      faux.setResponses([fauxAssistantMessage([fauxThinking("private-thinking"), fauxText("partial")],
        { stopReason, errorMessage: "failure-evidence" })]);
      selected.decider.models.setProvider(faux.provider);
      return selected;
    });
    const final = await runBridge(input());
    expect(final.execution_status).toBe("error");
    expect(final.messages).toEqual([expect.objectContaining({
      text: "partial", stopReason, errorMessage: "failure-evidence",
    })]);
    expect(final.trace.length).toBeGreaterThan(0);
    expect(JSON.stringify(final)).not.toContain("private-thinking");
  });

  it("绝对 tsx loader 可从任意 cwd 运行 stdin/stdout JSONL", () => {
    const output = execFileSync(process.execPath,
      ["--import", join(CODEBASE, "node_modules/tsx/dist/esm/index.mjs"), join(CODEBASE, "../codebaseEval/bridge/worker.ts")],
      { cwd: tmpdir(), input: JSON.stringify(input()) + "\n", encoding: "utf8", timeout: 45000 });
    const events = output.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ type: "result", execution_status: "completed" });
    expect(events.filter((event) => event.type === "result")).toHaveLength(1);
  }, 60000);
});
