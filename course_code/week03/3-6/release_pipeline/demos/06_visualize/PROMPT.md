# 提示词 P6：加 Mermaid 导出 / 流式 updates / state 快照 / langgraph dev

把下面整段复制给 AI。它会读 `demos/05_loops/`，在 `demos/06_visualize/` 下生成新格。

---

```
任务：在 demos/05_loops/ 的基础上，新建 demos/06_visualize/，
代码结构完全保留（图就是 05 那张），只**加** 4 个观察 / 调试入口。

【本步骤业务目标】
流水线代码到这个规模已经不容易读。本步骤教四件事：
① 把图渲染成 Mermaid 文本与 PNG；
② 用 stream_mode="updates" 看每一步触发了哪个节点；
③ 用 get_state 看任意 thread 的当前快照与待批 interrupt；
④ 用 langgraph dev 把图挂到本地 Studio UI。

【新增文件 visualize.py】
- mermaid_text(graph) → str              # graph.get_graph().draw_mermaid()
- export_mermaid(graph, out_dir) → dict  # 落盘 .mmd；try draw_mermaid_png() 落盘 .png；
                                          # 失败则把异常信息塞 png_status，但 .mmd 一定保留
- stream_nodes(graph, initial, config) → list[str]
    # 遍历 graph.stream(..., stream_mode="updates")：
    #   普通 {node: update} → 追加 node；
    #   "__interrupt__" 键 → 对每个 intr.value 追加 f"⏸ {intr.value['interrupt_id']}"。
    #   注意：触发 interrupt 的节点不会作为普通 key 出现在 updates 流里。

【新增文件 studio_graph.py】
from graph import build_graph
graph = build_graph(None)   # langgraph dev 自己注入内存 checkpointer

【新增文件 langgraph.json】
{
  "graphs": { "release_06": "./studio_graph.py:graph" },
  "dependencies": ["."],
  "env": ".env"
}

【改 app.py：在 05 的 submit / status / approve / demo 之外，新增两个子命令】
- visualize  → 直接 print(mermaid_text) + 报告 .mmd / .png 路径
- watch <ticket> → 用 stream_nodes 跑一次，打印 "执行顺序：..."

【验收 AC】
AC-1: mermaid_text(build_graph(None)) 至少包含
      "graph TD"、"intake"、"tool_checks"、"canary_step"、"auto_rollback"、
      "begin_revision"、"finalize" 这些子串
AC-2: export_mermaid 写到 tmp 目录后，.mmd 文件存在；
      info 字典有 png_status 字段（在线渲染可能失败，但 .mmd 一定落地）
AC-3: 一个 M 级未批工单 stream_nodes 返回的列表：
      前 4 个 = ["intake","tool_checks","collect_checks","classify_change"]，
      末尾 = "⏸ INT-1"，且列表里**没有** "approval_m"
      （这是 updates 流的关键：中断节点不会作为正常 key 出现）
AC-4: submit 后 get_state().next==("approval_m",) 且 snap.tasks[0].interrupts[0].value
      ["interrupt_id"]=="INT-1"；resume approve 后再次 get_state，
      新一个待批的 interrupt_id == "INT-3-canary_10"
AC-5: `python -c "import studio_graph; assert studio_graph.graph is not None"` 通过；
      langgraph.json 中 graphs.release_06 == "./studio_graph.py:graph"

【明确不做】
- 不修改 05 的图/节点/state，只加观察入口
- 不真起 langgraph dev server（CI 里不依赖端口），AC-5 只校验配置可加载
- 不引入新业务步骤
```

---

## 拿到生成结果后做什么

```bash
cd release_pipeline/demos/06_visualize
python -m pytest tests/ -v

python app.py visualize              # 看 Mermaid 文本与 .mmd / .png 路径
python app.py watch 06-demo-001      # 看一次"跑到中断为止"的节点触发序列

# 想体验 LangGraph Studio UI：
pip install -r ../../requirements-dev.txt   # 装 langgraph-cli[inmem]
langgraph dev                               # 在 06_visualize 目录里启动
# 浏览器自动开 http://127.0.0.1:8123，看到 release_06 这张图，可视化点 approve
```
