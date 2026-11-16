"""Local release controller and request entry point for the Pi demo."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
ROUTE = ROOT / ".route.json"
EXPECTED = {"a": "READY", "b": '{"status":"ready"}'}
PROMPT = "Read the loaded response-contract skill with the read tool, then handle this readiness request. Follow the skill's exact response contract."


def route():
    return json.loads(ROUTE.read_text()) if ROUTE.exists() else {"stable": "a", "pilot": "a"}


def switch(pilot):
    policy = {"stable": "a", "pilot": pilot}
    with tempfile.NamedTemporaryFile(mode="w", dir=ROOT, delete=False) as handle:
        json.dump(policy, handle)
    Path(handle.name).replace(ROUTE)
    print(json.dumps(policy))


def probe(release, offline):
    skill = ROOT / "releases" / release / "response-contract" / "SKILL.md"
    if not skill.is_file():
        raise SystemExit(f"Missing Skill: {skill}")
    if offline:
        print(f"mode=route-only release={release} skill={skill.relative_to(ROOT)}")
        return
    pi = shutil.which("pi")
    if pi is None:
        raise SystemExit("Pi is required for this probe. Run pi first to configure a working model.")
    print(f"mode=live release={release} skill={skill.relative_to(ROOT)}", flush=True)
    result = subprocess.run(
        [pi, "--print", "--no-session", "--no-skills", "--no-extensions",
         "--no-context-files", "--no-mcp", "--tools", "read", "--skill", str(skill), PROMPT],
        cwd=ROOT, capture_output=True, text=True, timeout=120,
    )
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    if result.returncode:
        raise SystemExit(result.returncode)
    answer = result.stdout.strip()
    print(answer)
    expected = EXPECTED[release]
    if release == "b":
        try:
            valid = json.loads(answer) == json.loads(expected)
        except ValueError:
            valid = False
    else:
        valid = answer == expected
    if not valid:
        raise SystemExit(f"FAIL: expected response contract {expected}")
    print("PASS")


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("status", "publish", "rollback"):
        commands.add_parser(name)
    test = commands.add_parser("check")
    test.add_argument("release", choices=EXPECTED)
    run = commands.add_parser("run")
    run.add_argument("group", choices=("stable", "pilot"))
    for command in (test, run):
        command.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    if args.command == "status":
        print(json.dumps(route()))
    elif args.command in ("publish", "rollback"):
        switch("b" if args.command == "publish" else "a")
    else:
        release = args.release if args.command == "check" else route()[args.group]
        probe(release, args.offline)


if __name__ == "__main__":
    main()
