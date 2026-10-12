"""02 在 01 基础上加 change_level + approver_count 两个字段。"""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


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
