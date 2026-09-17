// CLI 入口：用 Gateway 逻辑模型启动 Agent。
// 只负责启动与输出；Prompt、工具、循环保护与 Loop 配置全部来自装配层。
import { runCodebaseAgent } from "./agent-runner.js";
import { gatewayModel, models } from "./model.js";

const controller = new AbortController();

const result = await runCodebaseAgent({
  model: gatewayModel,
  streamFn: models.streamSimple.bind(models),
  signal: controller.signal,
  // 模型文本增量写入标准输出。
  onText: (delta) => process.stdout.write(delta),
});

process.stdout.write("\n");
console.log(JSON.stringify({
  runId: result.state.runId,
  turns: result.state.turn,
  stopReason: result.state.stopReason,
  readFiles: [...result.state.evidence.readFiles],
  writtenArtifacts: [...result.state.evidence.writtenArtifacts],
  trace: result.trace,
}, null, 2));
