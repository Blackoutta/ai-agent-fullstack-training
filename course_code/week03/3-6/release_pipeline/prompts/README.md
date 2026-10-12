# prompts/ — SDD 提示词模板套件

本目录是一套**可复用的生成契约**，用于让 AI 按统一规范反复生成 LangGraph 工程。

## 文件清单

| 文件 | 用途 | 何时使用 |
|---|---|---|
| `SDD-TEMPLATE.md` | 空白模板（10 节） | 启动一个新工程时复制并填写 |
| `SDD-release-pipeline.md` | 完整填写样例（方案 A） | 学习如何填写每一节 |
| `BOUNDARY-PROTOCOL.md` | 5 条硬约束 + 违规协议 | 每次生成都必须一起喂给 AI |
| `GENERATION-ORDER.md` | 14 阶段强制顺序 + 单文件重做 | 每次生成都必须一起喂给 AI |
| `QUICKSTART.md` | 5 分钟极简版（只填 4 节） | 原型验证、教学演示 |

## 标准工作流

### 完整模式（推荐用于交付）

```
1. cp SDD-TEMPLATE.md SDD-<新场景>.md
2. 填写 §0-§9（重点：§3 State、§4 Nodes、§9 Out of Scope）
3. 把以下 3 个文件一起喂给 AI：
   - SDD-<新场景>.md
   - BOUNDARY-PROTOCOL.md
   - GENERATION-ORDER.md
4. AI 按 14 阶段逐文件产出；每个文件后你核对自检清单回复 OK
5. 全部产出后跑 pytest tests/test_acceptance.py 验收
```

### 极简模式（原型/教学）

```
1. 打开 QUICKSTART.md，按"最小提示词"模板填 4 节
2. 连同 BOUNDARY-PROTOCOL.md + GENERATION-ORDER.md 一起喂给 AI
3. AI 用默认值补全未声明节，并在每处标注 [DEFAULT]
4. 事后按需把 [DEFAULT] 项升级为完整 SDD 节
```

### 单文件重做

```
任意时刻输入：redo <文件名> [原因]
AI 只重做该文件，其余保持不变；若签名冲突触发 BOUNDARY_VIOLATION
```

## 复用范围

✅ 适用：
- LangGraph 单图工程（StateGraph + 节点 + 边 + interrupt + checkpointer）
- 教学示例、原型验证、内部工具
- 方案 A/B/C 等审批类工作流

❌ 不适用：
- 多 Agent 协作图（需要扩展 §4 为"Agent 清单"+ §5 为"消息路由"）
- LangChain `create_agent` / AgentExecutor 高层入口
- CrewAI / AutoGen / OpenAI Agents SDK
- 需要 Web UI 或前后端分离的工程

## 模板自身的版本管理

修改本目录任意文件时，请在文件头部追加：

```
<!-- version: YYYY-MM-DD -->
<!-- change: 一句话说明 -->
```

旧 SDD 文件继续按其生成时的模板版本解释；不强制升级。
