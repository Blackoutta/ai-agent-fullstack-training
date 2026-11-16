# Pi 订单查询 Agent 监控演示

用同一个订单查询案例，演示如何为一个 Pi Agent 建立可观测性。业务后端把每一层的执行结果记成 Prometheus 指标，Grafana 自动出图。

监控分三层看同一个 Agent：

| 层 | 回答什么 | 分母 |
|---|---|---|
| 业务 | 用户的事办成了吗？多少任务转人工？ | 任务数 |
| Agent | 工具选对了吗？执行失败吗？检索命中吗？ | 工具调用次数 |
| 模型 | 一次调用要等多久？多少以错误结束？ | 模型调用次数 |

三层的分母各不相同，混用会算出错误结论。

## 快速开始

需要 Node.js 22.19.0+、Docker 和 Docker Compose。

```bash
npm ci

# 1. 启动监控栈（Prometheus + Grafana）
npm run prom:up

# 2. 跑演示：每 30 秒一轮，计数器累加，Grafana 持续可见
npm run demo:serve
```

然后打开：

- **Grafana 看板** <http://127.0.0.1:3000> — 免登录，直接进入「订单查询 Agent 监控」
- **Prometheus** <http://127.0.0.1:9092> — 查原始指标

看板每 5 秒刷新。跑过一轮后，七张卡片会稳定显示：

```
业务    任务成功率 20.0%      人工接管率 40.0%
Agent   工具准确率 83.3%      工具失败率 16.7%      检索命中率 50.0%
模型    平均延迟 301 ms       调用失败率 20.0%
```

## 命令一览

| 命令 | 作用 |
|---|---|
| `npm run prom:up` | 启动 Prometheus + Grafana |
| `npm run prom:down` | 停止（保留时序数据） |
| `npm run prom:status` | 查看容器状态 |
| `npm run prom:query` | 一条命令查完七项指标 |
| `npm run demo` | 跑一轮，逐条打印样本后保持 60 秒 |
| `npm run demo:serve` | 常驻，默认每 30 秒一轮 |

`demo` 与 `demo:serve` 都是三层一起跑，区别只在是否循环。第一次看建议先跑 `npm run demo` 读逐条样本，再看 `demo:serve` 的看板。

改轮询间隔：

```bash
DEMO_INTERVAL_SECONDS=10 npm run demo:serve
```

## 演示了什么

每一轮跑两组样本，共同覆盖三层：

| 样本 | 发生什么 | 影响哪层 |
|---|---|---|
| `ok` | 正常查询，通过验收 | 业务成功 |
| `wrong-tool` | 模型调了退款工具而非物流工具 | Agent 准确率算错 |
| `tool-timeout` | 选对工具但接口超时 | 准确率算对、失败率算失败、转人工 |
| `retrieval-miss` | 检索正常返回但缺配送规则 | 检索计入分母、未命中 |
| `model-error` | 模型调用失败 | 转人工 |
| `model-100~400ms` | 四次正常返回 | 模型延迟样本 |
| `model-500ms-timeout` | 一次超时 | 模型失败率分子 |

`npm run demo` 会逐条打印这些样本，方便对照看板。

## 口径说明

三个指标各自的分母是本演示的核心，也是最容易搞错的地方。

### 业务层

| 计数器 | 什么时候加一 |
|---|---|
| `order_query_completed_total` | 一条有效查询进入终态 |
| `order_query_success_total` | 这条查询通过业务验收 |
| `order_query_handoff_total` | **人工队列确认接收**才加一 |

`settleQuery()` 统一结算，保证一条查询只计一次——即使调了多个工具，业务层分母仍是任务数。

### Agent 层

| 指标 | 分母 | 归因 |
|---|---|---|
| 工具调用准确率 | 有标注可对照的调用 | 选择与标注一致计对 |
| 工具失败率 | 已结束的调用（`toolCallId` 配对） | 抛错计失败 |
| 检索命中率 Hit@3 | 成功返回且有标准证据的检索 | 前三条含 `KB-SHIP-01` 计命中 |


### 模型层

| 指标 | 类型 | 说明 |
|---|---|---|
| `agent_model_call_duration_seconds` | Histogram | 每次正常返回或错误结束的耗时（秒） |
| `agent_model_calls_total` | Counter | 按 `outcome` = `success` / `error` / `cancelled` |


## Grafana 看板

数据源和看板全部通过 provisioning 自动配置，**不需要手工添加**：

- `monitoring/grafana/provisioning/datasources/prometheus.yml` — 数据源指向 `http://prometheus:9090`
- `monitoring/grafana/provisioning/dashboards/provider.yml` — 看板目录挂载
- `monitoring/grafana/dashboards/pi-query-monitoring.json` — 看板定义


### 看板与 PromQL 对照

所有查询都限定 `job="order-backend"` 和同一个时间窗口（默认 5m）：

