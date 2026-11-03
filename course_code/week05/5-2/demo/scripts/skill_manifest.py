import argparse
import hashlib
import json
from pathlib import Path
from common import dump

def manifest(directory):
    root = Path(directory).resolve(strict=True)
    if not (root / "SKILL.md").is_file():
        raise ValueError("缺少 SKILL.md")
    files = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("课堂能力包禁止符号链接")
        if path.is_file() and "__pycache__" not in path.parts:
            files[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"files": files, "package_sha256": hashlib.sha256(
        json.dumps(files, sort_keys=True).encode()).hexdigest()}

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("directory")
    p.add_argument("--output", default="skill-manifest.json")
    a = p.parse_args()
    record = manifest(a.directory)
    dump(a.output, record)
    print(json.dumps(record, ensure_ascii=False, indent=2))

