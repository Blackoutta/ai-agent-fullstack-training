from common import evidence_ok, parse_object

def grade_readonly(answer, case, project, before, run):
    checks = {"execution_ok": run["status"] == "exited",
              "project_unchanged": run["snapshot_unchanged"]}
    errors = []
    try:
        data = parse_object(answer)
    except ValueError as exc:
        return {"passed": False, "checks": checks, "errors": ["output_schema: " + str(exc)]}
    if case["kind"] == "understand":
        checks["path"] = data.get("path") == "app/orders.py"
        checks["function"] = data.get("function") == "list_orders"
    elif case["kind"] == "retrieve":
        checks["max_selects"] = type(data.get("max_selects")) is int and data["max_selects"] == 2
        checks["current_source"] = data.get("source") == "docs/current.md"
    elif case["kind"] == "review":
        checks["tenant_leak"] = data.get("tenant_leak") is True
        checks["n_plus_one"] = data.get("n_plus_one") is True
        checks["honest_verification"] = data.get("verification") == "static"
    else:
        raise ValueError("未知题型")
    evidence = data.get("evidence")
    checks["literal_evidence"] = (isinstance(evidence, list) and bool(evidence)
                                 and all(evidence_ok(project, e, before) for e in evidence))
    return {"passed": all(checks.values()), "checks": checks, "errors": errors,
            "semantic_judge": "not_used", "grader_version": "course-rules-v1"}

