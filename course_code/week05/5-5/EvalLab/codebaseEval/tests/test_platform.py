import copy
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend import analysis, contracts, judge
from backend.common import copy_source, scrub
from backend.engine import Engine
from backend.retrieval import retrieve
from backend.server import handler_for
from backend.store import Store


TASK = {"name": "读取权限", "prompt": "说明权限", "tags": ["安全"], "required": True,
        "checks": [{"id": "text", "type": "contains", "value": "policy.ts"}], "rubric": "给出证据"}
STRATEGY = {"name": "策略", "system_prompt": "只读", "model": "test-model",
            "base_url": "http://127.0.0.1:1", "api_key_env": "EVAL_TEST_KEY", "rag_mode": "off",
            "top_k": 3, "input_price": None, "output_price": None, "cache_price": None}


def fake_worker(payload, cancel=None, on_event=None):
    if on_event:
        on_event({"type": "tool_execution_start", "tool_name": "read_file"})
    return {"execution_status": "completed", "result": {"final_answer": "policy.ts:12"},
            "trace": [], "audit": [{"status": "success", "tool_name": "read_file", "tool_call_id": "x"}],
            "messages": [{"usage": {"input": 10, "output": 3, "cacheRead": 0, "cacheWrite": 0}}]}


class ContractTests(unittest.TestCase):
    def test_task_valid(self):
        self.assertEqual(contracts.task(TASK)["name"], TASK["name"])

    def test_empty_checks_rejected(self):
        with self.assertRaises(ValueError):
            contracts.task({**TASK, "checks": []})

    def test_nested_regex_rejected(self):
        with self.assertRaises(ValueError):
            contracts.task({**TASK, "checks": [{"id": "bad", "type": "regex", "value": "(a+)+$"}]})

    def test_duplicate_check_rejected(self):
        with self.assertRaises(ValueError):
            contracts.task({**TASK, "checks": TASK["checks"] * 2})

    def test_strategy_price_rejected(self):
        for price in (-1, float("nan"), True):
            with self.assertRaises(ValueError):
                contracts.strategy({**STRATEGY, "input_price": price})

    def test_url_credentials_rejected(self):
        with self.assertRaises(ValueError):
            contracts.strategy({**STRATEGY, "base_url": "https://user:secret@example.com"})

    def test_total_budget(self):
        with self.assertRaises(ValueError):
            contracts.experiment({"name": "x", "task_ids": ["x"] * 51, "strategy_ids": ["a"], "trials": 10})

    def test_judge_nonexistent_evidence(self):
        with self.assertRaises(ValueError):
            judge.validate({"status": "pass", "reason": "ok", "evidence": ["fake"]}, {"answer"})

    def test_judge_unknown(self):
        self.assertEqual(judge.validate({"status": "unknown", "reason": "无证据", "evidence": []}, set())["status"], "unknown")


