"""Streaming, partial accounting and dataset isolation regression tests."""
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from backend import judge
from backend.common import copy_source
from backend.engine import Engine, bridge
from test_platform import TASK, STRATEGY, fake_worker


class Response(io.BytesIO):
    headers = {"x-request-id": "test-request"}


class JudgeStreamTests(unittest.TestCase):
    def score(self, content, done=True, usage=None):
        chunks = [{"model": "served-model", "choices": [{"delta": {"content": content}}]}]
        if usage is not None:
            chunks.append({"usage": usage, "choices": []})
        body = "".join("data: " + json.dumps(c) + "\n\n" for c in chunks)
        if done:
            body += "data: [DONE]\n\n"
        run = {"strategy": {**STRATEGY, "input_price": 1, "output_price": 2, "cache_price": .5},
               "task": TASK, "answer": "policy.ts:12", "audit": [], "trace": []}
        with patch.dict(os.environ, {"EVAL_TEST_KEY": "test-only"}), \
                patch.object(judge.urllib.request, "urlopen", return_value=Response(body.encode())):
            return judge.evaluate(run)

    def test_complete_stream_with_usage(self):
        result = self.score('{"status":"pass","reason":"source evidence","evidence":["answer"]}',
                            usage={"prompt_tokens": 100, "completion_tokens": 20,
                                   "prompt_tokens_details": {"cached_tokens": 30}})
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["tokens"], 120)
        self.assertAlmostEqual(result["cost_usd"], .000125)
        self.assertEqual(result["request_id"], "test-request")
        self.assertEqual(result["served_model"], "served-model")

    def test_missing_done_is_not_grade_but_retains_usage(self):
        result = self.score('{"status":"pass","reason":"ok","evidence":["answer"]}', done=False,
                            usage={"prompt_tokens": 10, "completion_tokens": 3})
        self.assertEqual(result["status"], "error")
        self.assertIn("DONE", result["reason"])
        self.assertEqual(result["tokens"], 13)

    def test_nonexistent_reference_is_error(self):
        result = self.score('{"status":"pass","reason":"ok","evidence":["invented"]}')
        self.assertEqual(result["status"], "error")

    def test_malformed_json_is_error(self):
        self.assertEqual(self.score("not JSON")["status"], "error")

    def test_invalid_usage_is_unknown_not_negative_cost(self):
        for value in (-1, True):
            result = self.score('{"status":"unknown","reason":"no evidence","evidence":[]}',
                                usage={"prompt_tokens": value, "completion_tokens": 2})
            self.assertNotIn("tokens", result)
            self.assertIsNone(result["cost_usd"])


class AccountingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.source = Path(self.temp.name) / "source"
        (self.source / "src").mkdir(parents=True)
        (self.source / "src/policy.ts").write_text("policy rules")
        self.engine = Engine(Path(self.temp.name) / "data", source=self.source, worker=fake_worker)

    def tearDown(self):
        self.engine.close()
        self.temp.cleanup()

    def test_repeat_judge_accumulates_cost_tokens_and_time(self):
        run = self.engine.store.put("run", {"mode": "live", "execution_status": "completed",
            "checks": [{"status": "pass"}], "judge": {}, "metrics": {
                "agent_cost_usd": .2, "known_cost_usd": .2, "cost_usd": .2,
                "known_tokens": 10, "total_tokens": 10, "seconds": 1}})
        result = {"status": "pass", "reason": "ok", "evidence": ["answer"],
                  "cost_usd": .1, "tokens": 5, "seconds": 2}
        with patch.object(judge, "evaluate", return_value=result):
            self.engine.run_judge(run["id"])
            final = self.engine.run_judge(run["id"])
        self.assertEqual(len(final["judge_history"]), 2)
        self.assertAlmostEqual(final["metrics"]["known_cost_usd"], .4)
        self.assertAlmostEqual(final["metrics"]["cost_usd"], .4)
        self.assertEqual(final["metrics"]["total_tokens"], 20)
        self.assertEqual(final["metrics"]["seconds"], 5)

    def test_partial_worker_retains_known_usage_not_complete_total(self):
        events = [{"type": "message", "usage": {"input": 10, "output": 2, "cacheRead": 0, "cacheWrite": 0}},
                  {"type": "tool_execution_start", "tool_call_id": "x", "tool_name": "read_file"},
                  {"type": "tool_execution_end", "tool_call_id": "x", "tool_name": "read_file", "is_error": False}]
        self.engine.worker = lambda *args, **kwargs: bridge._error("TIMEOUT: terminated", events)
        task = self.engine.store.list("task")[0]
        run = self.engine.store.put("run", {"experiment_id": "e", "task": task, "strategy": STRATEGY,
            "mode": "live", "trace": [], "audit": [], "metrics": {}})
        copy_source(self.source, self.engine.store.directory / "experiments/e/initial")
        self.engine._execute_run({"id": "e", "mode": "live", "timeout": 10, "max_tokens": 256},
                                 run, threading.Event())
        metrics = self.engine.get_run(run["id"])["metrics"]
        self.assertEqual(metrics["known_tokens"], 12)
        self.assertIsNone(metrics["total_tokens"])
        self.assertIsNone(metrics["cost_usd"])
        self.assertEqual(metrics["tool_calls"], 1)

    def test_snapshots_exclude_reference_answers_and_scripts(self):
        for path in ("demos/reference/expected.md", "config/scripts/answers.yaml", ".env"):
            destination = self.source / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text("reference answer or secret")
        target = Path(self.temp.name) / "snapshot"
        copy_source(self.source, target)
        self.assertTrue((target / "src/policy.ts").is_file())
        self.assertFalse((target / "demos/reference/expected.md").exists())
        self.assertFalse((target / "config/scripts/answers.yaml").exists())
        self.assertFalse((target / ".env").exists())

    def test_delete_all_tasks_does_not_reseed(self):
        for task in self.engine.store.list("task"):
            self.engine.store.delete("task", task["id"])
        self.engine.close()
        self.engine = Engine(Path(self.temp.name) / "data", source=self.source, worker=fake_worker)
        self.assertEqual(self.engine.store.list("task"), [])
