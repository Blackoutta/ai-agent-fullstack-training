// ============================================================================
// 计划工具的契约与 Handler
//
// 模型只能提出操作：create / get / update / revise。
// Handler 负责校验并修改 PlanStore；模型不能直接改状态。
// update_plan_step(complete) 只是「完成申请」，能否通过由 PlanStore 的证据规则决定。
// ============================================================================
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";

import {
  PlanningSession,
  type PlanSnapshot,
  type StepSpec,
} from "./plan-store.js";

const StepSpecSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    objective: Type.String({ minLength: 1 }),
    dependsOn: Type.Array(Type.String({ minLength: 1 })),
    successCriteria: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const CreatePlanInput = Type.Object(
  {
    goal: Type.String({ minLength: 1 }),
    constraints: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    maxRevisions: Type.Optional(Type.Number({ minimum: 0 })),
    steps: Type.Array(StepSpecSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const GetPlanInput = Type.Object({}, { additionalProperties: false });

export const UpdatePlanStepInput = Type.Object(
  {
    stepId: Type.String({ minLength: 1 }),
    action: Type.Union([
      Type.Literal("start"),
      Type.Literal("complete"),
      Type.Literal("fail"),
      Type.Literal("block"),
    ]),
    evidenceIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    error: Type.Optional(Type.String({ minLength: 1 })),
    expectedVersion: Type.Optional(Type.Number({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const RevisePlanInput = Type.Object(
  {
    expectedVersion: Type.Number({ minimum: 1 }),
    reason: Type.String({ minLength: 1 }),
    evidenceIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    replace: Type.Optional(Type.Object(
      {
        oldStepId: Type.String({ minLength: 1 }),
        newStep: StepSpecSchema,
      },
      { additionalProperties: false },
    )),
    add: Type.Optional(Type.Array(StepSpecSchema)),
    dependencies: Type.Optional(Type.Array(
      Type.Object(
        {
          stepId: Type.String({ minLength: 1 }),
          dependsOn: Type.Array(Type.String({ minLength: 1 })),
        },
        { additionalProperties: false },
      ),
    )),
  },
  { additionalProperties: false },
);

function toResult(modelView: unknown): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: JSON.stringify(modelView) }],
    details: {},
  };
}

function toError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(JSON.stringify({ code: "PLAN_OPERATION_REJECTED", message }));
}

export function createPlanningTools(session: PlanningSession): AgentTool[] {
  const createPlan: AgentTool = {
    name: "create_plan",
    label: "Create plan",
    description: "为复杂任务创建显式计划：说明目标、约束和可验收的步骤依赖。",
    parameters: CreatePlanInput,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      try {
        const args = params as {
          goal: string;
          constraints?: string[];
          maxRevisions?: number;
          steps: StepSpec[];
        };
        const store = session.createPlan({
          goal: args.goal,
          constraints: args.constraints,
          maxRevisions: args.maxRevisions,
          steps: args.steps,
        });
        return toResult({ ok: true, plan: store.snapshot() });
      } catch (error) {
        return toError(error);
      }
    },
  };

  const getPlan: AgentTool = {
    name: "get_plan",
    label: "Get plan",
    description: "读取当前计划、步骤状态、就绪步骤和修订历史。",
    parameters: GetPlanInput,
    executionMode: "sequential",
    async execute() {
      try {
        return toResult({
          ok: true,
          plan: session.snapshot() ?? null,
          evidence: session.evidence.list(),
        });
      } catch (error) {
        return toError(error);
      }
    },
  };

  const updatePlanStep: AgentTool = {
    name: "update_plan_step",
    label: "Update plan step",
    description: "申请开始、完成、失败或阻塞某个步骤；完成申请必须引用真实证据。",
    parameters: UpdatePlanStepInput,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      try {
        const args = params as {
          stepId: string;
          action: "start" | "complete" | "fail" | "block";
          evidenceIds?: string[];
          error?: string;
          expectedVersion?: number;
        };
        const store = session.requirePlan();
        switch (args.action) {
          case "start":
            store.start(args.stepId, args.expectedVersion);
            break;
          case "complete":
            store.complete(args.stepId, args.evidenceIds ?? [], args.expectedVersion);
            break;
          case "fail":
            store.fail(args.stepId, args.error ?? "未提供失败原因", args.expectedVersion);
            break;
          case "block":
            store.block(args.stepId, args.error ?? "未提供阻塞原因", args.expectedVersion);
            break;
        }
        return toResult({ ok: true, plan: store.snapshot() });
      } catch (error) {
        return toError(error);
      }
    },
  };

  const revisePlan: AgentTool = {
    name: "revise_plan",
    label: "Revise plan",
    description: "根据新证据整体修订计划：替换步骤、追加步骤或改接依赖。",
    parameters: RevisePlanInput,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      try {
        const store = session.requirePlan();
        const plan: PlanSnapshot = store.revise(params as never);
        return toResult({ ok: true, plan });
      } catch (error) {
        return toError(error);
      }
    },
  };

  return [createPlan, getPlan, updatePlanStep, revisePlan];
}