class AnalysisTests(unittest.TestCase):
    def sample(self, mode="live"):
        return {"id": "r", "experiment_id": "e", "task_id": "t", "strategy_id": "s", "task": TASK,
                "strategy": STRATEGY, "source_hash": "same", "mode": mode, "trial": 1,
                "execution_status": "completed", "checks": [{"status": "pass"}], "judge": {},
                "metrics": {"seconds": 1, "total_tokens": None, "cost_usd": None,
                            "known_tokens": 0, "known_cost_usd": 0, "tool_calls": 1, "tool_errors": 0},
                "outcome": "unknown"}

    def test_program_pass_needs_semantic_review(self):
        self.assertEqual(analysis.outcome(self.sample()), "unknown")

    def test_human_cannot_override_failure(self):
        run = self.sample()
        run["checks"] = [{"status": "fail"}]
        self.assertEqual(analysis.outcome(run, [{"status": "pass"}]), "fail")
        run["execution_status"] = "error"
        self.assertEqual(analysis.outcome(run, [{"status": "pass"}]), "unknown")

    def test_offline_excluded_from_success(self):
        run = self.sample("offline")
        run["outcome"] = "pass"
        self.assertEqual(analysis.summary([run])["runs"], 0)
        self.assertEqual(analysis.outcome(run, [{"status": "pass"}]), "unknown")

    def test_unknown_in_denominator(self):
        a, b = self.sample(), self.sample()
        a["outcome"] = "pass"
        value = analysis.summary([a, b])
        self.assertEqual(value["success_rate"], .5)
        self.assertEqual(value["unknown_cost_runs"], 2)

    def test_unknown_prices_not_free(self):
        usage = [{"usage": {"input": 10, "output": 2, "cacheRead": 0, "cacheWrite": 0}}]
        metrics = analysis.usage_metrics(usage, STRATEGY, 1, [])
        self.assertIsNone(metrics["cost_usd"])
        self.assertEqual(metrics["total_tokens"], 12)

    def test_cache_cost(self):
        prices = {**STRATEGY, "input_price": 1, "output_price": 2, "cache_price": .5}
        messages = [{"usage": {"input": 100, "output": 20, "cacheRead": 30, "cacheWrite": 0}}]
        metrics = analysis.usage_metrics(messages, prices, 1, [])
        self.assertAlmostEqual(metrics["cost_usd"], .000155)

    def test_pair_source_mismatch(self):
        a, b = self.sample(), self.sample()
        b.update(strategy_id="new", source_hash="different")
        experiment = {"id": "e", "task_ids": ["t"], "strategy_ids": ["s", "new"], "trials": 1, "status": "completed", "mode": "live"}
        report = analysis.compare([a, b], experiment, "s", "new")
        self.assertEqual(report["rows"], [])
        self.assertEqual(report["gate"]["decision"], "hold")

    def test_regression_holds(self):
        a, b = self.sample(), self.sample()
        a["outcome"] = "pass"
        b.update(strategy_id="new", outcome="fail")
        experiment = {"id": "e", "task_ids": ["t"], "strategy_ids": ["s", "new"], "trials": 1, "status": "completed", "mode": "live"}
        report = analysis.compare([a, b], experiment, "s", "new")
        self.assertEqual(report["rows"][0]["change"], "regressed")
        self.assertEqual(report["gate"]["decision"], "hold")

    def test_allow_audit_is_not_tool_error(self):
        audit = [{"tool_call_id": "x", "status": "allow"}, {"tool_call_id": "x", "status": "success"}]
        self.assertEqual(analysis.usage_metrics([], STRATEGY, 1, audit)["tool_errors"], 0)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.source = root / "source"
        (self.source / "src").mkdir(parents=True)
        (self.source / "src/policy.ts").write_text("policy rules", encoding="utf-8")
        (self.source / "README.md").write_text("权限 policy read Runtime", encoding="utf-8")
        self.engine = Engine(root / "data", source=self.source, worker=fake_worker)

    def tearDown(self):
        self.engine.close()
        self.temp.cleanup()

    def launch(self, mode="offline", trials=1):
        return self.engine.start({"name": "测试实验", "mode": mode,
            "task_ids": [self.engine.store.list("task")[0]["id"]],
            "strategy_ids": [s["id"] for s in self.engine.store.list("strategy")],
            "trials": trials, "timeout": 10, "max_tokens": 256})

    def finish(self, ident):
        self.engine.pool.shutdown(wait=True)
        return self.engine.store.get("experiment", ident)

    def test_crud_version_snapshot(self):
        task = self.engine.save_task(TASK)
        updated = self.engine.save_task({**task, "prompt": "new"})
        self.assertEqual(updated["version"], 2)
        self.assertEqual(task["prompt"], TASK["prompt"])

    def test_import_atomic_validation(self):
        count = len(self.engine.store.list("task"))
        with self.assertRaises(ValueError):
            self.engine.import_tasks({"tasks": [TASK, {**TASK, "checks": []}]})
        self.assertEqual(count, len(self.engine.store.list("task")))

    def test_real_missing_credentials_rejected(self):
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            with self.assertRaises(ValueError):
                self.launch("live")

    def test_offline_end_to_end(self):
        experiment = self.launch()
        completed = self.finish(experiment["id"])
        self.assertEqual(completed["completed"], 2)
        runs = self.engine.state()["runs"]
        self.assertTrue(all(r["outcome"] == "unknown" for r in runs))
        self.assertEqual(len({r["source_hash"] for r in runs}), 1)
        self.assertTrue(self.engine.get_run(runs[0]["id"])["trace"])
        ids = experiment["strategy_ids"]
        self.assertEqual(self.engine.comparison(ids[0], ids[1], experiment["id"])["gate"]["decision"], "hold")

    def test_review_history(self):
        experiment = self.launch()
        self.finish(experiment["id"])
        run = self.engine.state()["runs"][0]
        self.engine.review(run["id"], {"reviewer": "Wilson", "status": "pass", "reason": "演示确认"})
        value = self.engine.review(run["id"], {"reviewer": "Wilson", "status": "fail", "reason": "不是模型答案"})
        self.assertEqual(len(value["reviews"]), 2)
        self.assertEqual(value["outcome"], "unknown")

    def test_rag_snapshot(self):
        self.assertTrue(retrieve(self.source, "policy", "bm25", 2))
        self.assertEqual(retrieve(self.source, "policy", "off", 2), [])

    def test_symlinks_denied(self):
        (self.source / "escape.ts").symlink_to("/etc/passwd")
        with self.assertRaises(ValueError):
            copy_source(self.source, Path(self.temp.name) / "snapshot")

    def test_custom_secret_scrubbed(self):
        with patch.dict(os.environ, {"CUSTOM_KEY": "very-secret-example"}):
            self.assertEqual(scrub("key very-secret-example"), "key [REDACTED]")

    def test_restart_marks_interrupted(self):
        value = self.engine.store.put("run", {"execution_status": "running", "outcome": "unknown"})
        self.engine._recover()
        self.assertEqual(self.engine.store.get("run", value["id"])["execution_status"], "interrupted")


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = Engine(self.temp.name, worker=fake_worker)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.engine))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/api"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.engine.close()
        self.temp.cleanup()

    def test_get_state(self):
        with urlopen(self.url + "/state") as response:
            self.assertIn("tasks", json.load(response))

    def test_csrf_denied(self):
        request = Request(self.url + "/tasks", data=json.dumps(TASK).encode(),
                          headers={"Content-Type": "application/json", "Origin": "https://attacker.example"})
        with self.assertRaises(HTTPError) as ctx:
            urlopen(request)
        self.assertEqual(ctx.exception.code, 403)

    def test_invalid_import(self):
        request = Request(self.url + "/tasks/import", data=b'{"tasks":[]}',
                          headers={"Content-Type": "application/json"})
        with self.assertRaises(HTTPError) as ctx:
            urlopen(request)
        self.assertEqual(ctx.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
