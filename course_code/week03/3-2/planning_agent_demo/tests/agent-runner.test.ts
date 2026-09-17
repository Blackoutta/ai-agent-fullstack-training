import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import type { Context } from "@earendil-works/pi-ai";

import { runPlanningAgent } from "../src/agent-runner.js";
import { createExecutionContext } from "../src/run-context.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PLAN_STEPS = [
  {
    id: "read_constraints",
    objective: "读取登录模块实现与任务约束",
    dependsOn: [],
    successCriteria: ["确认登录入口与会话实现"],
  },
  {
    id: "reproduce",
    objective: "复现目标用例失败",
    dependsOn: ["read_constraints"],
    successCriteria: ["记录命令与退出码"],
  },
  {
    id: "modifyPasswordLogic",
    objective: "按初始假设修改密码校验逻辑",
    dependsOn: ["reproduce"],
    successCriteria: ["密码校验分支被修改"],
  },
  {
    id: "verify_target",
    objective: "目标用例通过",
    dependsOn: ["modifyPasswordLogic"],
    successCriteria: ["exit=0"],
  },
  {
    id: "verify_regression",
    objective: "约定回归通过",
    dependsOn: ["verify_target"],
    successCriteria: ["exit=0"],
  },
  {
    id: "report",
    objective: "交付修复说明",
    dependsOn: ["verify_regression"],
    successCriteria: ["写入 artifacts/login-fix.md"],
  },
];

const PATCH_SEARCH = [
  "  const expiresOn = session.expiresAt.slice(0, 10);",
  "  const currentDay = now.toISOString().slice(0, 10);",
  "  return expiresOn < currentDay;",
].join("\n");

function toolCall(name: string, args: Record<string, unknown>) {
  return fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
}

function finalMessage(text: string) {
  return fauxAssistantMessage(text, { stopReason: "stop" });
}

async function makeExecutionContext() {
  const work = await mkdtemp(path.join(tmpdir(), "planning-agent-it-"));
  const repoRoot = path.join(work, "repo");
  await cp(path.join(PROJECT_ROOT, "fixtures", "demo-app"), repoRoot, {
    recursive: true,
  });
  return createExecutionContext({
    projectRoot: work,
    repoRoot,
    artifactRoot: path.join(work, "artifacts"),
    runtimeRoot: PROJECT_ROOT,
  });
}

async function runScripted(
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  options: { maxTurns?: number } = {},
) {
  const faux = fauxProvider({ tokensPerSecond: 10_000 });
  faux.setResponses(responses);
  const executionContext = await makeExecutionContext();
  const contexts: Context[] = [];
  const streamFn = (
    model: Parameters<typeof faux.provider.streamSimple>[0],
    context: Context,
    streamOptions?: Parameters<typeof faux.provider.streamSimple>[2],
  ) => {
    contexts.push({
      systemPrompt: context.systemPrompt,
      messages: structuredClone(context.messages),
    });
    return faux.provider.streamSimple(model, context, streamOptions);
  };
  const result = await runPlanningAgent({
    model: faux.getModel(),
    streamFn,
    executionContext,
    maxTurns: options.maxTurns,
  });
  return { ...result, faux, contexts, executionContext };
}

