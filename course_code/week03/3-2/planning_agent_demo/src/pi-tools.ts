// 把 Runtime 与计划层的能力适配成 pi 的 AgentTool。
//
// 与 3.1 相比有三处变化：
//   1. 所有工具都可以携带可选 planStepId，把这次调用绑定到计划步骤；
//   2. 受计划约束的工具（写文件 / 改代码 / 跑测试）必须携带 planStepId，
//      LoopGuard 在执行前校验，适配层在调用 Runtime 前剥离该字段；
//   3. 增加 apply_patch、run_test 与四个计划工具。
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";

import type { DemoExecutionContext } from "./run-context.js";
import {
  DemoToolRuntime,
  type ManagedToolResult,
} from "./runtime.js";
import { createPlanningTools } from "./plan-tools.js";
import type { PlanningSession } from "./plan-store.js";

/** 必须绑定计划步骤、否则会被 LoopGuard 在执行前拦下的工具。 */
export const GOVERNED_TOOLS = new Set([
  "write_file",
  "apply_patch",
  "run_test",
]);

const PlanStepId = Type.Optional(Type.String({ minLength: 1 }));

const SearchCodeInput = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    planStepId: PlanStepId,
  },
  { additionalProperties: false },
);

const ListFilesInput = Type.Object(
  {
    path: Type.Optional(Type.String({ minLength: 1 })),
    planStepId: PlanStepId,
  },
  { additionalProperties: false },
);

const ReadFileInput = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    planStepId: PlanStepId,
  },
  { additionalProperties: false },
);

const WriteFileInput = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 }),
    planStepId: PlanStepId,
  },
  { additionalProperties: false },
);

const ApplyPatchInput = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    search: Type.String({ minLength: 1 }),
    replace: Type.String(),
    planStepId: PlanStepId,
  },
  { additionalProperties: false },
);

const RunTestInput = Type.Object(
  {
    scope: Type.Union([
      Type.Literal("target"),
      Type.Literal("boundary"),
      Type.Literal("regression"),
    ]),
    planStepId: PlanStepId,
  },
  { additionalProperties: false },
);

// 成功与失败用不同方式回到 Loop：失败抛异常，成为 isError=true 的 Tool Result；
// 成功则把模型可见内容与程序可见的 evidence 一起返回。
function toPiResult(
  result: ManagedToolResult,
): AgentToolResult<Record<string, unknown>> {
  if (!result.ok) {
    throw new Error(JSON.stringify({
      code: result.code,
      content: result.modelView,
    }));
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify(result.modelView),
    }],
    details: {
      code: result.code,
      artifact: result.artifact,
      evidence: result.evidence,
    },
  };
}

function createTool(
  name: string,
  label: string,
  description: string,
  parameters: AgentTool["parameters"],
  runtime: DemoToolRuntime,
  context: DemoExecutionContext,
): AgentTool {
  return {
    name,
    label,
    description,
    parameters,
    executionMode: "sequential",
    async execute(toolCallId, params, signal) {
      // planStepId 只服务于计划校验，不属于业务参数，进入 Runtime 前剥离。
      const { planStepId: _planStepId, ...args } = params as Record<string, unknown>;
      const result = await runtime.invoke({
        toolCallId,
        modelName: name,
        args,
        context,
        signal,
      });
      return toPiResult(result);
    },
  };
}

export function createPlanningAgentTools(
  runtime: DemoToolRuntime,
  context: DemoExecutionContext,
  session: PlanningSession,
): AgentTool[] {
  return [
    createTool(
      "list_files",
      "List files",
      "列出代码仓库中的文件，用于了解项目结构。",
      ListFilesInput,
      runtime,
      context,
    ),
    createTool(
      "search_code",
      "Search code",
      "在代码仓库中搜索文本或符号。当你还不知道文件位置或调用方时使用。",
      SearchCodeInput,
      runtime,
      context,
    ),
    createTool(
      "read_file",
      "Read file",
      "读取一个源码文件，沿调用链确认真实实现。",
      ReadFileInput,
      runtime,
      context,
    ),
    createTool(
      "write_file",
      "Write artifact",
      "把结论写入 artifacts/ 目录。必须携带 planStepId。",
      WriteFileInput,
      runtime,
      context,
    ),
    createTool(
      "apply_patch",
      "Apply patch",
      "在目标仓库内做最小源码修改：替换唯一命中的片段。必须携带 planStepId。",
      ApplyPatchInput,
      runtime,
      context,
    ),
    createTool(
      "run_test",
      "Run test",
      "按约定范围运行测试并返回真实退出码。scope=target 目标用例，scope=boundary 到期边界，scope=regression 约定回归。必须携带 planStepId。",
      RunTestInput,
      runtime,
      context,
    ),
    ...createPlanningTools(session),
  ];
}
