import { fauxAssistantMessage, fauxProvider, fauxThinking, fauxText } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runManagedAgent } from "../../src/pi/agent-runner.js";
import * as decider from "../../src/pi/decider.js";
import { createWorkspaceHarness } from "./helpers/workspace.js";

afterEach(() => vi.restoreAllMocks());

describe("可选 Runtime 事件观察器", () => {
  it("保持旧调用兼容，并观察真实消息 usage 与工具事件", async () => {
    const harness = createWorkspaceHarness();
    harness.write("src/policy.ts", "export const readonly = true;\n");
    const events: string[] = [];
    const usages: number[] = [];
    const result = await runManagedAgent(harness.platform, {
      prompt: "读策略", userId: "test", tenantId: "eval", roles: ["reviewer"], mode: "plan",
      decider: "mock",
      script: [{ tool_calls: [{ name: "read_file", args: { path: "src/policy.ts" } }] }, { text: "结束" }],
      onEvent: async (event) => {
        events.push(event.type);
        if (event.type === "message_end" && event.message.role === "assistant") usages.push(event.message.usage.totalTokens);
      },
    });
    expect(result.stop.code).toBe("COMPLETED");
    expect(events).toContain("tool_execution_end");
    expect(usages).toHaveLength(2);
    expect(usages.every((usage) => usage > 0)).toBe(true);
  });

  it.each(["error", "aborted"] as const)("模型 %s 不被标为 COMPLETED", async (stopReason) => {
    const original = decider.selectDecider;
    vi.spyOn(decider, "selectDecider").mockImplementation((config, options) => {
      const selected = original(config, options);
      const faux = fauxProvider({ provider: decider.SCRIPTED_PROVIDER, api: decider.SCRIPTED_API,
        models: [{ id: decider.SCRIPTED_MODEL_ID }] });
      faux.setResponses([fauxAssistantMessage([fauxThinking("不记录的推理"), fauxText("部分回答")],
        { stopReason, errorMessage: "模型失败证据" })]);
      selected.decider.models.setProvider(faux.provider);
      return selected;
    });
    const harness = createWorkspaceHarness();
    const reasons: string[] = [];
    const result = await runManagedAgent(harness.platform, {
      prompt: "任务", userId: "test", tenantId: "eval", roles: ["reviewer"],
      script: [{ text: "不会使用" }],
      onEvent: (event) => {
        if (event.type === "message_end" && event.message.role === "assistant") reasons.push(event.message.stopReason);
      },
    });
    expect(result.stop.code).toBe(stopReason === "error" ? "MODEL_ERROR" : "ABORTED");
    expect(result.stop.reason).toBe("模型失败证据");
    expect(reasons).toEqual([stopReason]);
    expect(JSON.stringify(harness.store.getTrace(result.trace_id))).not.toContain("不记录的推理");
  });
});