describe("计划化 Agent Loop 验收", () => {
  it("从初始假设到证据修订，最终由完成契约判定完成", async () => {
    const result = await runScripted([
      toolCall("create_plan", {
        goal: "修复登录模块的到期边界失败测试",
        constraints: ["只修改 src/auth/session-policy.ts", "不得改变公共 API"],
        steps: PLAN_STEPS,
      }),
      toolCall("read_file", {
        path: "src/auth/session-policy.ts",
        planStepId: "read_constraints",
      }),
      toolCall("read_file", {
        path: "src/routes/login.ts",
        planStepId: "read_constraints",
      }),
      toolCall("update_plan_step", {
        stepId: "read_constraints",
        action: "complete",
        evidenceIds: ["ev-1", "ev-2"],
      }),
      toolCall("run_test", { scope: "target", planStepId: "reproduce" }),
      toolCall("update_plan_step", {
        stepId: "reproduce",
        action: "complete",
        evidenceIds: ["ev-3"],
      }),
      toolCall("revise_plan", {
        expectedVersion: 1,
        reason: "失败指向会话有效期判断，而不是密码校验",
        evidenceIds: ["ev-3"],
        replace: {
          oldStepId: "modifyPasswordLogic",
          newStep: {
            id: "fixExpiryCheck",
            objective: "修正会话有效期判断",
            dependsOn: ["reproduce"],
            successCriteria: ["按到期时刻比较"],
          },
        },
        add: [{
          id: "verify_boundaries",
          objective: "到期前、到期时、到期后边界通过",
          dependsOn: ["fixExpiryCheck"],
          successCriteria: ["exit=0"],
        }],
        dependencies: [
          { stepId: "verify_regression", dependsOn: ["verify_target", "verify_boundaries"] },
        ],
      }),
      toolCall("apply_patch", {
        path: "src/auth/session-policy.ts",
        search: PATCH_SEARCH,
        replace: "  return Date.parse(session.expiresAt) <= now.getTime();",
        planStepId: "fixExpiryCheck",
      }),
      toolCall("update_plan_step", {
        stepId: "fixExpiryCheck",
        action: "complete",
        evidenceIds: ["ev-4"],
      }),
      toolCall("run_test", { scope: "target", planStepId: "verify_target" }),
      toolCall("update_plan_step", {
        stepId: "verify_target",
        action: "complete",
        evidenceIds: ["ev-5"],
      }),
      toolCall("run_test", { scope: "boundary", planStepId: "verify_boundaries" }),
      toolCall("update_plan_step", {
        stepId: "verify_boundaries",
        action: "complete",
        evidenceIds: ["ev-6"],
      }),
      toolCall("run_test", { scope: "regression", planStepId: "verify_regression" }),
      toolCall("update_plan_step", {
        stepId: "verify_regression",
        action: "complete",
        evidenceIds: ["ev-7"],
      }),
      toolCall("write_file", {
        path: "artifacts/login-fix.md",
        content: "# 登录到期边界修复\n\n根因：只比较 UTC 日期。",
        planStepId: "report",
      }),
      toolCall("update_plan_step", {
        stepId: "report",
        action: "complete",
        evidenceIds: ["ev-8"],
      }),
      finalMessage("修复完成，已写入交付说明。"),
    ]);

    expect(result.state.stopCode).toBe("COMPLETED");
    const snapshot = result.session.snapshot()!;
    expect(snapshot.version).toBe(2);
    expect(snapshot.steps.find((step) => step.id === "modifyPasswordLogic")?.status).toBe("skipped");
    expect(snapshot.steps.find((step) => step.id === "verify_regression")?.dependsOn)
      .toEqual(["verify_target", "verify_boundaries"]);

    const fixed = await readFile(
      path.join(result.executionContext.repoRoot, "src/auth/session-policy.ts"),
      "utf8",
    );
    expect(fixed).toContain("Date.parse(session.expiresAt) <= now.getTime()");

    const artifact = await readFile(
      path.join(result.executionContext.projectRoot, "artifacts/login-fix.md"),
      "utf8",
    );
    expect(artifact).toContain("登录到期边界修复");
  });

  it("受计划约束的动作缺少 planStepId 时被拦截，handler 不执行", async () => {
    const result = await runScripted([
      toolCall("create_plan", { goal: "修复任务", steps: PLAN_STEPS }),
      toolCall("apply_patch", {
        path: "src/auth/session-policy.ts",
        search: PATCH_SEARCH,
        replace: "  return false;",
      }),
      finalMessage("结束"),
    ]);
    const lastToolResult = result.messages
      .filter((message) => message.role === "toolResult")
      .at(-1);

    expect(result.runtime.getHandlerCallCount("apply_patch")).toBe(0);
    expect(lastToolResult).toMatchObject({
      isError: true,
      content: expect.arrayContaining([expect.objectContaining({
        text: expect.stringContaining("PLAN_STEP_REQUIRED"),
      })]),
    });
  });

  it("绑定未就绪步骤的调用被拒绝", async () => {
    const result = await runScripted([
      toolCall("create_plan", { goal: "修复任务", steps: PLAN_STEPS }),
      toolCall("run_test", { scope: "target", planStepId: "verify_target" }),
      finalMessage("结束"),
    ]);
    const lastToolResult = result.messages
      .filter((message) => message.role === "toolResult")
      .at(-1);

    expect(result.runtime.getHandlerCallCount("run_test")).toBe(0);
    expect(lastToolResult).toMatchObject({
      isError: true,
      content: expect.arrayContaining([expect.objectContaining({
        text: expect.stringContaining("PLAN_STEP_NOT_READY"),
      })]),
    });
  });

  it("引用不存在的证据申请完成会被拒绝", async () => {
    const result = await runScripted([
      toolCall("create_plan", { goal: "修复任务", steps: PLAN_STEPS }),
      toolCall("read_file", {
        path: "src/auth/session-policy.ts",
        planStepId: "read_constraints",
      }),
      toolCall("update_plan_step", {
        stepId: "read_constraints",
        action: "complete",
        evidenceIds: ["ev-404"],
      }),
      finalMessage("结束"),
    ]);
    const lastToolResult = result.messages
      .filter((message) => message.role === "toolResult")
      .at(-1);

    expect(result.session.requirePlan().getStep("read_constraints")?.status).toBe("in_progress");
    expect(lastToolResult).toMatchObject({
      isError: true,
      content: expect.arrayContaining([expect.objectContaining({
        text: expect.stringContaining("PLAN_UNKNOWN_EVIDENCE"),
      })]),
    });
  });

  it("证据不足时拒绝 Final，并注入 Follow-up", async () => {
    const result = await runScripted([
      finalMessage("登录问题已经修复完成。"),
      finalMessage("真的完成了。"),
      finalMessage("结束了。"),
    ], { maxTurns: 3 });

    const userMessages = result.messages
      .filter((message) => message.role === "user")
      .flatMap((message) => {
        const content = message.content;
        if (typeof content === "string") return [content];
        return content
          .filter((block) => block.type === "text")
          .map((block) => (block.type === "text" ? block.text : ""));
      });

    expect(userMessages.some((text) => text.includes("FINAL_REJECTED"))).toBe(true);
    expect(result.state.stopCode).toBe("MAX_TURNS_EXCEEDED");
  });
});
