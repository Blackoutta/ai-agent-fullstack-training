"""主线最小版状态：仅描述"一张工单从提交到发布"必需的数据。

不含审批、不含分支、不含循环 —— 这些是后续步骤的能力。
"""
from __future__ import annotations

from typing import NotRequired, TypedDict


class ReleaseState(TypedDict):
    ticket_id: str
    service: str
    version: str
    checks_passed: int
    stages_completed: NotRequired[list[str]]
    outcome: NotRequired[str]
    report_path: NotRequired[str]
