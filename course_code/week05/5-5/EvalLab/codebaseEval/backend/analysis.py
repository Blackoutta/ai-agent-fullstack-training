"""Evidence-first grading, honest metrics and paired regression analysis."""
from collections import Counter, defaultdict
import re
from .common import fingerprint


def grade(task, answer, audit):
    checks = []
    for check in task["checks"]:
        kind, value = check["type"], check["value"]
        if kind == "contains":
            passed, evidence = value.lower() in answer.lower(), "answer"
        elif kind == "regex":
            passed, evidence = bool(re.search(value, answer[:100000], re.I)), "answer"
        elif kind == "tool_called":
            passed = any(row.get("tool_name") == value and row.get("status") == "success" for row in audit)
            evidence = "audit"
        else:
            passed, evidence = not any(row.get("status") in {"deny", "error", "confirm"} for row in audit), "audit"
        checks.append({**check, "status": "pass" if passed else "fail",
                       "reason": "满足程序检查" if passed else f"不满足 {kind}: {value}",
                       "evidence": [evidence]})
    return checks


def outcome(run, reviews=()):
    if run.get("execution_status") != "completed" or run.get("mode") == "offline":
        return "unknown"
    if not run.get("checks"):
        return "unknown"
    if any(c["status"] == "fail" for c in run["checks"]):
        return "fail"
    if any(c["status"] != "pass" for c in run["checks"]):
        return "unknown"
    semantic = reviews[-1]["status"] if reviews else (run.get("judge") or {}).get("status", "unknown")
    return semantic if semantic in {"pass", "fail"} else "unknown"


def usage_metrics(messages, strategy, seconds, audit, offline=False):
    known_tokens, known_cost = 0, 0.0
    token_complete = bool(messages) and not offline
    cost_complete = token_complete
    for message in messages:
        usage = message.get("usage") or {}
        values = [usage.get(k) for k in ("input", "output", "cacheRead", "cacheWrite")]
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0 for v in values):
            token_complete = cost_complete = False
            continue
        incoming, outgoing, cached, written = values
        known_tokens += sum(values)
        prices = [strategy.get(k) for k in ("input_price", "output_price", "cache_price")]
        if any(p is None and count > 0 for p, count in zip(prices, (incoming + written, outgoing, cached))):
            cost_complete = False
        known_cost += sum((p or 0) * count for p, count in zip(prices, (incoming + written, outgoing, cached))) / 1_000_000
    calls = {row.get("tool_call_id", str(index)) for index, row in enumerate(audit)}
    errors = {row.get("tool_call_id", str(index)) for index, row in enumerate(audit) if row.get("status") in {"deny", "error", "confirm"}}
    return {"seconds": round(seconds, 4), "total_tokens": known_tokens if token_complete else None,
            "known_tokens": 0 if offline else known_tokens,
            "cost_usd": round(known_cost, 8) if cost_complete else None,
            "known_cost_usd": 0 if offline else round(known_cost, 8),
            "agent_cost_usd": round(known_cost, 8) if cost_complete else None,
            "judge_cost_usd": None, "tool_calls": len(calls), "tool_errors": len(errors),
            "cost_note": "按配置价格估算，不是账单；null 表示不完整或离线"}


def summary(runs):
    values = [r for r in runs if r.get("mode") == "live"]
    counts = Counter(r["outcome"] for r in values)
    times = [r["metrics"]["seconds"] for r in values if r["metrics"].get("seconds") is not None]
    result = {"runs": len(values), "passed": counts["pass"], "failed": counts["fail"],
              "unknown": counts["unknown"], "success_rate": counts["pass"] / len(values) if values else None,
              "known_cost_usd": round(sum(r["metrics"].get("known_cost_usd", 0) for r in values), 8),
              "unknown_cost_runs": sum(r["metrics"].get("cost_usd") is None for r in values),
              "total_tokens": sum(r["metrics"].get("known_tokens", 0) for r in values),
              "unknown_token_runs": sum(r["metrics"].get("total_tokens") is None for r in values),
              "mean_seconds": sum(times) / len(times) if times else None,
              "tool_calls": sum(r["metrics"].get("tool_calls", 0) for r in values),
              "tool_errors": sum(r["metrics"].get("tool_errors", 0) for r in values),
              "offline_runs": len(runs) - len(values)}
    by_strategy = []
    for ident in sorted({r["strategy_id"] for r in values}):
        group = [r for r in values if r["strategy_id"] == ident]
        stats = summary(group) if len({r["strategy_id"] for r in values}) > 1 else {**result}
        stats.pop("by_strategy", None)
        by_strategy.append({"strategy_id": ident, "name": group[0]["strategy"]["name"], **stats})
    result["by_strategy"] = by_strategy
    return result


