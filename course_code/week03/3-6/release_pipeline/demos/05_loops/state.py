"""05 State：在 04 基础上加循环所需的预算计数、灰度游标、阶段与指标采样。"""
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
    interrupt_id: str
    role: Literal["tech_lead", "security", "sre"]
    action: Literal["approve", "reject", "revise", "abort"]
    actor: str
    feedback: str


class MetricSample(TypedDict):
    ts: str
    stage: str
    error_rate: float
    healthy: bool


class ReleaseState(TypedDict):
    # 入口
    ticket_id: str
    service: str
    version: str
    patch_diff: str

    # 循环预算（入口提供）
    revision_count: int
    max_revisions: int
    rollback_count: int
    max_rollbacks: int
    canary_cursor: int

    # ToolNode 通道
    messages: NotRequired[Annotated[list[AnyMessage], add_messages]]
    # checks：replace 语义，每轮 collect_checks 整体覆盖
    checks: NotRequired[list[CheckResult]]
    checks_passed: int
    change_level: NotRequired[Literal["L", "M", "H"]]

    # approvals / metric_samples：add 语义，审计与监控累计
    approvals: NotRequired[Annotated[list[Approval], add]]
    metric_samples: NotRequired[Annotated[list[MetricSample], add]]

    approver_count: NotRequired[int]
    stages_completed: NotRequired[list[str]]
    current_stage: NotRequired[dict]

    outcome: NotRequired[
        Literal["released", "rejected", "rolled_back", "incomplete"]
    ]
    report_path: NotRequired[str]
