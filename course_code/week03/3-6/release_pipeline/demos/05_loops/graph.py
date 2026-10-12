"""05 图：在 04 的审批分支上接两处循环，并加预算路由。"""
from __future__ import annotations

from typing import Literal

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

import nodes
from state import ReleaseState
from tools import CHECK_TOOLS


def route_by_level(state: ReleaseState) -> Literal["L", "M", "H"]:
    return state["change_level"]


def route_approval(state: ReleaseState) -> Literal["approve", "revise", "reject", "stop"]:
    approvals = state.get("approvals", [])
    if not approvals:
        return "stop"
    last = approvals[-1]["action"]
    if last == "approve":
        return "approve"
    if last == "reject":
        return "reject"
    if last == "abort":
        return "reject"
    if state["revision_count"] >= state["max_revisions"]:
        return "stop"
    return "revise"


def route_after_canary(state: ReleaseState) -> Literal["monitor", "finalize"]:
    if state.get("outcome") in ("rejected", "released"):
        return "finalize"
    return "monitor"


def route_after_monitor(state: ReleaseState) -> Literal["advance", "unhealthy", "released"]:
    if (state.get("current_stage") or {}).get("status") != "healthy":
        return "unhealthy"
    if state["canary_cursor"] >= 3:
        return "released"
    return "advance"


def route_after_rollback(state: ReleaseState) -> Literal["retry", "abort"]:
    if state["rollback_count"] >= state["max_rollbacks"]:
        return "abort"
    return "retry"


APPROVAL_MAP = {
    "approve": "deploy_staging",
    "revise": "begin_revision",
    "reject": "finalize",
    "stop": "finalize",
}


def build_graph(checkpointer):
    b = StateGraph(ReleaseState)
    b.add_node("intake", nodes.intake)
    b.add_node("tool_checks", ToolNode(CHECK_TOOLS))
    b.add_node("collect_checks", nodes.collect_checks)
    b.add_node("classify_change", nodes.classify_change)
    b.add_node("approval_auto_L", nodes.approval_auto_L)
    b.add_node("approval_m", nodes.approval_m)
    b.add_node("approval_h_lead", nodes.approval_h_lead)
    b.add_node("approval_h_security", nodes.approval_h_security)
    b.add_node("begin_revision", nodes.begin_revision)
    b.add_node("deploy_staging", nodes.deploy_staging)
    b.add_node("canary_step", nodes.canary_step)
    b.add_node("monitor_window", nodes.monitor_window)
    b.add_node("auto_rollback", nodes.auto_rollback)
    b.add_node("finalize", nodes.finalize)

    b.add_edge(START, "intake")
    b.add_edge("intake", "tool_checks")
    b.add_edge("tool_checks", "collect_checks")
    b.add_edge("collect_checks", "classify_change")

    b.add_conditional_edges("classify_change", route_by_level, {
        "L": "approval_auto_L", "M": "approval_m", "H": "approval_h_lead",
    })
    b.add_edge("approval_auto_L", "deploy_staging")
    b.add_conditional_edges("approval_m", route_approval, APPROVAL_MAP)
    b.add_conditional_edges("approval_h_lead", route_approval, {
        "approve": "approval_h_security",
        "revise": "begin_revision",
        "reject": "finalize",
        "stop": "finalize",
    })
    b.add_conditional_edges("approval_h_security", route_approval, APPROVAL_MAP)

    b.add_edge("begin_revision", "intake")

    b.add_edge("deploy_staging", "canary_step")
    b.add_conditional_edges("canary_step", route_after_canary, {
        "monitor": "monitor_window", "finalize": "finalize",
    })
    b.add_conditional_edges("monitor_window", route_after_monitor, {
        "advance": "canary_step",
        "unhealthy": "auto_rollback",
        "released": "finalize",
    })
    b.add_conditional_edges("auto_rollback", route_after_rollback, {
        "retry": "canary_step", "abort": "finalize",
    })
    b.add_edge("finalize", END)

    return b.compile(checkpointer=checkpointer)
