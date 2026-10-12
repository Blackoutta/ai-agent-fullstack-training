# release_pipeline — LangGraph 发布审批流水线（教学案例）

一个用 LangGraph 编排的微服务上线审批工作流，覆盖：
**StateGraph / 节点 / 边 / 并行 ToolNode / 条件分支 / 循环 / Interrupt / Checkpoint / Mermaid 可视化**。

> 本工程同时是 `prompts/SDD-TEMPLATE.md` 的**参考实现**。
> 想生成你自己的 LangGraph 工程，请看 [`prompts/README.md`](./prompts/README.md)。

---

## 1. 安装

```bash
cd release_pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
export DEEPSEEK_API_KEY=你的密钥            # 写到 .env 也行
export MODEL_NAME=deepseek-flash            # 按你的网关型号
export MODEL_BASE_URL=https://api.deepseek.com
```

**未配置 `DEEPSEEK_API_KEY` 时**，`classify_change` 与 `finalize` 自动降级为规则实现，
全流程仍可跑通（零 LLM 调用）。这是有意的：教学演示要求"无密钥也能跑"，
而接 DeepSeek 时又能直接出真报告。

## 2. 运行（本地）

```bash
# 一键演示：L 级自动放行
python -m app demo L

# 演示灰度异常 + 自动回滚
python -m app demo canary_fail

# 手动模式
python -m app submit --ticket T-001 --service auth-svc --version 1.4.2 \
    --diff_file ./samples/patch.diff
python -m app status  --ticket T-001
python -m app approve --ticket T-001 --role tech_lead --action approve --actor alice
python -m app tail    --ticket T-001
```

## 3. 运行（Docker）

```bash
docker compose build
docker compose run --rm pipeline python -m app demo L
docker compose run --rm pipeline python -m app submit --ticket T-002 --service pay --version 2.0
docker compose run --rm pipeline python -m app status --ticket T-002
```

Checkpoint 与报告通过 volume 持久化在 `./data` 与 `./reports`。

## 4. 可视化

```bash
python -m app visualize            # 产出 reports/pipeline.mmd + reports/pipeline.png
```

PNG 默认通过 mermaid.ink 渲染；离线环境会降级为只产文本，可用
`mmdc -i reports/pipeline.mmd -o reports/pipeline.png` 本地渲染。

## 5. 测试

```bash
pytest tests/ -v
```

7 条验收测试对应 `prompts/SDD-release-pipeline.md` §8 的 AC-1 ~ AC-7。

## 6. 5 个演示场景

| 场景 | 命令 | 看点 |
|---|---|---|
| L 级自动放行 | `app demo L` | 全程无 interrupt，直接 released |
| M 级单审批 | `app submit` + `app approve` | INT-1 暂停 / `Command(resume=...)` 恢复 |
| H 级跨进程恢复 | submit → Ctrl-C → status → approve | Checkpoint 持久化价值 |
| 冒烟失败回环 | 编辑 `config/tools.yaml` 注入故障 | begin_revision → intake 循环 |
| 灰度异常回滚 | `app demo canary_fail` | auto_rollback → 达 max_rollbacks 终止 |

## 7. 工程结构

```
release_pipeline/
├── state.py             # ReleaseState（闭世界，对应 SDD §3）
├── tools.py             # 7 个 @tool，real/mock 切换（SDD §6）
├── nodes.py             # 14 个节点函数（SDD §4）
├── graph.py             # StateGraph 装配 + 6 个路由（SDD §5）
├── checkpointer.py      # AsyncSqliteSaver（SDD §7）
├── visualize.py         # Mermaid 文本 + PNG
├── app.py               # Typer CLI
├── config/tools.yaml    # 工具模式与故障注入开关
├── tests/               # 验收测试（SDD §8）
├── prompts/             # SDD 提示词模板套件（可复用）
├── demos/               # 教材 3.6 配套的六级渐进台阶（见下）
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── requirements-dev.txt
└── .env.example
```

### 7.1 `demos/` 渐进台阶

