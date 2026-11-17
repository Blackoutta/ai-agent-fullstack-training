import { Type } from "typebox";
import type { ManagedTool } from "../domain.js";
import { ToolRuntimeError } from "../domain.js";
import type { Sandbox } from "../sandbox.js";
import { flag, optionalText } from "./args.js";
import { clipHead } from "./clip.js";

export function createGitStatusTool(sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "git_status",
      description: "查看工作区的改动清单（git status --porcelain）。动手前先拍一张，收工前再拍一张，用来确认只改了计划内的文件。",
      version: "2.0.0",
      parameters: Type.Object({}, { additionalProperties: false }),
      risk: "read",
      permissions: ["git:read"],
      requiresConfirmation: false,
      timeoutMs: 10_000,
      maxRetries: 2,
      idempotent: true,
      source: "local",
    },
    async handler({ signal }) {
      const output = await git(sandbox, ["status", "--porcelain=v1"], signal);
      return output === "" ? "工作区干净：没有任何改动" : output;
    },
  };
}

export function createGitDiffTool(sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "git_diff",
      description: "查看改动的具体内容。默认对比工作区与暂存区，staged 为 true 时对比暂存区与 HEAD，path 用来只看某个文件。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          staged: Type.Optional(Type.Boolean({ description: "true 时看已暂存的改动" })),
          path: Type.Optional(Type.String({ description: "只看这个文件或目录，相对工作区根目录", minLength: 1 })),
        },
        { additionalProperties: false },
      ),
      risk: "read",
      permissions: ["git:read"],
      requiresConfirmation: false,
      timeoutMs: 10_000,
      maxRetries: 2,
      idempotent: true,
      source: "local",
    },
    async handler({ args, signal }) {
      const target = optionalText(args, "path");
      if (target) sandbox.check(target);
      const argv = ["diff", ...(flag(args, "staged") ? ["--cached"] : []), "--", target ?? "."];
      const output = await git(sandbox, argv, signal);
      return output === "" ? "没有差异" : output;
    },
  };
}

async function git(sandbox: Sandbox, argv: string[], signal: AbortSignal | undefined): Promise<string> {
  const result = await sandbox.exec({ argv: ["git", ...argv], signal, timeoutMs: 10_000 });
  if (result.timed_out) throw new ToolRuntimeError("GIT_TIMEOUT", `git ${argv.join(" ")} 超时被终止`);
  if (result.exit_code !== 0) {
    throw new ToolRuntimeError("GIT_FAILED", result.stderr.trim() || `git ${argv.join(" ")} 退出码 ${result.exit_code}`);
  }
  const clip = clipHead(result.stdout, sandbox.rules.maxOutputChars);
  if (clip.truncated) return `${clip.text}\n[差异超过 ${sandbox.rules.maxOutputChars} 字符，已截断，用 path 参数缩小范围]`;
  return clip.text.trimEnd();
}