| 卡片 | PromQL |
|---|---|
| 任务成功率 | `sum(increase(order_query_success_total{job="order-backend"}[5m])) / sum(increase(order_query_completed_total{job="order-backend"}[5m]))` |
| 人工接管率 | `sum(increase(order_query_handoff_total{job="order-backend"}[5m])) / sum(increase(order_query_completed_total{job="order-backend"}[5m]))` |
| 工具调用准确率 | `sum(increase(agent_tool_calls_correct_total{job="order-backend"}[5m])) / sum(increase(agent_tool_calls_checked_total{job="order-backend"}[5m]))` |
| 工具失败率 | `sum(increase(agent_tool_calls_failed_total{job="order-backend"}[5m])) / sum(increase(agent_tool_calls_finished_total{job="order-backend"}[5m]))` |
| 检索命中率 Hit@3 | `sum(increase(agent_retrieval_hits_total{job="order-backend"}[5m])) / sum(increase(agent_retrieval_checked_total{job="order-backend"}[5m]))` |
| 模型平均延迟 | `sum(increase(agent_model_call_duration_seconds_sum{job="order-backend"}[5m])) / sum(increase(agent_model_call_duration_seconds_count{job="order-backend"}[5m]))` |
| 模型调用失败率 | `sum(increase(agent_model_calls_total{job="order-backend",outcome="error"}[5m])) / (sum(increase(...{outcome="success"}[5m])) + sum(increase(...{outcome="error"}[5m])))` |

外层 `sum()` 用于聚合掉 `tool`、`evidence` 等标签，否则多序列无法相除。想看是哪个工具拉低了准确率，把 `sum` 换成 `sum by (tool)`。

不用记这些长语句，直接跑：

```bash
npm run prom:query
```

## 架构

```
pi-monitor-demo.mts            一条命令跑三层
  ├─ src/business-metrics.mts  业务层计数器 + 人工队列
  ├─ src/agent-metrics.mts     Agent 层六个计数器
  ├─ src/model-metrics.mts     模型层 Histogram + Counter
  ├─ src/registry.mts          三层共用的单一 Registry
  └─ src/metrics-server.mts    9464 端口暴露 /metrics
        ↓
   Prometheus (9092)  ← 每 5s 抓取
        ↓
   Grafana (3000)     ← 看板自动配置
```

三层指标共用 9464 端口和同一个 Registry，因此 Prometheus 只需一个 `order-backend` 采集任务。

### 采集目标

| job | 目标 | 说明 |
|---|---|---|
| `prometheus` | `localhost:9090` | 自身运行指标 |
| `order-backend` | `host.docker.internal:9464` | 业务层与 Agent / 模型层指标 |
| `pi-session` | file_sd 自动发现 | `pi-prometheus` 扩展的 `pi_*` 会话指标 |
| `node-exporter` | `node-exporter:9100` | 宿主机负载、内存、磁盘 |

`pi-session` 的采集地址由 `pi-prometheus` 扩展写入 `~/.pi/metrics/targets/*.json`。扩展写的是 `127.0.0.1:端口`，而 Prometheus 跑在容器内，看到的 `127.0.0.1` 是容器自己，因此配置里用 `relabel_configs` 改写成 `host.docker.internal`，端口不变。

## 端口

| 端口 | 用途 |
|---|---|
| `3000` | Grafana |
| `9092` | Prometheus（容器内仍是 9090） |
| `9100` | node-exporter |
| `9464` | 订单查询 Demo 的 `/metrics` |

9090 常被本机其他服务占用，因此 Prometheus 对外用 9092。本机 9090 空闲的话，改 `monitoring/docker-compose.yml` 里的映射即可。

## 常见问题

**重置全部数据**

```bash
npm run prom:down
docker compose -f monitoring/docker-compose.yml down -v
```

## 源码入口

| 接入点 | 代码位置 | 说明 |
|---|---|---|
| 指标 Registry | `src/registry.mts` | 三层共用的单一 Registry |
| 业务任务结算 | `src/business-metrics.mts` → `settleQuery` | 按任务结算，每条查询只计一次 |
| 人工队列受理 | `src/business-metrics.mts` → `HandoffQueue` | 队列确认接收才计入接管 |
| 工具选择核对 | `src/agent-metrics.mts` → `recordToolChoice` | 有标注才进分母 |
| 工具执行结果 | `src/agent-metrics.mts` → `recordToolExecution` | 按 `toolCallId` 配对 |
| 检索命中判断 | `src/agent-metrics.mts` → `recordRetrieval` | 仅成功返回且有标准证据时计入 |
| 模型调用计时 | `src/model-metrics.mts` → `ModelCallTimer` | 单调时钟，`cancelled` 不写延迟 |
| 指标导出 | `src/metrics-server.mts` | 9464 端口暴露 `/metrics` |
| 演示编排 | `pi-monitor-demo.mts` | 一轮跑完三层样本 |
| 指标查询 | `monitoring/query-metrics.mts` | `npm run prom:query` 的实现 |
