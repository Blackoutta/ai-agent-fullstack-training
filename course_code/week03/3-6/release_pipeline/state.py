"""发布流水线状态定义。

State 是节点之间唯一的数据通道。本模块定义闭世界：
任何节点不得引用此处未声明的字段。
"""
from __future__ import annotations

from operator import add
from typing import Annotated, Any, Literal, NotRequired, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class CheckResult(TypedDict):
    name: Literal["build", "unit_test", "security_scan", "dep_audit"]
    passed: bool
    summary: str
    artifacts: list[str]


class Approval(TypedDict):
    role: Literal["tech_lead", "security", "sre"]
    action: Literal["approve", "reject", "revise"]
    actor: str
    feedback: str
    decided_at: str


class DeployStage(TypedDict):
    stage: Literal["staging", "canary_10", "canary_50", "prod_100"]
    started_at: str
    finished_at: NotRequired[str]
    status: Literal["pending", "running", "healthy", "unhealthy", "rolled_back"]


class MetricSample(TypedDict):
    ts: str
    error_rate: float
    p99_ms: float
    stage: str


class ReleaseState(TypedDict):
    # 入口字段
    ticket_id: str
    service: str
    version: str
    patch_diff: str

    # 运行预算
    revision_count: int
    rollback_count: int
    max_revisions: int
    max_rollbacks: int

    # 灰度推进游标：0=未开始 1=10% 2=50% 3=100%
    canary_cursor: int

    # ToolNode 调度通道：intake 写入带 tool_calls 的 AIMessage，
    # tool_checks (ToolNode) 追加 ToolMessage，collect_checks 解析后清空。
    messages: NotRequired[Annotated[list[AnyMessage], add_messages]]

    # 由节点写入
    # checks 使用 replace 语义：collect_checks 一次性写入本轮 4 条结果，
    # begin_revision 后由下一轮 collect_checks 整体覆盖。
    checks: NotRequired[list[CheckResult]]
    # approvals / metric_samples 使用 add reducer：审计与监控数据需要累计。
    approvals: NotRequired[Annotated[list[Approval], add]]
    change_level: NotRequired[Literal["L", "M", "H"]]
    current_stage: NotRequired[DeployStage]
    metric_samples: NotRequired[Annotated[list[MetricSample], add]]

    # 终态
    outcome: NotRequired[
        Literal["released", "rejected", "rolled_back", "blocked", "incomplete"]
    ]
    report_summary: NotRequired[str]
    report_path: NotRequired[str]
