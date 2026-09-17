// 演示入口：调用 runCodebaseAgent 并打印运行结果。
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCodebaseAgent, type AgentMode } from "./agent-runner.js";
import { createExecutionContext } from "./run-context.js";
import { gatewayModel, models } from "./model.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function createWorkspace(): Promise<string> {
  const work = await mkdtemp(path.join(tmpdir(), "codebase-run-"));
  await cp(
    path.join(PROJECT_ROOT, "fixtures", "demo-app"),
    path.join(work, "repo"),
    { recursive: true },
  );
  return work;
}

const controller = new AbortController();
const taskPrompt = process.argv.slice(2).join(" ") || undefined;
const mode: AgentMode = process.env.CODEBASE_MODE === "repair" ? "repair" : "understanding";

console.log("===== Codebase Agent：开始执行 =====");
console.log(`模式：${mode === "repair" ? "修复" : "代码理解"}`);
console.log(`提示词：${taskPrompt ?? "使用默认任务"}`);
const work = await createWorkspace();
console.log(`工作区：${work}`);
const executionContext = createExecutionContext({
  projectRoot: work,
  repoRoot: path.join(work, "repo"),
  artifactRoot: path.join(work, "artifacts"),
  runtimeRoot: PROJECT_ROOT,
});
const result = await runCodebaseAgent({
  model: gatewayModel,
  streamFn: models.streamSimple.bind(models),
  mode,
  signal: controller.signal,
  taskPrompt,
  executionContext,
  onText: (delta) => process.stdout.write(delta),
});

console.log("\n\n===== 运行结果 =====");
console.log(`运行 ID：${result.state.runId}`);
console.log(`执行轮数：${result.state.turn}`);
console.log(`停止原因：${result.state.stopCode ?? "自然结束"}`);
console.log(`读取文件：${[...result.state.evidence.readFiles].join("、") || "无"}`);
console.log(`写入产物：${[...result.state.evidence.writtenArtifacts].join("、") || "无"}`);
console.log(`工具调用记录：${result.trace.length} 条`);
