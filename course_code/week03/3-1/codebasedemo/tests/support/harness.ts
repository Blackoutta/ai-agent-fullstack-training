// 测试脚手架：为基座层提供隔离的工程根 / 产物目录，并预留执行上下文注入点。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createExecutionContext,
  type DemoExecutionContext,
} from "../../src/run-context.js";
import {
  DemoToolRuntime,
  type ManagedToolResult,
} from "../../src/runtime.js";

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// 真实目标仓库：与工程同级的 login_demo（不复制、不伪造示例仓库）。
export const DEFAULT_REPO_ROOT = path.join(WORKSPACE_ROOT, "login_demo");

export interface TestHarness {
  readonly context: DemoExecutionContext;
  readonly runtime: DemoToolRuntime;
  invoke(
    toolName: string,
    args?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<ManagedToolResult>;
  readArtifact(relativePath: string): Promise<string>;
  cleanup(): Promise<void>;
}

// 组合入口：默认使用临时工程根 + 真实 login_demo，overrides 逐字段可替换（注入点）。
export async function createTestHarness(
  overrides: Partial<DemoExecutionContext> = {},
): Promise<TestHarness> {
  const projectRoot = overrides.projectRoot
    ?? await mkdtemp(path.join(tmpdir(), "codebase-agent-"));
  const context = createExecutionContext({
    ...overrides,
    projectRoot,
    repoRoot: overrides.repoRoot ?? DEFAULT_REPO_ROOT,
    artifactRoot: overrides.artifactRoot ?? path.join(projectRoot, "artifacts"),
  });
  const runtime = new DemoToolRuntime();
  let sequence = 0;

  return {
    context,
    runtime,
    invoke(toolName, args = {}, options = {}) {
      sequence += 1;
      return runtime.invoke({
        toolCallId: `test-call-${sequence}`,
        modelName: toolName,
        args,
        context,
        signal: options.signal,
      });
    },
    readArtifact(relativePath) {
      return readFile(path.join(context.artifactRoot, relativePath), "utf8");
    },
    cleanup() {
      return rm(projectRoot, { recursive: true, force: true });
    },
  };
}
