import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deciderLabel, selectDecider, type ScriptedStep } from "../../src/pi/decider.js";
import { runManagedAgent } from "../../src/pi/agent-runner.js";
import { verifyDeliverable } from "../../src/deliverable.js";
import type { PlatformConfig } from "../../src/config.js";
import { createWorkspaceHarness, type WorkspaceHarness } from "./helpers/workspace.js";

function selection(config: PlatformConfig, options: Parameters<typeof selectDecider>[1]) {
  return selectDecider(config, options).selection;
}

function traceTypes(harness: WorkspaceHarness, traceId: string, eventType: string): Record<string, unknown>[] {
  return harness.store
    .getTrace(traceId)
    .filter((row) => row.event_type === eventType)
    .map((row) => JSON.parse(String(row.payload_json)));
}

const DELIVERABLE = "artifacts/login-flow.md";

/** 一步写交付物、同一条回复里自述完成——审批没批之前，这句自述就是"没有证据的话"。 */
function writeThenClaim(content: string): ScriptedStep[] {
  return [
    {
      text: `交付物 ${DELIVERABLE} 已经写好，登录链路都在里面。`,
      tool_calls: [{ name: "write_file", args: { path: DELIVERABLE, content } }],
    },
  ];
}

describe("P4 决策器可插拔：换了脑袋必须说得出是谁在决策", () => {
  it("AC-1 auto 口径：任务配了离线脚本就走脚本，model_id 与标签都指着那份脚本", () => {
    const harness = createWorkspaceHarness({ task: "understand" });

    const chosen = selection(harness.config, { requested: "auto", hasApiKey: true });

    // auto 的含义是"离线优先"：就算密钥在，课堂与 CI 也不该顺手烧真模型。
    expect(chosen.kind).toBe("scripted");
    expect(chosen.degraded).toBe(false);
    expect(chosen.script).toBe("understand-login.yaml");
    expect(deciderLabel(chosen)).toBe("mock:understand-login.yaml");
    expect(chosen.modelId).toBe("managed-script/decider");
  });

  it("AC-2 mock 口径没有脚本可用时直接报 SCRIPT_REQUIRED，不拿真模型凑数", () => {
    const harness = createWorkspaceHarness();

    expect(() => selectDecider(harness.config, { requested: "mock", hasApiKey: true })).toThrow(/SCRIPT_REQUIRED/);
  });

  it("AC-3 real 口径在有密钥时连网关：选择说明里写清连的是哪个地址", () => {
    const harness = createWorkspaceHarness({ task: "understand" });

    const chosen = selection(harness.config, { requested: "real", hasApiKey: true });

    expect(chosen.kind).toBe("gateway");
    expect(chosen.script).toBe(null);
    expect(chosen.modelId).toBe(`${harness.config.model.providerId}/${harness.config.model.id}`);
    expect(chosen.reason).toContain(harness.config.gateway.baseUrl);
    expect(deciderLabel(chosen)).toBe(`real:${chosen.modelId}`);
  });

  it("AC-4 real 口径没密钥时降级，并且把降级写在脸上", () => {
    const harness = createWorkspaceHarness({ task: "understand" });
    const apiKeyEnv = harness.config.gateway.apiKeyEnv;

    const chosen = selection(harness.config, { requested: "real", hasApiKey: false });

    // degraded 这一位是给评估器看的：它要能区分"按要求跑了真模型"和"悄悄换成了脚本"。
    expect(chosen.kind).toBe("scripted");
    expect(chosen.degraded).toBe(true);
    expect(chosen.reason).toContain(`${apiKeyEnv} 未设置`);
    expect(chosen.reason).toContain("降级");
  });

  it("AC-5 real 口径既没密钥也没脚本可降级：显式失败，绝不换成 pi 自己的模型", () => {
    const harness = createWorkspaceHarness();

    expect(() => selectDecider(harness.config, { requested: "real", hasApiKey: false })).toThrow(/MODEL_UNAVAILABLE/);
    // auto 口径同样无路可走时报错，并且把三条出路写在错误信息里。
    expect(() => selectDecider(harness.config, { requested: "auto", hasApiKey: false })).toThrow(/--script/);
  });

  it("AC-6 口径拼错就报错，不许悄悄按 auto 处理", () => {
    const harness = createWorkspaceHarness({ task: "understand" });

    expect(() => selection(harness.config, { requested: "reaal" as never, hasApiKey: true })).toThrow(/DECIDER_MODE/);
  });

  it("AC-7 身份记账：一条 decider.selected，每步一条 decider.step", async () => {
    const harness = createWorkspaceHarness({ task: "understand" });
    const printed: string[] = [];

    const result = await runManagedAgent(harness.platform, {
      prompt: "把登录逻辑写成说明文档",
      userId: "trainer-1",
      tenantId: "tenant_a",
      roles: ["maintainer"],
      script: [
        { text: "先看入口。", tool_calls: [{ name: "search_code", args: { pattern: "login", path: "src" } }] },
        { text: "再读服务。", tool_calls: [{ name: "read_file", args: { path: "src/services/auth-service.ts" } }] },
        { text: "可以收尾了。" },
      ],
      onDeciderSelected: (line) => printed.push(line),
      onDeciderStep: (line) => printed.push(line),
    });

    const selected = traceTypes(harness, result.trace_id, "decider.selected");
    const steps = traceTypes(harness, result.trace_id, "decider.step");
    expect(selected).toHaveLength(1);
    // 这一趟是内存里的步骤在主事，标签就写"内联步骤"：账上写的必须是真正决策的那一份。
    expect(selected[0]).toMatchObject({ label: "mock:(内联步骤)", kind: "scripted", degraded: false });
    expect(steps.map((row) => row.step)).toEqual([1, 2, 3]);
    expect(result.decider.steps).toBe(3);
    // 打印的行数与记账的行数一致：人看到的和数据库里的是同一件事。
    expect(printed).toEqual([
      expect.stringMatching(/^\[决策器\] mock:/),
      expect.stringMatching(/^\[决策器 · 第1步\] mock:/),
      expect.stringMatching(/^\[决策器 · 第2步\] mock:/),
      expect.stringMatching(/^\[决策器 · 第3步\] mock:/),
    ]);
  });

  it("AC-8 --script 点名的脚本优先于任务条目里配的那份", async () => {
    const harness = createWorkspaceHarness({ task: "understand" });

    const result = await runManagedAgent(harness.platform, {
      prompt: "把登录逻辑写成说明文档",
      userId: "trainer-1",
      tenantId: "tenant_a",
      roles: ["maintainer"],
      // tasks.yaml 给 understand 配的是七步的 understand-login.yaml；点名这份两步的，跑出来就是两步。
      scriptPath: "config/scripts/decider-override.yaml",
    });

    expect(result.decider.label).toBe("mock:decider-override.yaml");
    expect(result.decider.steps).toBe(2);
    expect(result.final_answer).toContain("说了算");
  });

  it("AC-9 交付物回读：审批之前模型自述已写、审计里却没有成功的写入", async () => {
    const harness = createWorkspaceHarness({ task: "understand" });

    const result = await runManagedAgent(harness.platform, {
      prompt: "把登录逻辑写成说明文档",
      userId: "trainer-1",
      tenantId: "tenant_a",
      roles: ["maintainer"],
      script: writeThenClaim("# 登录链路\n\nlogin 路由调 AuthService.verify。\n"),
    });

    expect(result.stop.code).toBe("AWAITING_APPROVAL");
    expect(existsSync(join(harness.workspace, DELIVERABLE))).toBe(false);
    // 模型自己说了路径，这一位为 true；但 delivered 只看审计，所以为 false。
    expect(result.deliverable.model_claims).toBe(true);
    expect(result.deliverable.delivered).toBe(false);
    expect(result.deliverable.claim_without_evidence).toBe(true);
    expect(result.deliverable.expected_path).toBe(DELIVERABLE);
    expect(result.deliverable.approvers).toEqual(["maintainer"]);
    expect(result.deliverable.attempts).toHaveLength(1);
    expect(result.deliverable.attempts[0]).toMatchObject({
      tool_name: "write_file",
      path: DELIVERABLE,
      // 等审批不是失败，code 是这次拦停的原因码；审批单号也已经在账上。
      approval_id: expect.any(String),
    });
    expect(String(result.deliverable.attempts[0].evidence)).toMatch(/^audit:/);
    // 回读的结果本身也要进 trace：交付物这件事不能只活在进程退出前的那段 stdout 里。
    const verified = traceTypes(harness, result.trace_id, "deliverable.verified");
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({ delivered: false, model_claims: true, claim_without_evidence: true });
  });

  it("AC-10 审批之后重跑同一条口径：交付物有账可查，自述与审计对得上", async () => {
    const harness = createWorkspaceHarness({ task: "understand" });
    const content = "# 登录链路\n\nlogin 路由调 AuthService.verify，再由 TokenService 签发。\n";

    const result = await runManagedAgent(harness.platform, {
      prompt: "把登录逻辑写成说明文档",
      userId: "trainer-1",
      tenantId: "tenant_a",
      roles: ["maintainer"],
      script: writeThenClaim(content),
    });
    harness.store.decideApproval(result.pending_approval_id as string, "approve", "manager-1");
    await harness.runtime.executeApproval(result.pending_approval_id as string);

    // 审批消费完，重新回读同一条 trace：这时审计里才有一行成功的写入。
    const verification = verifyDeliverable(harness.store, {
      traceId: result.trace_id,
      task: { id: "understand", label: "任务一", deliverable: DELIVERABLE, approvers: harness.config.hitl.approvers },
      decider: { kind: "scripted", label: "mock:understand-login.yaml", script: "understand-login.yaml", degraded: false },
      finalAnswer: result.final_answer,
    });

    expect(readFileSync(join(harness.workspace, DELIVERABLE), "utf8")).toBe(content);
    expect(verification.delivered).toBe(true);
    expect(verification.claim_without_evidence).toBe(false);
    expect(verification.attempts.map((row) => row.code)).toContain("OK");
    expect(verification.attempts.filter((row) => row.code === "OK")[0].superseded).toBe(false);
  });
});
