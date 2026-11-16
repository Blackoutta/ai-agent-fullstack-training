# 6.2 性能与成本优化：四个演示入口

使用同一个虚构采购合同案例：今年上限 8%、去年 10%，计算基数都是合同总额，变化为 -2 个百分点。四个入口默认调用真实服务，只有显式加 `--fixture` 时才切换为确定性机制夹具。

## 目录

| 路径 | 用途 |
| --- | --- |
| `1.py` | 对照 Semantic / Embedding / RAG / Tool / Ingestion / Prompt 六种缓存 |
| `2.py` | 逐条串行、合批串行、合批并发三种调度方案的对比 |
| `3-1.py` | 按任务选择能力层：应用只发逻辑模型名，网关决定落到哪个部署 |
| `3-2.py` | 服务出错与上下文超限时的备用路径 |
| `lab/teaching.py` | 教学语料、检索编排、缓存与批处理实验的实现 |
| `lab/caching.py`、`lab/scheduler.py` | 应用层缓存策略、有界调度器 |
| `lab/env.py`、`lab/local_service.py` | 自动读取 `config/local.env`、按需拉起本机编码服务 |
| `lab/local_embedding_service.py` | 本机 OpenAI 兼容编码 + 重排服务（bge-small-zh-v1.5） |
| `config/local.env` | 全部环境变量与应用凭证 |
| `config/litellm.deepseek.yaml` | `3-1.py` 使用的网关配置（三个逻辑模型名） |
| `config/litellm.fallback.yaml` | `3-2.py` 使用的网关配置（fallbacks / 冷却 / 限流） |
| `data/contracts.json` | 教学语料，`teaching.py` 直接读取 |
| `output/` | 运行时生成的报告与日志，脚本自动创建 |

## 安装与配置

Python 3.12+，在本工程根目录运行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

编辑 `config/local.env` 填写真实端点与凭证。入口脚本会自动读取该文件（**已存在的环境变量优先**），新开终端不必先 `source`：

```bash
set -a
. config/local.env
set +a
```

`lab/local_embedding_service.py` 另需 `torch`、`transformers`、`fastapi`、`uvicorn`，`3-1.py` / `3-2.py` 需要 `pyyaml`，`requirements.txt` 未包含这几项，缺包时手工补装。

### 本机编码/重排服务

`1.py`、`2.py` 需要 `rag-embedding` 编码别名与 `RERANK_URL` / `RERANK_MODEL`。编码、重排可以配成独立端点（`EMBEDDING_API_BASE` / `EMBEDDING_API_KEY` / `RERANK_API_KEY`），不配时沿用生成端点的地址与凭证。

编码端点是 `127.0.0.1` 时，脚本会按 `EMBEDDING_AUTOSTART=1` 自动拉起本机服务并在退出时关闭；手工启动的服务会被原地复用，不会被关：

```bash
python -m lab.local_embedding_service        # 默认 127.0.0.1:8012
```

该服务是 bge-small-zh-v1.5 的 CPU 推理，重排是与编码器同一向量的余弦排序，不是 cross-encoder，不代表生产级相关性判断。

### 直连 DeepSeek 的配置要点

`config/local.env` 里对应三项：`LITELLM_API_BASE=https://api.deepseek.com`、`DEMO_CHAT_MODEL=deepseek-flash`、`EMBEDDING_API_BASE` 与 `RERANK_URL` 指向 `127.0.0.1:8012`。

deepseek-flash 是推理模型，思考 token 计入 `max_tokens`，而且同一请求的思考长度会波动；被截断时脚本直接报错并带上实际思考 token。用 `DEMO_MAX_TOKENS` 给足预算，或用 `DEMO_REASONING_EFFORT=low`（支持 low/high/max）降档。

生成、编码与重排必须真的部署：脚本不下载模型，也不会自动以夹具替代连接失败的服务。

## 1.py：分别观察不同缓存

```bash
python 1.py                     # 六种缓存依次对照
python 1.py --cache embedding   # 只讲一层：semantic / embedding / rag / tool / ingestion / prompt
python 1.py --repeat 5          # 每个状态采样 5 次取中位数
python 1.py --fixture           # 确定性夹具，不调用模型
```

每层表格分三段：前七列是**计数证据**，命中时必须归零，这是判断缓存生效的主判据；`缓存阶段ms` 与 `生成ms` 把端到端耗时拆开（缓存只影响前者，生成永远要跑）；最后一列 `相对关闭` 直接写差量。默认 `--repeat 3`，之后依次输出 `阶段ms` / `生成ms` 中位数与极差、`阶段对比` 条形图。结果同时写入 `output/caches.json`。

