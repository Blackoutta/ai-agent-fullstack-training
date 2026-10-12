"""02 图：把 classify_change 后接 add_conditional_edges，分流到 3 条审批路径。"""
from __future__ import annotations

from typing import Literal

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

import nodes
from state import ReleaseState


def route_by_level(state: ReleaseState) -> Literal["L", "M", "H"]:
    return state["change_level"]


def build_graph(checkpointer=None):
    builder = StateGraph(ReleaseState)
    builder.add_node("intake", nodes.intake)
    builder.add_node("classify_change", nodes.classify_change)
    builder.add_node("approval_auto_L", nodes.approval_auto_L)
    builder.add_node("approval_lead_M", nodes.approval_lead_M)
    builder.add_node("approval_dual_H", nodes.approval_dual_H)
    builder.add_node("deploy_staging", nodes.deploy_staging)
    builder.add_node("smoke_test", nodes.smoke_test)
    builder.add_node("canary_10", nodes.canary_10)
    builder.add_node("canary_50", nodes.canary_50)
    builder.add_node("canary_100", nodes.canary_100)
    builder.add_node("finalize", nodes.finalize)

    builder.add_edge(START, "intake")
    builder.add_edge("intake", "classify_change")

    builder.add_conditional_edges("classify_change", route_by_level, {
        "L": "approval_auto_L",
        "M": "approval_lead_M",
        "H": "approval_dual_H",
    })

    builder.add_edge("approval_auto_L", "deploy_staging")
    builder.add_edge("approval_lead_M", "deploy_staging")
    builder.add_edge("approval_dual_H", "deploy_staging")

    builder.add_edge("deploy_staging", "smoke_test")
    builder.add_edge("smoke_test", "canary_10")
    builder.add_edge("canary_10", "canary_50")
    builder.add_edge("canary_50", "canary_100")
    builder.add_edge("canary_100", "finalize")
    builder.add_edge("finalize", END)

    return builder.compile(checkpointer=checkpointer or InMemorySaver())
