import { Type } from "typebox";
import type { PlatformConfig } from "../config.js";
import type { ManagedTool } from "../domain.js";
import { ToolRuntimeError } from "../domain.js";
import type { Sandbox } from "../sandbox.js";
import { optionalText, text } from "./args.js";
import { clipHead } from "./clip.js";

const SHELL = "/bin/sh";

/** 平台上限换算成秒，供 schema 的 maximum 用：边界要写在模型看得见的地方，而不是在 handler 里悄悄夹掉。 */
function commandTimeoutSeconds(config: PlatformConfig): number {
  return Math.max(1, Math.floor(config.sandbox.commandTimeoutMs / 1_000));
}

export function createRunCommandTool(sandbox: Sandbox, config: PlatformConfig): ManagedTool {
  return {
    metadata: {
      internalName: "run_command",
      description:
        "在工作区根目录执行一条 shell 命令。子进程环境已剔除密钥类变量，超时会被终止。需要人工审批后才执行，能不用它就不要用它。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          command: Type.String({ description: "要执行的 shell 命令", minLength: 1 }),
          timeout: Type.Optional(
            Type.Number({
              description: `本次执行的超时秒数，只能是 1-${commandTimeoutSeconds(config)} 之间的秒数`,
              minimum: 1,
              maximum: commandTimeoutSeconds(config),
            }),
          ),
        },
        { additionalProperties: false },
      ),
      risk: "high",
      permissions: ["repo:execute"],
      requiresConfirmation: true,
      timeoutMs: config.sandbox.commandTimeoutMs + config.sandbox.killGraceMs + 5_000,
      maxRetries: 0,
      idempotent: false,
      source: "local",
    },
    async handler({ args, signal }) {
      return await run(sandbox, [SHELL, "-c", text(args, "command")], args.timeout, signal);
    },
  };
}

export function createRunTestTool(sandbox: Sandbox, config: PlatformConfig): ManagedTool {
  return {
    metadata: {
      internalName: "run_test",
      description:
        "跑工作区配置好的测试命令。不带 test_file 时跑全量，带 test_file 时把它作为参数追加过去。修复循环里以这条命令的退出码为准，不要凭读代码断言测试通过。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          test_file: Type.Optional(
            Type.String({ description: "只跑这个测试文件，相对工作区根目录", minLength: 1 }),
          ),
          timeout: Type.Optional(
            Type.Number({
              description: `本次执行的超时秒数，只能是 1-${commandTimeoutSeconds(config)} 之间的秒数`,
              minimum: 1,
              maximum: commandTimeoutSeconds(config),
            }),
          ),
        },
        { additionalProperties: false },
      ),
      risk: "high",
      permissions: ["repo:execute"],
      requiresConfirmation: false,
      timeoutMs: config.sandbox.commandTimeoutMs + config.sandbox.killGraceMs + 5_000,
      maxRetries: 0,
      idempotent: true,
      source: "local",
    },
    async handler({ args, signal }) {
      if (config.tools.testCommand.length === 0) {
        const which = config.task ? `任务类型 ${config.task.id} ` : "当前任务";
        throw new ToolRuntimeError("TEST_COMMAND_MISSING", `无法执行: ${which}未声明 test_command`);
      }
      const target = optionalText(args, "test_file");
      // 传给测试命令的是规范化后的相对路径：回显到 stdout 的那条命令里不带本机绝对路径，
      // 同一份转录因此可以在任何机器上逐字复现。
      const argv = [...config.tools.testCommand, ...(target ? [sandbox.relativeOf(sandbox.check(target))] : [])];
      return await run(sandbox, argv, args.timeout, signal);
    },
  };
}

async function run(sandbox: Sandbox, argv: string[], rawTimeout: unknown, signal: AbortSignal | undefined): Promise<string> {
  const capMs = sandbox.rules.commandTimeoutMs;
  const requestedSeconds = typeof rawTimeout === "number" ? rawTimeout : undefined;
  const timeoutMs = requestedSeconds === undefined ? capMs : Math.min(Math.trunc(requestedSeconds * 1_000), capMs);
  const result = await sandbox.exec({ argv, timeoutMs, signal });
  const stdout = clipHead(result.stdout, sandbox.rules.maxOutputChars);
  const stderr = clipHead(result.stderr, sandbox.rules.maxOutputChars);
  return [
    `$ ${argv.join(" ")} · 退出码 ${result.exit_code ?? "无"}${result.signal ? ` / 信号 ${result.signal}` : ""}` +
      ` · ${result.duration_ms}ms${result.timed_out ? " · 超时被终止" : ""}`,
    stdout.text.trimEnd(),
    stderr.text.trimEnd() ? `--- stderr ---\n${stderr.text.trimEnd()}` : "",
    stdout.truncated || stderr.truncated || result.truncated
      ? `[输出超过 ${sandbox.rules.maxOutputChars} 字符，超出部分未进入上下文]`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
