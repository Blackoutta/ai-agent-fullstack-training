# Codebase Agent Demo


## 结构

- `src/model.ts`：通过 OpenAI-compatible Gateway 注册 `pi` 模型。
- `src/runtime.ts`：代码库工具的受控执行入口，限制读取范围并只允许写入 `artifacts/`。
- `src/pi-tools.ts`：将 Runtime 工具适配为 `pi` 的 `AgentTool`。
- `src/loop-guard.ts`：最大轮数、重复动作、完成证据和 Follow-up 控制。
- `src/agent-runner.ts`：装配 `runAgentLoop`，并输出以 `runId`、`turn`、`toolCallId` 为核心的执行轨迹。
- `tests/loop.test.ts`：用 `pi-ai` faux provider 进行脚本化 TDD 验收。

## 安装与验证

```bash
npm install --legacy-peer-deps
npm run build
npm test
```

## 真实 Gateway 演示

```bash
export GATEWAY_BASE_URL="http://127.0.0.1:8000/v1"
export GATEWAY_API_KEY="<阶段一 Gateway Key>"
npm run start
```

## 测试
```bash
npm test -- --reporter=verbose
```