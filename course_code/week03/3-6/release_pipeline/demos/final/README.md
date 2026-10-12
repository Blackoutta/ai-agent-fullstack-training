# 07_final —— 这就是 `release_pipeline/` 本身

到这里 `demos/01_..06` 六级台阶走完。把它们**合起来**的完整版，
就是这个仓库顶层的 `release_pipeline/`：

```
release_pipeline/
├── state.py        # 04+05 的 Approval / MetricSample / 预算计数全部合进一个 ReleaseState
├── tools.py        # 7 个 @tool：4 检查 + deploy/query_metrics/rollback，real/mock 切换 + 故障注入
├── nodes.py        # 14 节点：intake/tool_checks/collect/classify/3 审批/begin_revision/
│                   # deploy_staging/smoke/canary_step/monitor_window/auto_rollback/finalize
├── graph.py        # 装配 + 6 个路由：checks/level/approval/smoke/canary/monitor/rollback
├── checkpointer.py # AsyncSqliteSaver（顶层用 async 版，demos/04/05/06 用同步 SqliteSaver）
├── visualize.py    # draw_mermaid + draw_mermaid_png
├── app.py          # Typer CLI：submit / status / approve / tail / visualize / demo
├── studio_graph.py + langgraph.json # 给 langgraph dev 用
├── config/tools.yaml               # defaults.mode + 4 个 mock_faults 开关
└── tests/test_acceptance.py        # 7 条 AC，对应 prompts/SDD-release-pipeline.md §8
```

## 为什么不在这里再拷一份代码

`demos/` 与顶层共享同一套 `tools.py`、`config/tools.yaml`（见 `demos/conftest.py`）。
`prompts/SDD-release-pipeline.md` 是闭世界的 source of truth——任何"业务字段 / 节点 / 工具"
的变更都必须先改 SDD，再改 `release_pipeline/`。**拷一份到 final/ 会让 SDD 与实现漂移**，
违反 BOUNDARY-PROTOCOL。

## 想看"六级台阶怎么长出来的"

| 台阶 | 目录 | 加了什么 |
|---|---|---|
| 主线 | `demos/01_minimal/` | 7 节点纯线性 + 报告落盘 |
| 分支 | `demos/02_routing/` | classify_change + route_by_level + 3 档审批 |
| 并行 | `demos/03_toolnode/` | 4 路 @tool + ToolNode + messages/checks |
| HITL | `demos/04_hitl/` | 3 处真 interrupt + SqliteSaver + submit/status/approve CLI |
| 循环 | `demos/05_loops/` | begin_revision + canary_step + monitor_window + auto_rollback + 两个预算 |
| 调试 | `demos/06_visualize/` | visualize.py / stream updates / StateSnapshot / langgraph dev |
| 完整 | `release_pipeline/` | 上述全部 + smoke_test + DeepSeek 接入 + Typer + Docker + 7 AC |

`demos/06_visualize/` 与 `release_pipeline/` 的图已经几乎一致——
差别只在顶层多了 `smoke_test` / DeepSeek 模型 / 故障注入 / 异步 checkpointer / Docker / SDD 测试。

## 跑顶层

```bash
cd release_pipeline
python -m app demo L
python -m app demo canary_fail
python -m pytest tests/ -v
```

完整说明见 [`../../README.md`](../../README.md)。
