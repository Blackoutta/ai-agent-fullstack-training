"""LangGraph Studio / `langgraph dev` 入口。

暴露一个**不带 checkpointer** 的图，由 Studio 或 dev server 注入自己的内存
checkpointer。生产仍走 `app.py` + `AsyncSqliteSaver`，两者互不影响。

graph.py 的 build_graph 已支持 checkpointer=None，本文件仅做一行包装，
保持核心图代码零侵入。
"""
from graph import build_graph

graph = build_graph(None)