教材 `3.6 LangGraph 与 Agent 编排 v2.md` 按"一次只加一个概念"把本工程拆成六级，
每级都是一个**可独立运行、自带验收测试与提示词（P1…P6）**的最小工程：

| 目录 | 加什么 | 测试 |
|---|---|---|
| `demos/01_minimal/` | 主线 7 节点纯线性 + 报告落盘 | 4 AC |
| `demos/02_routing/` | 变更分级 + `add_conditional_edges` 三档审批 | 4 AC |
| `demos/03_toolnode/` | 4 路 `@tool` + `ToolNode` 并行汇合 | 4 AC |
| `demos/04_hitl/` | 3 处真 `interrupt` + `SqliteSaver` 跨进程恢复 | 5 AC |
| `demos/05_loops/` | 修订循环 + 灰度回滚循环 + 两个预算上限 | 5 AC |
| `demos/06_visualize/` | Mermaid 导出 / 流式 updates / `get_state` / `langgraph dev` | 5 AC |
| `demos/final/` | 指回顶层 `release_pipeline/`（六级合起来的完整版，不重复拷贝） | — |

每级目录里的 `PROMPT.md` 就是教材中对应的提示词，可直接复制给 AI 复现该台阶。
运行任一级：

```bash
cd demos/04_hitl
python -m pytest tests/ -v
python app.py submit T-042 auth-svc 1.0.0 "$(python -c 'print("x"*1200)')"
```

`demos/` 与顶层共享 `tools.py` 与 `config/tools.yaml`（见 `demos/conftest.py`）。
**注意**：各层都有同名的 `state.py` / `graph.py` 等模块，测试必须**逐层单独跑**
（进各自目录 `python -m pytest tests/`）；把所有层拼进同一条 pytest 命令会因
模块名冲突互相覆盖而失败。


## 8. 用 SDD 模板生成你自己的工程

见 [`prompts/README.md`](./prompts/README.md)。三步：
1. 复制 `prompts/SDD-TEMPLATE.md` 并填写 §0-§9
2. 连同 `BOUNDARY-PROTOCOL.md` + `GENERATION-ORDER.md` 一起喂给 AI
3. 按 14 阶段逐文件确认

## 9. 已知边界

详见 `prompts/SDD-release-pipeline.md` §9。简而言之：
不做真实 K8s、不做认证、不做 Web UI、不做多租户、不做通知集成。

## 10. 接入 LangGraph Studio / `langgraph dev`（Mode C：纯 HTTP API）

本工程通过 `langgraph.json` + `studio_graph.py` 把图暴露成 HTTP 服务，
**不依赖 Studio Desktop 应用**，跨平台可用 curl/Postman/浏览器调试。

### 10.1 启动

```bash
# 1) 安装 dev 依赖（在已激活的 venv 内）
pip install -r requirements-dev.txt

# 2) 启动 dev server（默认 http://localhost:8123）
langgraph dev --no-browser

# 3) 健康检查
curl http://localhost:8123/ok
# → {"ok":true}

# 4) 浏览器打开 OpenAPI 文档
open http://localhost:8123/docs
```

Docker 模式：取消 `docker-compose.yml` 中 `dev-server` 段的注释，
然后 `docker compose up dev-server`。

### 10.2 关键 HTTP 端点

| 端点 | 用途 |
|---|---|
| `POST /threads` | 创建一个 thread（对应一个 ticket_id） |
| `POST /threads/{tid}/runs` | 启动图执行，遇 interrupt 自动暂停 |
| `GET  /threads/{tid}/state` | 读取当前 state + 待处理 interrupt |
| `POST /threads/{tid}/runs/{rid}/resume` | 提交 `Command(resume=...)` 恢复 |
| `GET  /threads/{tid}/history` | 查看 checkpoint 历史（时间旅行调试） |

### 10.3 演示：interrupt 手动 resume

下面用 curl 走完一个 M 级审批流程。**关键约定**：
- 用 `POST /threads/{tid}/runs/wait`（同步等待），不是 `/runs`（异步排队）
- 恢复时 payload 是 `{"command": {"resume": <值>}}`，不是顶级 `"resume"`

