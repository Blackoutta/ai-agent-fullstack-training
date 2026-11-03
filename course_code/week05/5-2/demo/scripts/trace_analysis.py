import argparse
import json
from pathlib import Path
from common import read_events, dump

def analyze(events):
    active, completed, labels, versions, usages = {}, [], [], [], []
    starts = 0
    for event in events:
        kind = event.get("type")
        if kind == "tool_execution_start":
            starts += 1
            key = event.get("toolCallId")
            if not isinstance(key, str) or key in active:
                labels.append("tool_id_missing_or_duplicate")
            else:
                active[key] = event
        elif kind == "tool_execution_end":
            key = event.get("toolCallId")
            start = active.pop(key, None)
            if start is None:
                labels.append("tool_end_without_start")
            else:
                completed.append({"id": key, "tool": start.get("toolName"),
                                  "args": start.get("args"), "is_error": event.get("isError"),
                                  "result": event.get("result")})
                if event.get("isError") is True:
                    labels.append("tool_error")
        elif kind == "message_end":
            message = event.get("message", {})
            if message.get("role") == "assistant":
                if message.get("stopReason") in ("error", "aborted"):
                    labels.append("model_error_or_abort")
                if isinstance(message.get("usage"), dict):
                    usages.append(message["usage"])
                versions.append({"provider": message.get("provider"), "model": message.get("model")})
    if active:
        labels.append("unfinished_tool_calls")
    if not events:
        labels.append("empty_event_stream")
    # 不把 message_update 的累计 usage 重复相加。
    fields = ("input", "output", "cacheRead", "cacheWrite")
    tokens = {key: sum(u[key] for u in usages) if usages and all(
        isinstance(u.get(key), (int, float)) for u in usages) else None for key in fields}
    costs = [u.get("cost", {}).get("total") for u in usages]
    observed_cost = sum(costs) if costs and all(isinstance(c, (int, float)) for c in costs) else None
    return {
        "event_count": len(events), "tool_call_count": starts,
        "completed_tools": completed, "pending_ids": sorted(active),
        "labels": sorted(set(labels)), "tokens": tokens, "models": versions,
        "provider_reported_cost": observed_cost,
        "billing_cost": observed_cost if observed_cost is not None and observed_cost > 0 else None,
        "usage_scope": "parent_messages_only",
        "root_cause": None,
    }

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("events")
    p.add_argument("--output", default="trace-summary.json")
    a = p.parse_args()
    try:
        summary = analyze(read_events(a.events))
    except (ValueError, OSError) as exc:
        summary = {"labels": ["event_parse_error"], "error": str(exc), "root_cause": None}
    dump(a.output, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))

