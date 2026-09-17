// 把 ToolRuntime 的能力适配成 pi 的 AgentTool 接口，让 pi Loop 能发现并调用这些工具。
import { Type } from "typebox";
import type {
  AgentTool,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";

import type { DemoExecutionContext } from "./run-context.js";
import {
  DemoToolRuntime,
  type ManagedToolResult,
} from "./runtime.js";

// 下面是每个工具的入参 Schema（JSON Schema 风格，用 TypeBox 声明）。
// 作用：pi Loop 会把 Schema 转成模型可见的工具定义，
// 模型据此生成参数；Runtime 侧再按同一份 Schema 做校验，
// 保证「模型生成什么」和「执行层校验什么」是同源的一套约束。
// 注意 additionalProperties: false —— 拒绝多余字段，避免模型臆造参数。

const SearchCodeInput = Type.Object(
  {
    // query：要搜索的文本/符号，至少 1 个字符
    query: Type.String({ minLength: 1 }),
    // path：限定搜索范围的目录/文件
    path: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const ListFilesInput = Type.Object(
  {
    // path：可选，缺省表示从仓库根目录开始列举
    path: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const ReadFileInput = Type.Object(
  {
    // path：要读取的源码文件路径
    path: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const WriteFileInput = Type.Object(
  {
    // path：产物写入位置（约定落在 artifacts/ 目录）
    path: Type.String({ minLength: 1 }),
    // content：要写入的正文内容，非空
    content: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

// 适配层核心：把 Runtime 的统一结果（ManagedToolResult）
// 转换成 pi 的 AgentToolResult，这是两套体系之间的「协议桥」。
// 关键设计：成功与失败用不同方式回到 Loop，让模型能区分对待。
function toPiResult(
  result: ManagedToolResult,
): AgentToolResult<Record<string, unknown>> {
  if (!result.ok) {
    // pi 0.83.0 的 AgentTool 约定：执行失败时抛出异常，
    // Loop 会把它归一化为 isError=true 的 Tool Result。
    // 这里把结构化错误（code + 模型可读信息）序列化进 message，
    // 使模型能读到失败原因并自行纠错重试。
    throw new Error(JSON.stringify({
      code: result.code,
      content: result.modelView,
    }));
  }

  // 成功路径：modelView 是「给模型看」的文本视图（可能经过裁剪/摘要），
  // 而 artifact 是「给程序/落盘用」的完整产物，两者职责分离：
  // content 进模型上下文，details 留在工程侧不占用 token。
  return {
    content: [{
      type: "text",
      text: JSON.stringify(result.modelView),
    }],
    details: {
      code: result.code,
      artifact: result.artifact,
    },
  };
}

// 工厂函数：用同一套模板批量生成 AgentTool，
// 避免四个工具重复实现「执行 → 委托 Runtime → 结果转换」的样板代码。
function createTool(
  name: string,
  label: string,
  description: string,
  parameters: AgentTool["parameters"],
  runtime: DemoToolRuntime,
  context: DemoExecutionContext,
): AgentTool {
  return {
    // name：模型调用时使用的唯一标识，需与 Runtime 内注册名一致
    name,
    // label：面向 UI/日志展示的人类可读名称
    label,
    // description：给模型的「何时使用」说明，直接影响工具选择准确率
    description,
    // parameters：上文的入参 Schema，供模型理解参数结构
    parameters,
    // 顺序执行：避免多个工具并发写同一 workspace 造成竞态
    executionMode: "sequential",
    async execute(toolCallId, params, signal) {
      // 所有模型发起的工具调用都回到同一个 Runtime 入口。
      // 好处：鉴权、校验、超时、可观测性等横切逻辑只在一处实现，
      // 且 signal 透传下去，支持 Loop 侧取消时联动中断底层执行。
      const result = await runtime.invoke({
        toolCallId,
        modelName: name,
        args: params as Record<string, unknown>,
        context,
        signal,
      });
      // 统一走 toPiResult 做协议转换
      return toPiResult(result);
    },
  };
}

// 对外导出的组装入口：把「代码理解」这一使用场景所需的工具打包成数组，
// 交给 pi Loop 注册。工具集合本身表达了 Agent 的能力边界与探索路径：
// 先 list_files 摸清结构 → search_code 定位 → read_file 沿调用链确认 → write_file 产出结论。
export function createCodeUnderstandingTools(
  runtime: DemoToolRuntime,
  context: DemoExecutionContext,
): AgentTool[] {
  const listFilesTool = createTool(
    "list_files",
    "List files",
    "列出代码仓库中的文件，用于了解项目结构。",
    ListFilesInput,
    runtime,
    context,
  );
  const searchCodeTool = createTool(
    "search_code",
    "Search code",
    "在代码仓库中搜索文本或符号。当你还不知道文件位置或调用方时使用。",
    SearchCodeInput,
    runtime,
    context,
  );
  const readFileTool = createTool(
    "read_file",
    "Read file",
    "读取一个源码文件，沿调用链确认真实实现。",
    ReadFileInput,
    runtime,
    context,
  );
  // 唯一带副作用的写工具：把理解结论沉淀为文件产物
  const writeArtifactTool = createTool(
    "write_file",
    "Write artifact",
    "把代码理解结论写入 artifacts/ 目录。",
    WriteFileInput,
    runtime,
    context,
  );

  // 保持稳定的顺序（list → search → read → write），
  // 该顺序会体现在模型看到的工具列表中，起到隐式的探索路径引导作用。
  return [
    listFilesTool,
    searchCodeTool,
    readFileTool,
    writeArtifactTool,
  ];
}