```bash
# Step 1：创建 thread
TID=$(curl -s -X POST http://localhost:8123/threads \
  -H 'Content-Type: application/json' \
  -d '{}' | python -c "import sys,json;print(json.load(sys.stdin)['thread_id'])")
echo "thread_id = $TID"

# Step 2：提交一个 M 级工单（diff 长度 > 800 触发 M 级）
LONG_DIFF=$(python -c "print('x'*1200)")
curl -s -X POST "http://localhost:8123/threads/$TID/runs/wait" \
  -H 'Content-Type: application/json' \
  -d "{
    \"assistant_id\": \"release_pipeline\",
    \"input\": {
      \"ticket_id\": \"T-STUDIO-001\",
      \"service\": \"auth-svc\",
      \"version\": \"1.4.2\",
      \"patch_diff\": \"$LONG_DIFF\",
      \"revision_count\": 0, \"rollback_count\": 0,
      \"max_revisions\": 2, \"max_rollbacks\": 2,
      \"canary_cursor\": 0,
      \"messages\": [], \"checks\": [], \"approvals\": [], \"metric_samples\": []
    }
  }" | jq .

# Step 3：查看 state —— 应该停在 approval_m 的 INT-1
curl -s "http://localhost:8123/threads/$TID/state" | jq '{
  next,
  change_level: .values.change_level,
  pending_interrupt: .tasks[0].interrupts[0].value
}'
# 期望：next=["approval_m"], change_level="M",
#       pending_interrupt.interrupt_id="INT-1", role="tech_lead"

# Step 4：手动 resume，提交 tech_lead 批准
curl -s -X POST "http://localhost:8123/threads/$TID/runs/wait" \
  -H 'Content-Type: application/json' \
  -d '{
    "assistant_id": "release_pipeline",
    "command": {"resume": {"action":"approve","actor":"alice","feedback":"lgtm","role":"tech_lead"}}
  }' | jq .

# Step 5：再看 state，应推进到 canary_step 的 INT-3-canary_10
curl -s "http://localhost:8123/threads/$TID/state" | jq '{
  next,
  canary_cursor: .values.canary_cursor,
  pending: .tasks[0].interrupts[0].value.interrupt_id
}'

# Step 6：连续 3 次 SRE 批准，推完 10% / 50% / 100%
for i in 1 2 3; do
  curl -s -X POST "http://localhost:8123/threads/$TID/runs/wait" \
    -H 'Content-Type: application/json' \
    -d '{"assistant_id":"release_pipeline","command":{"resume":{"action":"approve","actor":"sre","feedback":"","role":"sre"}}}' > /dev/null
  echo "--- after SRE approve #$i ---"
  curl -s "http://localhost:8123/threads/$TID/state" \
    | jq '{next, cursor:.values.canary_cursor, outcome:.values.outcome}'
done

# Step 7：终态核对
curl -s "http://localhost:8123/threads/$TID/state" | jq '.values | {
  outcome, canary_cursor, report_path,
  approvals_count: (.approvals | length),
  metric_samples_count: (.metric_samples | length)
}'
# 期望：outcome="released", canary_cursor=3, approvals_count=4 (1 tech_lead + 3 sre)
```

### 10.4 调试技巧

- **时间旅行**：`GET /threads/{tid}/history` 返回所有 checkpoint，可用 `checkpoint_id` 回到任意历史状态重跑
- **改 state 重跑**：`POST /threads/{tid}/state` 可手动改字段（教学时演示"如果当时 reject 会怎样"）
- **多 thread 并行**：每个 ticket 一个 thread_id，互不干扰；用 `GET /threads` 列全部
- **流式输出**：`POST .../runs/stream` 替代 `/runs`，逐节点 SSE 推送 state delta

### 10.5 Mode C 的边界

- ❌ 不提供图形化节点拖拽（那是 Studio Desktop）
- ❌ 不接 LangSmith 追踪（要单独账号 + key）
- ❌ dev server 的 checkpointer 是临时的（进程内）；生产仍走 `app.py` + SQLite
- ✅ 跨平台、免账号、可用任意 HTTP 客户端调试
