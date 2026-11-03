import argparse
import json
import sqlite3
from pathlib import Path

def ingest(summary_path, db):
    summary = json.loads(Path(summary_path).read_text())
    with sqlite3.connect(db) as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS evaluations (
            version TEXT, dataset TEXT, case_id TEXT, run_key TEXT,
            passed INTEGER, status TEXT, latency REAL, payload TEXT,
            PRIMARY KEY(version, dataset, case_id, run_key))""")
        for row in summary["results"]:
            run_key = row.get("run_dir", str(Path(summary_path).resolve()) + ":" + row["case_id"])
            connection.execute("""INSERT OR REPLACE INTO evaluations
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (summary["agent_version"], summary["dataset_version"], row["case_id"],
                 run_key, int(row["passed"]), row["status"], row.get("latency"),
                 json.dumps(row, ensure_ascii=False)))
        rows = connection.execute("""SELECT version, dataset, COUNT(*), SUM(passed)
            FROM evaluations GROUP BY version, dataset""").fetchall()
    for version, dataset, total, passed in rows:
        print(f"{version} / {dataset}: {passed}/{total}, 成功率={passed/total:.1%}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--summary", required=True)
    p.add_argument("--db", default="eval.sqlite")
    a = p.parse_args()
    ingest(a.summary, a.db)

