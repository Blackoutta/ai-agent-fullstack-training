"""06 LangGraph Studio / `langgraph dev` 入口。

暴露一个不带 checkpointer 的图，dev server 注入自己的内存 checkpointer。
"""
from graph import build_graph

graph = build_graph(None)
