"""05 工具集合：在 04 的 4 个检查工具之外，加部署 / 指标 / 回滚 3 个运维工具（mock）。"""
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


@tool
def deploy(stage: str, service: str, version: str) -> str:
    """部署到指定阶段。"""
    return json.dumps({"tool": "deploy", "passed": True, "stage": stage,
                       "summary": f"mock: {service}@{version} -> {stage}"})


@tool
def query_metrics(service: str, stage: str) -> str:
    """拉取一段时间指标；本 demo 用固定 error_rate 让健康判定可复现。"""
    return json.dumps({"tool": "query_metrics", "stage": stage,
                       "error_rate": 0.24, "p99_ms": 980})


CHECK_TOOLS = [build_service, run_unit_tests, security_scan, dependency_audit]
OPS_TOOLS = [deploy, query_metrics]
