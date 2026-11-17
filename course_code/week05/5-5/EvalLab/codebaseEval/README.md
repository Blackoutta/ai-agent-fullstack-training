# Codebase Eval

面向同级 `../codebase` 的本地 Agent 评测工作台。Vue 3 + TypeScript + Vite 界面，Python 标准库 API 与 SQLite，Node worker 复用现有 Codebase 的受治理 Agent Loop。

## 启动

需要 Python 3.10+、Node 22.19+ 和 npm。终端工作目录为 `codebaseEval`：

```sh
npm run setup
npm start
```

首次 `setup` 安装同级 Codebase 和前端的锁定依赖并构建界面；之后只需 `npm start`。访问 <http://127.0.0.1:8765>。只监听本机，不是外网部署方案。

没有模型凭据也可以先运行离线实验。真实实验需要在服务进程环境中设置策略指定的凭据变量，或在本目录被 Git 忽略的 `.env` 中配置。字段示例见 `.env.example`，**密钥不要填写到界面**。修改 `.env` 后重启服务。

```sh
EVAL_PORT=8766 EVAL_DATA_DIR=/absolute/private/eval-data npm start
```

默认数据保存于 `~/.codebase-eval`，不写入课程代码目录。这里包含 SQLite、冻结源码、每次运行工作区与治理账本；可能含私有源码，需按敏感数据保护。重启保留历史，将未结束运行标为 `interrupted`，不自动重跑收费实验。

## 使用流程

1. **Benchmark**：维护题目、标签、核心任务标记、程序检查和语义 rubric，支持 JSON 导入导出。
2. **策略配置**：维护系统 Prompt、模型、API 基址、凭据环境变量名、RAG 和每百万 Token 价格。缺失价格保留“未知”，不当作免费。
3. **实验工作台**：选择任务、策略、重复次数和预算。先用 `offline` 验证连接，再明确选择 `live` 运行真实模型。
4. **运行 Trace**：查看实际模型消息、工具事件、治理审计、检索片段、答案、检查结果和冻结快照。
5. **评审中心**：完成的 live 运行自动执行 LLM-as-Judge，也可重评；人工填写评审者、结论和理由，所有历史追加保留。
6. **评测概览 / 失败聚类**：查看成功率、已知费用与缺失计数、Token、耗时和工具调用，沿聚类样本 ID 回看证据。
7. **回归对比**：在同一个实验中选基线与候选，查看逐题改善、退化、未知及门禁，导出 Markdown / JSON。

内置三个源码审查任务和“直接审查 / BM25 证据优先”两条初始策略。它们是可编辑的起点，不是已经定标的 Golden Dataset；课程演示或团队使用应补充标准答案、边界任务与人工定标。

## 判定规则

- `completed` 只表示执行结束，不等于评测成功。
- 执行错误、取消、中断与离线回答的最终结果是 `unknown`。
- live 回答必须同时通过程序检查和 Judge 或人工语义评审才为 `pass`。人工通过不能覆盖程序失败或执行错误。
- 成功率分母包含 live 的失败和未知样本；离线样本单列，不混入真实成绩。
- Judge 使用与被评策略相同的模型、端点和凭据，是同模型自评，可能有偏差；重要结论仍需独立人工定标。评分器核对提供的证据，并不独立执行测试。
- 重复 Judge 的 Token、时间与已知费用累计计入运行成本。估算费用不是供应商账单。取消或超时保留已收到的用量，但总用量和总费用仍标未知。
- 回归只匹配同实验、同题目快照、同源码 hash、同 trial。缺配对、核心失败或未知、退化和离线实验均 `hold`。小样本通过不证明统计稳定性。
- “失败聚类”当前是基于错误和检查证据的规则分组，不是已验证的根因或语义 embedding 聚类。

## 当前边界

**只读源码评测**：worker 固定 reviewer / plan，仅开放 `list_files`、`search_code`、`read_file`、`read_directory`、`git_diff`、`git_status` 六个工具。不自动审批、不执行测试命令、不修复文件。它不是代码修改题的执行验收器，也不会对实际安全性作保证。

**源码范围**：每个实验先冻结源码，每个任务再复制独立工作区；禁用共享记忆。排除 `.env*`、密钥后缀、数据库、依赖/构建目录、`demos/reference` 与 `config/scripts`，拒绝符号链接。其他源码、注释或文档仍可能泄漏题目答案，建 Benchmark 时需自行审查。独立工作区不是操作系统安全沙箱，只运行可信本地仓库。

**检索与 Trace**：RAG 为本地 Markdown / YAML 分块的关键词或 BM25 检索，不是向量检索。Trace 记录模型消息、工具事件与治理证据，不保存思维链或完整供应商 HTTP 请求。长证据会在 Judge 输入中截断，证据不足须为未知。

**模型兼容**：使用 OpenAI-compatible Chat Completions 与流式工具调用。基址填写 API 根路径，例如 `https://api.deepseek.com` 或 `https://api.openai.com/v1`，不要加 `/chat/completions`。DeepSeek 官方端点使用专用兼容字段，其他端点走通用配置。已联网验证 DeepSeek；其他供应商、仅 Responses API 的模型以及特殊推理协议未逐一验收。

**规模与部署**：最多两个实验 worker、三个排队或运行实验；每实验内按任务交错策略顺序串行运行。实验上限 100 次运行，超时 10-600 秒，模型输出 Token 预算 256-16384；工具调用预算沿用 Codebase 治理配置。没有多用户身份认证、分布式队列、外网 TLS 或生产权限管理。

## 测试与结构

```sh
npm test
npm run test:bridge
npm run test:frontend
npm run check
npm run build
```

桥接 TypeScript 测试在同级 `codebase` 工作目录执行：

```sh
npm exec -- vitest run ../codebaseEval/bridge/worker.test.ts --root ..
```

- `requirements/platform.md`：用户功能与安全边界。
- `design/architecture.md`：架构与 API 契约。
- `backend/`：存储、运行调度、检索、评分、分析与 HTTP。
- `bridge/`：独立 Node 进程与现有 Runtime 的接入。
- `frontend/`：八个可交互区域与组件测试。
- `tests/`：后端和证据约束回归测试。
- `check/validation.md`：实际执行的验收结果与未覆盖项。

本次按课程根目录 `skills/` 中 PM、架构、后端、前端与测试角色的工作包流程实施；未改变原有 Skills。对 `codebase` 的改动仅为可选事件观察器、模型错误状态处理及供应商兼容配置和对应测试。
