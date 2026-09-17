import { describe, expect, it } from "vitest";

import {
  EvidenceStore,
  PlanStore,
  stepFromSpec,
  type Evidence,
  type RevisionRequest,
  type StepSpec,
  type StepVerifier,
} from "../src/plan-store.js";

const STEPS: StepSpec[] = [
  {
    id: "inspect",
    objective: "读取真实实现",
    dependsOn: [],
    successCriteria: ["有阅读证据"],
  },
  {
    id: "fix",
    objective: "完成最小修改",
    dependsOn: ["inspect"],
    successCriteria: ["有改动证据"],
  },
  {
    id: "verify",
    objective: "目标用例通过",
    dependsOn: ["fix"],
    successCriteria: ["测试退出码为 0"],
  },
];

function buildStore(options: {
  maxRevisions?: number;
  verifyStep?: StepVerifier;
  getRevision?: () => string;
} = {}) {
  const evidence = new EvidenceStore();
  const store = new PlanStore(
    {
      version: 1,
      goal: "修复登录到期边界",
      constraints: ["不得改变公共 API"],
      steps: STEPS.map(stepFromSpec),
      revisionCount: 0,
      maxRevisions: options.maxRevisions ?? 2,
    },
    evidence,
    {
      verifyStep: options.verifyStep,
      getRevision: options.getRevision,
    },
  );
  return { store, evidence };
}

function addEvidence(
  evidence: EvidenceStore,
  stepId: string,
  overrides: Partial<Evidence> = {},
): Evidence {
  return evidence.add({
    stepId,
    toolCallId: `tc-${stepId}`,
    artifactVersion: "r0",
    kind: "test",
    summary: "测试结果",
    payload: { scope: "target", exitCode: 0 },
    ...overrides,
  });
}

describe("PlanStore 依赖与状态", () => {
  it("依赖未完成时不允许开始", () => {
    const { store } = buildStore();

    expect(store.readySteps().map((step) => step.id)).toEqual(["inspect"]);
    expect(() => store.start("fix")).toThrow("PLAN_STEP_NOT_READY");
  });

  it("skipped 不满足下游依赖，必须通过修订改接", () => {
    const { store, evidence } = buildStore();
    store.start("inspect");
    store.complete("inspect", [addEvidence(evidence, "inspect").id]);

    expect(() => store.skip("inspect", "不再需要")).toThrow("PLAN_SKIP_REQUIRES_REWIRE");
    expect(store.readySteps().map((step) => step.id)).toEqual(["fix"]);
  });
});

describe("PlanStore 证据规则", () => {
  it("没有证据不能完成", () => {
    const { store } = buildStore();
    store.start("inspect");

    expect(() => store.complete("inspect", [])).toThrow("PLAN_COMPLETION_REQUIRES_EVIDENCE");
  });

  it("引用不存在的证据不能完成", () => {
    const { store } = buildStore();
    store.start("inspect");

    expect(() => store.complete("inspect", ["ev-404"])).toThrow("PLAN_UNKNOWN_EVIDENCE");
  });

  it("证据必须属于被完成的步骤", () => {
    const { store, evidence } = buildStore();
    store.start("inspect");
    const other = addEvidence(evidence, "fix");

    expect(() => store.complete("inspect", [other.id])).toThrow("PLAN_EVIDENCE_STEP_MISMATCH");
  });

  it("测试失败不能证明修复验证完成", () => {
    const verifyStep: StepVerifier = (step, evidence) => {
      if (step.id !== "verify") return [];
      return evidence.some((item) => item.payload.exitCode === 0 && item.kind === "test")
        ? []
        : ["目标用例必须 exit=0"];
    };
    const { store, evidence } = buildStore({ verifyStep });

    store.start("inspect");
    store.complete("inspect", [
      addEvidence(evidence, "inspect", { kind: "inspection" }).id,
    ]);
    store.start("fix");
    store.complete("fix", [
      addEvidence(evidence, "fix", { kind: "diff", payload: { path: "src/x.ts" } }).id,
    ]);
    store.start("verify");

    const failed = addEvidence(evidence, "verify", { payload: { exitCode: 1 } });
    expect(() => store.complete("verify", [failed.id])).toThrow("PLAN_COMPLETION_REJECTED");
    expect(store.getStep("verify")?.status).toBe("in_progress");
  });

  it("旧版本的通过结果不能用于当前交付", () => {
    const { store, evidence } = buildStore({ getRevision: () => "r1" });
    store.start("inspect");
    const stale = addEvidence(evidence, "inspect", {
      artifactVersion: "r0",
      kind: "diff",
      payload: { path: "src/x.ts" },
    });

    expect(() => store.complete("inspect", [stale.id])).toThrow("PLAN_EVIDENCE_STALE");
  });
});

