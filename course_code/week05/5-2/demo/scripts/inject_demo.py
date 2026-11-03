import argparse
import json
from pathlib import Path
from common import FIXTURE, snapshot, dump
from delegation import aggregate
from trace_analysis import analyze

# 这是主动制造的治理/观测错误输入，不是模型生成结果，不替代真实 Agent。
def demo(output):
    root = Path(output)
    before = snapshot(FIXTURE)
    good = {"issue_key": "tenant-filter", "claim": "未按当前用户过滤",
            "severity": "high", "evidence": [
                {"path": "app/orders.py", "excerpt": "SELECT id, user_id FROM orders ORDER BY id"}]}
    bad = dict(good, evidence=[{"path": "../secret.txt", "excerpt": "不应读取"}])
    raw = {"results": [
        {"task_id": "security", "status": "completed", "findings": [good, bad]},
        {"task_id": "test", "status": "completed",
         "findings": [dict(good, claim="已按当前用户过滤")]},
    ]}
    dump(root / "injected-results.json", raw)
    dump(root / "injected-aggregation.json", aggregate(FIXTURE, raw, before))
    events = [
        {"type": "tool_execution_start", "toolCallId": "injected-1",
         "toolName": "read", "args": {"path": "missing.py"}},
        {"type": "tool_execution_end", "toolCallId": "injected-1", "toolName": "read",
         "isError": True, "result": {"error": "FILE_NOT_FOUND"}},
        {"type": "tool_execution_start", "toolCallId": "injected-2",
         "toolName": "read", "args": {"path": "app/orders.py"}},
    ]
    root.mkdir(parents=True, exist_ok=True)
    (root / "injected-events.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n")
    dump(root / "injected-trace-summary.json", analyze(events))
    print("已生成注入样本：越界引用、矛盾结论、工具失败、缺结束事件")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="injected")
    a = p.parse_args()
    demo(a.output)

