"""04 工具集合：与 03 一致，4 个 mock 工具。"""
from __future__ import annotations

import json

from langchain_core.tools import tool


@tool
def build_service(service: str, version: str) -> str:
    """构建服务镜像。"""
    return json.dumps({"tool": "build", "passed": True,
                       "summary": f"mock: {service}@{version} 构建成功"})


@tool
def run_unit_tests(service: str) -> str:
    """执行单元测试。"""
    return json.dumps({"tool": "unit_test", "passed": True,
                       "summary": f"mock: {service} 单测 42/0"})


@tool
def security_scan(diff: str) -> str:
    """对补丁 diff 做静态安全扫描。"""
    return json.dumps({"tool": "security_scan", "passed": True,
                       "summary": f"mock: diff({len(diff)} chars) 无高危"})


@tool
def dependency_audit(service: str) -> str:
    """依赖审计。"""
    return json.dumps({"tool": "dep_audit", "passed": True,
                       "summary": f"mock: {service} 无 critical CVE"})


CHECK_TOOLS = [build_service, run_unit_tests, security_scan, dependency_audit]
