import argparse
import json
import subprocess
import sys
from pathlib import Path
from acceptance import PROBE

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True)
    a = p.parse_args()
    root = Path(a.project).resolve(strict=True)
    result = subprocess.run([sys.executable, "-c", PROBE], cwd=root,
                            capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise RuntimeError(result.stderr)
    values = json.loads(result.stdout)
    print(json.dumps({"execution": "actual_sqlite_probe", "values": values,
                      "only_current_user": all(o["user_id"] == 10 for o in values["orders"]), "bounded_queries": values["large_queries"] <= 2}, ensure_ascii=False, indent=2))

