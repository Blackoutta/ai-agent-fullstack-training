// 真实 Gateway 入口：让模型驱动同一条计划化 Loop。
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPlanningAgent } from "./agent-runner.js";
import { createExecutionContext } from "./run-context.js";
import { gatewayModel, models } from "./model.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function createWorkspace(): Promise<string> {
  const work = await mkdtemp(path.join(tmpdir(), "planning-run-"));
  await cp(
    path.join(PROJECT_ROOT, "fixtures", "demo-app"),
    path.join(work, "repo"),
    { recursive: true },
  );
  return work;
}

const controller = new AbortController();
const taskPrompt = process.argv.slice(2).join(" ") || undefined;
console.log("===== Planning Agent：开始执行 =====");
console.log(`提示词：${taskPrompt ?? "使用默认任务"}`);
const work = await createWorkspace();
console.log(`工作区：${work}`);
const executionContext = createExecutionContext({
  projectRoot: work,
  repoRoot: path.join(work, "repo"),
  artifactRoot: path.join(work, "artifacts"),
  runtimeRoot: PROJECT_ROOT,
});
const result = await runPlanningAgent({
  model: gatewayModel,
  streamFn: models.streamSimple.bind(models),
  signal: controller.signal,
  taskPrompt,
  executionContext,
  onText: (delta) => process.stdout.write(delta),
});

const plan = result.session.snapshot();

console.log("\n\n===== 运行结果 =====");
console.log(`运行 ID：${result.state.runId}`);
console.log(`执行轮数：${result.state.turn}`);
console.log(`停止原因：${result.state.stopCode ?? "自然结束"}`);
console.log(`代码版本：${result.runtime.getRevision()}`);
console.log(`读取文件：${[...result.state.evidence.readFiles].join("、") || "无"}`);
console.log(`写入产物：${[...result.state.evidence.writtenArtifacts].join("、") || "无"}`);

if (plan) {
  console.log(`计划版本：v${plan.version}`);
  console.log(`计划修订：${plan.revisions.length} 次`);
  console.log("步骤状态：");
  for (const step of plan.steps) {
    console.log(`  - ${step.id}：${step.status}，证据 ${step.evidenceIds.length} 条`);
  }
} else {
  console.log("计划：未创建");
}

console.log(`工具调用记录：${result.trace.length} 条`);
