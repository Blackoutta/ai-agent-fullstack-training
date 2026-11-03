import argparse
import json
import subprocess
import sys
from pathlib import Path
from common import dump, snapshot

PROBE = """import json, sqlite3
from app.orders import list_orders
db = sqlite3.connect(":memory:")
db.executescript('''
CREATE TABLE orders(id INTEGER PRIMARY KEY, user_id INTEGER);
CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER, sku TEXT);
INSERT INTO orders VALUES(100,10),(101,10),(200,20);
INSERT INTO order_items VALUES(1,100,'book'),(2,100,'pen'),(3,101,'cup'),(4,200,'secret');
''')
queries = []
db.set_trace_callback(lambda sql: queries.append(sql) if sql.lstrip().upper().startswith("SELECT") else None)
orders = list_orders(db, 10)
small_queries = len(queries)
queries.clear()
db.executescript('''
INSERT INTO orders VALUES(102,10),(103,10),(104,10);
INSERT INTO order_items VALUES(5,102,'a'),(6,103,'b'),(7,104,'c');
''')
large = list_orders(db, 10)
large_queries = len(queries)
print(json.dumps({"orders": orders, "large_orders": large,
                  "small_queries": small_queries, "large_queries": large_queries}))
db.close()
"""

def verify(project, before):
    project = Path(project).resolve()
    current = snapshot(project)
    old = before["files"]
    old_keys = {k for k in old if k.startswith("tests/")}
    new_keys = {k for k in current["files"] if k.startswith("tests/")}
    unchanged = old_keys == new_keys and all(old[k] == current["files"].get(k) for k in old_keys)
    changed = {k for k in set(old) | set(current["files"]) if old.get(k) != current["files"].get(k)}
    try:
        probe = subprocess.run([sys.executable, "-c", PROBE], cwd=project,
                               capture_output=True, text=True, timeout=10)
        values = json.loads(probe.stdout) if probe.returncode == 0 else {}
        orders, large = values.get("orders", []), values.get("large_orders", [])
        tests = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests"],
                               cwd=project, capture_output=True, text=True, timeout=10)
        checks = {
            "only_current_user": bool(orders) and all(o.get("user_id") == 10 for o in orders + large),
            "small_order_ids": [o.get("id") for o in orders] == [100, 101],
            "large_order_ids": [o.get("id") for o in large] == [100, 101, 102, 103, 104],
            "items_complete": [o.get("items") for o in orders] == [["book", "pen"], ["cup"]],
            "query_count_bounded": (type(values.get("small_queries")) is int and
                type(values.get("large_queries")) is int and
                values["small_queries"] <= 2 and values["large_queries"] <= 2),
            "protected_tests_unchanged": unchanged,
            "write_scope": changed <= {"app/orders.py"},
            "existing_tests_passed": tests.returncode == 0,
        }
        return {"passed": all(checks.values()), "checks": checks, "values": values,
                "probe_exit": probe.returncode, "tests_exit": tests.returncode,
                "probe_stderr": probe.stderr, "tests_log": tests.stdout + tests.stderr,
                "snapshot_id": current["snapshot_id"],
                "coverage_note": "参数绑定与其他漏洞需额外源码审查；不是完整安全证明"}
    except (subprocess.TimeoutExpired, ValueError, TypeError, AttributeError) as exc:
        return {"passed": False, "error": str(exc), "snapshot_id": current["snapshot_id"]}

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True)
    p.add_argument("--baseline", required=True)
    p.add_argument("--output", default="acceptance.json")
    a = p.parse_args()
    report = verify(a.project, json.loads(Path(a.baseline).read_text()))
    dump(a.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["passed"] else 1)