- **Semantic**：对比未缓存 FAQ 与预先人工审阅发布的答案，相似度查找用实际编码服务；未达阈值就继续检索生成，不伪造命中。预发布本身的编码与人工成本不计入在线请求。
- **Embedding**：模拟同一批文档重复入库并提问，比较编码请求数与编码文本数。开启首轮从空缓存开始，复用轮跳过已有向量计算。
- **RAG**：缓存完整召回与重排阶段，命中后仍授权回填、重新生成答案。
- **Tool**：每次先授权，只有指定版本正文读取可被跳过。
- **Ingestion**：运行原生 `IngestionPipeline`，统计切分、编码次数及输出节点数。
- **Prompt**：由推理服务前缀缓存决定，比较“首次请求／重复前缀”；夹具模式下明确显示“未测”。耗时下降不能单独证明命中，没有服务端 usage 里的缓存读取 Token 就显示“未知”。

生成 Token 只统计当前阶段生成接口返回的输入/输出 usage，不含编码 Token；初始化索引、FAQ 发布不计入在线请求。每轮答案均通过教学数值、当前授权、来源版本和逐字引用检查，真实模型答错会报“执行未完成”。缓存与 ACL 是单进程教学实现，生产多租户鉴权与分布式共享需另外建设。

## 2.py：批处理与并发前后对比

```bash
python 2.py
python 2.py --concurrency 4 --batch-size 8 --queue-timeout 30 --request-timeout 90 --deadline 400
python 2.py --fixture           # 固定延迟只验证调度，不代表模型或 GPU 性能
```

三组都处理 40 个后台片段 + 4 次相互独立的在线合同对比，关闭应用缓存，索引准备不计入任务耗时：

1. 逐条串行：批大小 1，并发 1。
2. 合批串行：批大小 8，并发 1，观察合批本身的变化。
3. 合批并发：批大小 8，并发 4，后台最多占 2 个执行位置，在线优先。

默认值按“远端推理模型单次生成 3–4 秒”校准；本地 GPU 服务可收紧为 `--queue-timeout 2 --request-timeout 12 --deadline 30`，用来看排队过期路径。计数发生在真正的编码、重排和生成调用处，三者共用一个有界调度器，不只限制 Agent 数量。

输出整批耗时、成功在线请求 P95、排队 P95、实际并发峰值、后台峰值、完成数与失败数，以及合同答案。任何失败都保留计数且进程以非零状态退出。P95 只来自本次 4 个在线样本，是课堂演示值。

## 3-1.py：按任务选择能力层

```bash
python 3-1.py                          # metadata / qa / compare
python 3-1.py --tasks metadata,conflict,synthesis
python 3-1.py --fixture                # 离线演示选层与请求负载
```

脚本自己读 `config/litellm.deepseek.yaml` 并拉起 LiteLLM 网关（首次加载约 20–30 秒），退出时关闭本次启动的网关，已在运行的同配置网关原地复用：

| 逻辑模型名 | 部署 | 典型任务 |
| --- | --- | --- |
| `rag-fast` | deepseek-flash | 分类、查询改写、元数据抽取 |
| `rag-capable` | deepseek-flash | 常规证据问答 |
| `rag-reasoning` | deepseek-v4-pro | 跨版本比较、矛盾分析、综合判断 |

应用只发逻辑模型名，落到哪个部署由网关决定。网关启动需要 `DEEPSEEK_API_KEY`（或 `LITELLM_API_KEY`）与 `LITELLM_MASTER_KEY`；端口用 `--port` 或 `DEMO_GATEWAY_PORT` 指定，默认 4000。

每次结果都会输出耗时、应用发送的 model、该层实际部署、Token，以及确定性校验（证据数字是否复述、是否引到第八条、JSON 是否可解析）；语义与推导仍需人工验收。

## 3-2.py：故障与上下文超限的备用路径

```bash
python 3-2.py
python 3-2.py --port 4001 --timeout 60
```

脚本读 `config/litellm.fallback.yaml` 并拉起网关，两条请求只换模型别名，Python 里没有故障切换逻辑：

- `rag-fast`：正常由 Flash 处理；
- `rag-failure-test`：先打本机未监听端口 `127.0.0.1:65530`，再由网关按 `fallbacks` 切到 `rag-reasoning`。

必需变量 `FLASH_API_BASE`、`FLASH_API_KEY`、`PRO_API_BASE`、`PRO_API_KEY`，未单独配置时自动从 `LITELLM_API_BASE` / `LITELLM_API_KEY` 派生。输出内容包括返回模型字段判定、备用目标、执行路径对照表、`num_retries` / `max_fallbacks` / `allowed_fails` / `cooldown_time` 配置要点、部署级限流，以及网关日志里的 fallback 旁证。故障别名没有真的切到备用部署时脚本报错退出。

上下文超限路径默认未启用（`context_window_fallbacks` 在配置文件里注释着）：超限要先向应用暴露可识别的错误，去重、删减无关证据后仍放不下才切窗口更大的部署。冷却只是暂时避开故障节点，不代表已恢复。

## 无模型时验证机制

```bash
python 1.py --fixture
python 2.py --fixture
python 3-1.py --fixture
```

夹具使用确定性向量、受控答案和固定异步等待，终端会明确标注；它仍实际运行 LlamaIndex 索引、摄入缓存和调度器，但不证明模型质量、GPU 性能或 Prompt Cache 命中。
