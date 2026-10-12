"""主线 7 节点用普通边串起来。本步骤没有任何 add_conditional_edges。"""
from __future__ import annotations

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

import nodes
from state import ReleaseState


def build_graph(checkpointer=None):
    builder = StateGraph(ReleaseState)
    builder.add_node("intake", nodes.intake)
    builder.add_node("deploy_staging", nodes.deploy_staging)
    builder.add_node("smoke_test", nodes.smoke_test)
    builder.add_node("canary_10", nodes.canary_10)
    builder.add_node("canary_50", nodes.canary_50)
    builder.add_node("canary_100", nodes.canary_100)
    builder.add_node("finalize", nodes.finalize)

    builder.add_edge(START, "intake")
    builder.add_edge("intake", "deploy_staging")
    builder.add_edge("deploy_staging", "smoke_test")
    builder.add_edge("smoke_test", "canary_10")
    builder.add_edge("canary_10", "canary_50")
    builder.add_edge("canary_50", "canary_100")
    builder.add_edge("canary_100", "finalize")
    builder.add_edge("finalize", END)

    return builder.compile(checkpointer=checkpointer or InMemorySaver())
