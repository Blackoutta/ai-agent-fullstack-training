# Week 06

| 小节 | 主题 | 主要内容 |
| --- | --- | --- |
| 6-1 | 模型服务与推理部署 | 从数据不能出内网的约束出发，按显存选择模型与量化方案，用 vLLM 在 RTX 4080 32GB 上部署 Qwen3.8-27B；区分 Prefill/Decode、KV Cache、PagedAttention、连续批处理与 FlashAttention，完成驱动、Docker、NVIDIA Container Toolkit、模型权重与 OpenAI 兼容服务的启动和三层验证；再用 nvidia-smi、vLLM metrics 与压测观察 GPU、缓存和队列，理解 TTFT、ITL、TPOT、E2E 与吞吐，按 `max-model-len`、`max-num-seqs`、`max-num-batched-tokens`、显存预算逐项调优，并排查 Chat Template、Reasoning Parser、Tool Call Parser 等常见故障。 |
| [6-2](./6-2/) | 性能与成本优化 | 以采购合同问答为案例，用缓存、批处理/有界并发、模型路由与降级三类手段优化响应和成本：区分 Semantic、Embedding、RAG、Tool Result、Ingestion 与 Prompt Cache 的复用条件和失效边界；比较逐条串行、合批串行、合批并发，并用在线优先队列、配额和超时控制负载；通过 LiteLLM 把 `rag-fast`、`rag-capable`、`rag-reasoning` 映射到不同能力层，配置 fallback、冷却、限流与上下文超限处理，并明确“缓存命中、Token/s 更高”都不等于任务完成得更好。 |
| [6-3](./6-3/) | Agent 可观测性 | 用销售折扣问答系统演示一次“接口都成功但答案错了”的排查：给 Agent 接入客户资料、折扣政策、服务目录三个工具，用结构化日志按 `run_id`、`tool_call_id` 记录模型与工具调用；再用 Trace/Span 把检索、证据筛选、上下文组装和生成串起来，定位“相关性排序没有校验有效期、旧政策 P-old 挤掉当前政策 P-current”的偏差；最后用 Replay 固定问题、客户资料、业务时间和候选政策，先复现旧问题，再验证筛选修复、完整问答和真实依赖复测，并把失败材料加入回归集。 |
| [6-4](./6-4/) | 监控与告警 | 用订单查询 Agent 演示 Prometheus + Grafana 可观测性：按业务、Agent、模型、安全四层定义指标与各自分母，业务层看任务成功率与人工接管率，Agent 层看工具调用准确率、工具失败率与检索 Hit@3，模型层用 Histogram/Counter 看平均延迟与失败率，安全层关注权限拦截和敏感字段读取；通过 9464 端口的单一 Registry 暴露指标，Prometheus 每 5 秒抓取，Grafana 自动配置看板，并用 `increase()` 窗口增量写 PromQL、按失败率/延迟/成本/权限异常配置告警。 |
| [6-5](./6-5/) | 版本管理、灰度与回滚 | 把“发布版本”定义为一组经过评测的模型、Prompt、工具、Skill、RAG 与工作流配置，发布清单固定组件版本并让 Trace 记录实际加载的发布编号；用 Feature Flag 控制 stable/pilot 分组，发布前先跑回归、影子验证或金丝雀，明确扩量、保持、回切条件；回滚前确认稳定版容量和依赖，回切后分别验证新请求、在途任务和线上失败样本，并用 `release.py` 演示 A/B 两个 Skill 的路由、检查、发布、试点和回滚。 |
| [6-6](./6-6/) | 阶段六项目：Production Ready Agent Platform | 把前五周能力组合成可部署、可监控、可发布、可审计的平台：用一份 `docker-compose.yml` 统一拉起 gateway、codebase agent、Eval 平台、Langfuse、Prometheus/Grafana、LlamaIndex 检索与 Milvus Lite；补发布单与灰度回滚、回放、按租户/部门/模型/策略聚合的成本预算与报表、API Key 不入库、Trace/日志脱敏、租户与部门隔离，以及 TS/Python SDK；交付 `make up`、`make smoke`、`make cost`、`make verify-offline` 等可运行闭环，并明确离线模式、Milvus 单写者、无 K8s/CI 等边界。 |

## 6-1 目录说明

- 本节暂无配套课程代码目录，内容以课件中的 vLLM 部署命令、验证步骤、压测方法和调优参数为主；课件位于 `course_materials/week06/6-1.pdf`。

## 6-2 目录说明

