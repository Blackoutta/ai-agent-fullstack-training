// 演示入口：调用 runCodebaseAgent 并打印运行结果。
import { runCodebaseAgent } from "./agent-runner.js";
import { gatewayModel, models } from "./model.js";

const controller = new AbortController();
const result = await runCodebaseAgent({
  model: gatewayModel,
  streamFn: models.streamSimple.bind(models),
  signal: controller.signal,
  onText: (delta) => process.stdout.write(delta),
});

console.log("\n", {
  runId: result.state.runId,
  turns: result.state.turn,
  stopCode: result.state.stopCode,
  readFiles: [...result.state.evidence.readFiles],
  writtenArtifacts: [...result.state.evidence.writtenArtifacts],
  trace: result.trace,
});
