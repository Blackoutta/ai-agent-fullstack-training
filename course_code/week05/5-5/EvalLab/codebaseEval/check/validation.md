# 验收记录

验证日期：2026-10-30。环境：macOS、本机 Python / Node、本地单体。没有统计代码覆盖率，没有外网部署验收。

## 自动化验证

|范围|命令|实际结果|
|---|---|---|
|后端、HTTP 与证据契约|`npm test`|39 项通过|
|Python 进程桥接|`npm run test:bridge`|4 项通过|
|Vue 组件与工作流|`npm run test:frontend`|28 项通过|
|Vue strict 类型|`npm run check`|通过|
|前端生产构建|`npm run build`|通过|
|Node 治理 worker|在 codebase 执行 `npm exec -- vitest run ../codebaseEval/bridge/worker.test.ts --root ..`|8 项通过|
|Codebase 类型|在 codebase 执行 `npm run check`|通过|
|Codebase 全量单元测试|在 codebase 执行 `npm test`|132 项通过，1 项旧样例路径缺失失败|

Codebase 失败项为 `tests/unit/kg_eval.test.ts`：原 `src/eval.ts:136` 复制 `../samples/2_bug_fix/demo-app` 时抛出 `ENOENT`。没有补造样例、跳过测试或修改旧评估器来掩盖失败。新增事件观察器 3 项与供应商配置 4 项均通过。

新增证据回归覆盖：SSE 缺少 DONE、非法 JSON、不存在的证据键、非法 usage、缓存计价、重复 Judge 费用/Token/时间累计、超时部分用量保留、参考答案和脚本排除、删光任务后不重新 seed。

## 浏览器与 API

- 浏览器完成离线两策略实验 `1156220f509e4da6`，2/2 执行完成；Trace 显示真实 Runtime 的 `read_file` 与审计，最终结果保持 unknown。
- 浏览器回归页面显示同题 1/1 配对、unknown=1、hold；Markdown 按钮请求成功并出现导出提示。
- 独立 HTTP 请求确认 Markdown 报告包含门禁、题目、基线/候选与证据运行 ID。浏览器工具无法确认下载文件实际落盘，因此不宣称文件下载端到端验收完成。
- 重启后浏览器快照显示本地服务已连接与历史实验保留。追加人工评审的浏览器操作因 IDE WebView 超时未完成；人工历史、结果优先级由后端与前端组件测试覆盖。
- HTTP 同源、防跨站请求、任务导入校验已测试。没有多用户认证或真实外网攻击测试。

## 实际联网运行

凭据来自已配置本机环境，未打印或写入评测数据库。以下两次调用产生真实模型消耗，价格未配置，所以费用为 null。

### 权限边界与预算

- 实验：`cb1e4b8ab65d4ae4`；运行：`0ec4da3f162d4098`。
- DeepSeek 实际工具调用 12 次，工具错误 0。
- 执行 `error`，停止原因 `MAX_TOOL_CALLS`，最终 unknown；没有将实验 completed 当作模型成功。
- 保存真实 usage，Agent Token 累计 27815；未执行 Judge。

### 单文件回答与自动 Judge

- 实验：`acea4b9f854b495a`；运行：`91004a33b08647b8`。
- 模型执行 completed，一次 read_file、工具错误 0，回答非空，两个程序检查通过。
- 自动 Judge 成功返回结构化 unknown，指出提供的读取证据截断，无法核实部分行号；这不是模型成功样本或人工定标结论。
- Agent + Judge Token 累计 46886，Judge Token 42468，合计耗时 8.5434 秒。
- 保存 requested model、served model、评分理由、证据键、输入 hash、usage 和评分历史；供应商未返回 request ID 时保留 null。
- 真实 API 只验证 DeepSeek。其他 OpenAI-compatible 供应商仅验证配置分支，不声称全供应商兼容。

## 交付范围与剩余边界

R1-R9 已有可运行实现：题库与自动实验、策略对比、Trace、Judge 与人工评审、统计、规则失败聚类、改进比较与回归导出。

当前定位为可信本地 Codebase 的只读审查评测，不包含代码修改题、测试命令执行、向量检索、独立 Judge 模型选择、分布式调度或生产部署。未验证真实模型通过率、统计显著性或稳定改善，离线与未知不会放行回归门禁。详见根 README。
