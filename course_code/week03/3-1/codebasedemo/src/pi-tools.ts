// 薄适配层：把四种受控工具能力接入 pi 的工具接口。
// 只做四件事：Schema 描述参数 → 原样调用 Runtime → 成功结果转换 → 失败上交 pi。
// 不做任何新执行逻辑：不读写文件系统、不判断路径权限、不校验参数语义、不重试、不吞异常。
import type {
  AgentTool,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";

import type { DemoExecutionContext } from "./run-context.js";
import {
  DemoToolRuntime,
  ListFilesArgs,
  ReadFileArgs,
  SearchCodeArgs,
  WriteFileArgs,
  type ManagedToolResult,
} from "./runtime.js";

// 工具名唯一来源：适配层声明、停止决策层匹配证据共用，避免出现第二套工具命名。
export const TOOL_NAMES = {
  LIST_FILES: "list_files",
  SEARCH_CODE: "search_code",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
} as const;
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// 成功：模型可见内容取自受控结果的模型视图，以文本块返回；
// 结果代码与产物信息保留在附加信息中，不占用模型上下文。
function toPiResult(
  result: ManagedToolResult,
): AgentToolResult<Record<string, unknown>> {
  if (!result.ok) {
    // pi 约定：失败必须抛出，而不是把错误编码进 content。
    // 抛出内容保留已治理的错误代码与错误视图，供 pi 归一化为错误工具结果。
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
    // 顺序执行：避免多个工具并发读写同一 workspace 造成竞态。
    executionMode: "sequential",
    async execute(toolCallId, params, signal) {
      // 四种工具全部进入同一个 Runtime 入口，不产生第二套执行路径。
      // toolCallId、取消信号原样透传；参数不做语义校验，交由 Runtime 处理。
      const result = await runtime.invoke({
        toolCallId,
        modelName: name,
        args: params as Record<string, unknown>,
        context,
        signal,
      });
      return toPiResult(result);
    },
  };
}

// 工具集合工厂：顺序稳定为 列出文件 → 搜索代码 → 读取文件 → 写入产物。
// 描述只表达用途，不暴露内部分层与实现细节。
export function createCodeUnderstandingTools(
  runtime: DemoToolRuntime,
  context: DemoExecutionContext,
): AgentTool[] {
  return [
    createTool(
      TOOL_NAMES.LIST_FILES,
      "List files",
      "列出代码仓库中的文件，用于了解项目结构。",
      ListFilesArgs,
      runtime,
      context,
    ),
    createTool(
      TOOL_NAMES.SEARCH_CODE,
      "Search code",
      "在代码仓库中搜索文本或符号。当还不知道文件位置或调用方时，用来定位线索。",
      SearchCodeArgs,
      runtime,
      context,
    ),
    createTool(
      TOOL_NAMES.READ_FILE,
      "Read file",
      "读取一个源码文件，沿调用链确认真实实现。",
      ReadFileArgs,
      runtime,
      context,
    ),
    createTool(
      TOOL_NAMES.WRITE_FILE,
      "Write artifact",
      "把代码理解结论写入指定的产物路径。",
      WriteFileArgs,
      runtime,
      context,
    ),
  ];
}