describe("PlanStore 修订", () => {
  it("替换步骤时保留历史并原子重接下游依赖", () => {
    const { store, evidence } = buildStore();
    store.start("inspect");
    store.complete("inspect", [addEvidence(evidence, "inspect").id]);
    store.start("fix");
    store.complete("fix", [
      addEvidence(evidence, "fix", { kind: "diff", payload: { path: "src/x.ts" } }).id,
    ]);
    const reasonEvidence = addEvidence(evidence, "verify", { payload: { exitCode: 1 } });

    const snapshot = store.revise({
      expectedVersion: 1,
      reason: "失败指向到期边界，而不是密码逻辑",
      evidenceIds: [reasonEvidence.id],
      replace: {
        oldStepId: "fix",
        newStep: {
          id: "fixExpiry",
          objective: "修正到期边界判断",
          dependsOn: ["inspect"],
          successCriteria: ["按时刻比较"],
        },
      },
    });

    expect(snapshot.version).toBe(2);
    expect(snapshot.steps.find((step) => step.id === "fix")?.status).toBe("skipped");
    expect(snapshot.steps.find((step) => step.id === "verify")?.dependsOn).toEqual(["fixExpiry"]);
    expect(snapshot.revisions[0].changes).toEqual([
      "replace:fix->fixExpiry",
      "rewire:verify.dependsOn=fixExpiry",
    ]);
  });

  it("有环的修订整体被拒绝，原计划不变", () => {
    const { store, evidence } = buildStore();
    const before = store.snapshot();
    const item = addEvidence(evidence, "inspect");

    expect(() => store.revise({
      expectedVersion: 1,
      reason: "制造一个环",
      evidenceIds: [item.id],
      dependencies: [{ stepId: "inspect", dependsOn: ["verify"] }],
    })).toThrow("PLAN_DEPENDENCY_CYCLE");

    expect(store.snapshot()).toEqual(before);
  });

  it("修订必须带理由和证据", () => {
    const { store, evidence } = buildStore();
    const item = addEvidence(evidence, "inspect");

    expect(() => store.revise({
      expectedVersion: 1,
      reason: "   ",
      evidenceIds: [item.id],
    })).toThrow("PLAN_REVISION_REQUIRES_REASON");
    expect(() => store.revise({
      expectedVersion: 1,
      reason: "缺少证据",
      evidenceIds: [],
    })).toThrow("PLAN_REVISION_REQUIRES_EVIDENCE");
  });

  it("旧版本发起的修订被拒绝", () => {
    const { store, evidence } = buildStore();
    const item = addEvidence(evidence, "inspect");

    expect(() => store.revise({
      expectedVersion: 0,
      reason: "基于旧版本",
      evidenceIds: [item.id],
    })).toThrow("PLAN_VERSION_CONFLICT");
    expect(store.version).toBe(1);
  });

  it("超过修订预算后拒绝新修订", () => {
    const { store, evidence } = buildStore({ maxRevisions: 1 });
    const item = addEvidence(evidence, "inspect");
    const request: RevisionRequest = {
      expectedVersion: 1,
      reason: "第一次修订",
      evidenceIds: [item.id],
      add: [{
        id: "extra",
        objective: "补充步骤",
        dependsOn: [],
        successCriteria: ["有证据"],
      }],
    };

    store.revise(request);
    expect(store.version).toBe(2);
    expect(() => store.revise({
      ...request,
      expectedVersion: 2,
      reason: "第二次修订",
    })).toThrow("PLAN_MAX_REVISIONS_EXCEEDED");
    expect(store.version).toBe(2);
  });

  it("依赖不存在时拒绝创建计划", () => {
    const evidence = new EvidenceStore();
    expect(() => new PlanStore({
      version: 1,
      goal: "坏计划",
      constraints: [],
      steps: [stepFromSpec({
        id: "only",
        objective: "依赖幽灵步骤",
        dependsOn: ["ghost"],
        successCriteria: [],
      })],
      revisionCount: 0,
      maxRevisions: 2,
    }, evidence)).toThrow("PLAN_UNKNOWN_DEPENDENCY");
  });
});