def clusters(runs):
    groups = defaultdict(list)
    for run in runs:
        if run.get("mode") != "live" or run["outcome"] == "pass":
            continue
        error = run.get("error") or ""
        if run["execution_status"] in {"queued", "running"}:
            continue
        if "TIMEOUT" in error:
            category = "执行超时"
        elif "MODEL_UNAVAILABLE" in error or "401" in error or "403" in error:
            category = "模型凭据或访问错误"
        elif run["execution_status"] in {"cancelled", "interrupted"}:
            category = "取消或服务中断"
        elif run["execution_status"] != "completed":
            category = "运行或预算错误"
        elif any(c["status"] == "fail" and c["type"] in {"no_tool_errors", "tool_called"} for c in run.get("checks", [])):
            category = "工具调用检查失败"
        elif any(c["status"] == "fail" for c in run.get("checks", [])):
            category = "回答程序检查失败"
        elif (run.get("judge") or {}).get("status") == "fail":
            category = "语义评审失败"
        else:
            category = "证据不足或待人工复核"
        groups[category].append(run["id"])
    return [{"category": k, "count": len(v), "run_ids": v} for k, v in sorted(groups.items(), key=lambda x: -len(x[1]))]


def compare(runs, experiment, baseline, candidate):
    if baseline == candidate or baseline not in experiment["strategy_ids"] or candidate not in experiment["strategy_ids"]:
        raise ValueError("请选择实验中的两个不同策略")
    selected = [r for r in runs if r["experiment_id"] == experiment["id"]]
    maps = {sid: {(r["task_id"], r["trial"]): r for r in selected if r["strategy_id"] == sid}
            for sid in (baseline, candidate)}
    rows = []
    for key in sorted(set(maps[baseline]) & set(maps[candidate])):
        before, after = maps[baseline][key], maps[candidate][key]
        if before.get("source_hash") != after.get("source_hash") or fingerprint(before["task"]) != fingerprint(after["task"]):
            continue
        a, b = before["outcome"], after["outcome"]
        change = "unknown" if "unknown" in {a, b} else "improved" if a == "fail" and b == "pass" else "regressed" if a == "pass" and b == "fail" else "unchanged"
        rows.append({"task_id": key[0], "task_name": after["task"]["name"], "trial": key[1],
                     "before": {"run_id": before["id"], "outcome": a, "metrics": before["metrics"]},
                     "after": {"run_id": after["id"], "outcome": b, "metrics": after["metrics"]}, "change": change})
    expected = len(experiment["task_ids"]) * experiment["trials"]
    complete = len(rows) == expected and experiment["status"] == "completed"
    bad = any(r["outcome"] != "pass" for r in maps[candidate].values() if r["task"]["required"])
    changes = Counter(r["change"] for r in rows)
    accept = complete and not bad and not changes["regressed"] and not changes["unknown"] and experiment["mode"] == "live"
    return {"baseline": baseline, "candidate": candidate, "rows": rows,
            "summary": {"paired": len(rows), "expected": expected, "improved": changes["improved"],
                        "regressed": changes["regressed"], "unchanged": changes["unchanged"], "unknown": changes["unknown"]},
            "gate": {"decision": "accept" if accept else "hold", "complete": complete,
                     "required_failed_or_unknown": bad, "mode": experiment["mode"]},
            "note": "同一实验源码/题目快照配对；失败与未知不删除。小样本不证明稳定性，离线结果不能发布。"}


def markdown_report(report):
    lines = ["# Codebase 回归报告", "", f"门禁：{report['gate']['decision']}", report["note"], "",
             "|任务|重复|基线|候选|变化|", "|---|---|---|---|---|"]
    for row in report["rows"]:
        name = row["task_name"].replace("|", "\\|").replace("\n", " ")
        lines.append(f"|{name}|{row['trial']}|{row['before']['outcome']}|{row['after']['outcome']}|{row['change']}|")
    lines += ["", "## 证据", ""]
    for row in report["rows"]:
        lines.append(f"- {row['task_id']} #{row['trial']}: {row['before']['run_id']} → {row['after']['run_id']}")
    return "\n".join(lines)
