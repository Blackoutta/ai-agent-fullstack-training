"""03 State：在 02 基础上加 messages 通道（ToolNode 用）和 checks 列表。"""
from __future__ import annotations

from operator import add
from typing import Annotated, Literal, NotRequired, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class CheckResult(TypedDict):
    name: str
    passed: bool
    summary: str


class ReleaseState(TypedDict):
    ticket_id: str
    service: str
    version: str
    patch_diff: str
    checks_passed: int
    change_level: NotRequired[Literal["L", "M", "H"]]
    approver_count: NotRequired[int]
    stages_completed: NotRequired[list[str]]
    outcome: NotRequired[str]
    report_path: NotRequired[str]

    # 新增：ToolNode 调度通道（add_messages 自带去重 + append 语义）
    messages: NotRequired[Annotated[list[AnyMessage], add_messages]]
    # 新增：collect_checks 解析 ToolMessage 后写入；replace 语义
    checks: NotRequired[list[CheckResult]]
