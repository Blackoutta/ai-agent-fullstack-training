"""04 State：在 03 基础上加 approvals 列表（带 add reducer，审计可累计）。"""
from __future__ import annotations

from operator import add
from typing import Annotated, Literal, NotRequired, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class CheckResult(TypedDict):
    name: str
    passed: bool
    summary: str


class Approval(TypedDict):
    interrupt_id: Literal["INT-1", "INT-2A", "INT-2B"]
    role: Literal["tech_lead", "security"]
    action: Literal["approve", "reject"]
    actor: str
    feedback: str


class ReleaseState(TypedDict):
    ticket_id: str
    service: str
    version: str
    patch_diff: str
    checks_passed: int
    checks: NotRequired[list[CheckResult]]
    change_level: NotRequired[Literal["L", "M", "H"]]
    approver_count: NotRequired[int]
    stages_completed: NotRequired[list[str]]
    outcome: NotRequired[Literal["released", "rejected"]]
    report_path: NotRequired[str]
    messages: NotRequired[Annotated[list[AnyMessage], add_messages]]
    approvals: NotRequired[Annotated[list[Approval], add]]