- `1.py`：六种缓存对照（Semantic / Embedding / RAG / Tool / Ingestion / Prompt），统计命中前后请求数、阶段耗时、生成耗时与 Token，并把结果写入 `output/caches.json`。
- `2.py`：逐条串行、合批串行、合批并发三种调度方案对比，输出整批耗时、在线 P95、排队 P95、并发峰值与失败数。
- `3-1.py` / `3-2.py`：按任务选择逻辑模型能力层，以及服务故障/上下文超限的 fallback、冷却、限流演示；分别读取 `config/litellm.deepseek.yaml` 与 `config/litellm.fallback.yaml`。
- `lab/`：教学语料、检索编排、缓存与批处理、应用层缓存、有界调度器、环境变量读取，以及本机 BGE 编码/重排服务。
- `data/contracts.json`：采购合同教学语料；`output/`：运行生成的报告与日志；`config/local.env` 为本地凭证文件，已被 `.gitignore` 忽略，运行前需按 README 填写。

## 6-3 目录说明

- `6-3.zip`：销售智能问答的可观测性演示工程，按 zip 原名保留。为控制体积和避免泄露，已移除 `node_modules`、`.npm-cache`、`.DS_Store` 等依赖/缓存，并把 `config/local.env`、`config/langfuse.env` 中的真实密钥替换为占位值；运行前按包内 README 安装依赖并填写自己的凭证。
- 解压后 `1.ts`、`2.ts`、`3.ts` 分别对应日志、Trace、Replay 三个入口；`replay-once.ts` 可重跑历史材料；`src/` 包含运行环境、三个业务工具、证据筛选、观测扩展、JSONL 落盘、Langfuse 调用树和录制客户端；`tests/` 为 vitest 用例。
- `logs/`、`replays/`、`output/` 保存课程运行产生的结构化日志、复现材料与三份对照报告，可用于对照“检索 → 证据筛选 → 模型输入 → 最终答案”的偏差链。

## 6-4 目录说明

- `pi-monitor-demo.mts`：一轮跑完业务、Agent、模型三层样本；`demo` 与 `demo:serve` 分别对应单轮和常驻轮询。
- `src/`：`registry.mts` 共用指标注册表，`business-metrics.mts` 负责任务结算与人工队列，`agent-metrics.mts` 记录工具选择、执行与检索命中，`model-metrics.mts` 记录模型延迟与结果，`metrics-server.mts` 在 9464 端口暴露 `/metrics`。
- `monitoring/`：Prometheus 抓取配置、Grafana 数据源/看板 provisioning、`docker-compose.yml` 与 `query-metrics.mts` 查询脚本；`env.example` 为端口和演示参数示例。

## 6-5 目录说明

- `release.py`：版本管理、灰度与回滚演示入口，支持 `run`、`check`、`publish`、`rollback`、`status` 子命令；`--offline` 只排练路由与版本选择，不调用模型。
- `releases/a/response-contract/SKILL.md` 与 `releases/b/response-contract/SKILL.md`：两个使用同一模型、但输出契约不同的 Skill 版本（A 返回纯文本 `READY`，B 返回 JSON），用于观察程序实际加载了哪一版；运行产生的本地路由文件不随仓库发布。

## 6-6 目录说明

- `6-6.zip`：阶段六完整平台工程，按 zip 原名保留。为控制体积，已移除 `node_modules`、`.npm-cache`、`__pycache__`、`.DS_Store` 等依赖/缓存，并移除只含本机占位值的 `.env`；解压后先复制 `.env.example` 为 `.env`，按需填写 `DEEPSEEK_API_KEY`，无密钥时走离线模式。
- `services/`：`gateway`（LiteLLM + DeepSeek-flash）、`agent`（Node 服务、SSE、运行归档、回放、脱敏、指标）、`retrieval`（LlamaIndex 向量/BM25/Hybrid 检索与租户过滤）、`eval`（5-5 评测工作台容器化）、`platform`（发布单、路由、预算、成本报表、审计、身份）。
- `codebase/`、`codebaseEval/`：5-5 的 Codebase Agent 与 Eval 平台快照；`sdk/ts/`、`sdk/python/`：统一错误体、重试与 SSE 的薄客户端；`deploy/`、`docs/openapi.yaml`、`design/`、`requirements/`、`check/` 提供部署、契约、架构、需求与验收证据。
- 平台入口与边界以包内 `README.md` 为准：默认本机 Docker 编排，不包含 K8s/CI、外网 TLS、用户注册登录、Milvus 集群和多副本水平扩展；无密钥运行标记 `offline`，不计入真实成功率。
