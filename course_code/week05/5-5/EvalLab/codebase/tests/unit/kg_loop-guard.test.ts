import { describe, expect, it } from "vitest";
import { costUsdOf, LoopGuard } from "../../src/loop-guard.js";

const prices = { inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.5 };

describe("LoopGuard public budget seam", () => {
  it("blocks repeated calls before another side effect can run", () => {
    const guard = new LoopGuard({
      maxTurns: 8,
      maxToolCalls: 8,
      maxRepeatedCall: 1,
      maxTotalTokens: 10_000,
      maxCostUsd: 1,
      maxDurationMs: 60_000,
    });

    expect(guard.beforeToolCall("run_command", { command: "npm test" }).allow).toBe(true);
    expect(guard.beforeToolCall("run_command", { command: "npm test" })).toMatchObject({
      allow: false,
      code: "REPEATED_TOOL_CALL",
    });
  });

  it("stops before a new turn when token, cost, turn, time, or approval budget is exhausted", () => {
    const guard = new LoopGuard({
      maxTurns: 1,
      maxToolCalls: 8,
      maxRepeatedCall: 2,
      maxTotalTokens: 100,
      maxCostUsd: 0.01,
      maxDurationMs: 60_000,
    });
    guard.observeAssistantUsage({ totalTokens: 101, costUsd: 0.001 });
    guard.observeTurn();

    expect(guard.shouldStop()).toMatchObject({ stop: true, code: "MAX_TURNS" });

    const approvalGuard = new LoopGuard({
      maxTurns: 8,
      maxToolCalls: 8,
      maxRepeatedCall: 2,
      maxTotalTokens: 10_000,
      maxCostUsd: 1,
      maxDurationMs: 60_000,
    });
    expect(approvalGuard.shouldStop("approval-1")).toEqual({
      stop: true,
      code: "AWAITING_APPROVAL",
      reason: "工具调用正在等待人工审批",
    });
  });
});

describe("costUsdOf", () => {
  it("prefers the amount reported by the model", () => {
    expect(
      costUsdOf(
        { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100, cost: { total: 0.5 } },
        prices,
      ),
    ).toBe(0.5);
  });

  it("prices the tokens itself when the model reports nothing", () => {
    // faux 决策器只算 token、不算钱：离线跑必须靠折算，MAX_COST 才有机会触发。
    expect(
      costUsdOf(
        { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100, cost: { total: 0 } },
        prices,
      ),
    ).toBeCloseTo(0.0073, 10);
  });
});
