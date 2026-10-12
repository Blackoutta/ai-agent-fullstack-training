import type { PlatformConfig } from "../config.js";
import type { ManagedTool } from "../domain.js";
import type { Sandbox } from "../sandbox.js";
import { createGitDiffTool, createGitStatusTool } from "./git.js";
import { createListFilesTool, createReadDirectoryTool, createReadFileTool, createSearchCodeTool } from "./fs-read.js";
import { createApplyPatchTool, createWriteFileTool } from "./fs-write.js";
import { createRunCommandTool, createRunTestTool } from "./exec.js";

/** 十件仓库工具：六件读、两件写、两件执行，risk 直接决定策略与审批分支。 */
export function createRepoTools(config: PlatformConfig, sandbox: Sandbox): ManagedTool[] {
  return [
    createListFilesTool(sandbox),
    createSearchCodeTool(sandbox),
    createReadFileTool(sandbox),
    createReadDirectoryTool(sandbox),
    createWriteFileTool(sandbox),
    createApplyPatchTool(sandbox),
    createRunTestTool(sandbox, config),
    createRunCommandTool(sandbox, config),
    createGitDiffTool(sandbox),
    createGitStatusTool(sandbox),
  ];
}
