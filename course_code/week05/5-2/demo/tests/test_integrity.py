import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from common import FIXTURE, snapshot, evidence_ok
from delegation import aggregate
from acceptance import verify
from graders import grade_readonly
from trace_analysis import analyze
from compare import compare

FIXED = 'def list_orders(db, user_id):\n    rows = db.execute("SELECT o.id, o.user_id, i.sku FROM orders o LEFT JOIN order_items i ON i.order_id = o.id WHERE o.user_id = ? ORDER BY o.id, i.id", (user_id,)).fetchall()\n    result = {}\n    for order_id, owner, sku in rows:\n        item = result.setdefault(order_id, {"id": order_id, "user_id": owner, "items": []})\n        if sku is not None:\n            item["items"].append(sku)\n    return list(result.values())\n'

class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name) / "project"
        shutil.copytree(FIXTURE, self.project)
        self.before = snapshot(self.project)

    def tearDown(self):
        self.tmp.cleanup()

    def test_evidence_rejects_escape_and_empty_excerpt(self):
        self.assertFalse(evidence_ok(self.project, {"path": "../secret", "excerpt": "x"}, self.before))
        self.assertFalse(evidence_ok(self.project, {"path": "app/orders.py", "excerpt": ""}, self.before))

    def test_snapshot_change_invalidates_old_evidence(self):
        path = self.project / "app/orders.py"
        path.write_text(FIXED)
        self.assertFalse(evidence_ok(self.project, {
            "path": "app/orders.py", "excerpt": "SELECT id, user_id FROM orders ORDER BY id"}, self.before))

    def test_conflict_is_retained(self):
        evidence = [{"path": "app/orders.py", "excerpt": "SELECT id, user_id FROM orders ORDER BY id"}]
        finding = {"issue_key": "expiry", "claim": "无用户过滤", "severity": "high", "evidence": evidence}
        raw = {"results": [
            {"task_id": "security", "status": "completed", "findings": [finding]},
            {"task_id": "test", "status": "completed", "findings": [dict(finding, claim="已有用户过滤")]},
        ]}
        result = aggregate(self.project, raw, self.before)
        self.assertTrue(result["needs_review"])
        self.assertEqual(len(result["conflicts"]), 1)

    def test_existing_tests_green_does_not_hide_tenant_leak(self):
        result = verify(self.project, self.before)
        self.assertTrue(result["checks"]["existing_tests_passed"])
        self.assertFalse(result["checks"]["only_current_user"])
        self.assertFalse(result["passed"])

    def test_join_fix_passes_independent_acceptance(self):
        path = self.project / "app/orders.py"
        path.write_text(FIXED)
        self.assertTrue(verify(self.project, self.before)["passed"])

    def test_protected_test_edit_fails_even_after_fix(self):
        path = self.project / "app/orders.py"
        path.write_text(FIXED)
        tests = self.project / "tests/test_orders.py"
        tests.write_text(tests.read_text() + "\n# unauthorized\n")
        result = verify(self.project, self.before)
        self.assertTrue(result["checks"]["only_current_user"])
        self.assertFalse(result["checks"]["protected_tests_unchanged"])
        self.assertFalse(result["passed"])

    def test_retrieval_wrong_fact_with_real_excerpt_fails(self):
        answer = json.dumps({"max_selects": 9, "source": "docs/current.md",
                             "evidence": [{"path": "docs/current.md", "excerpt": "2 次 SELECT"}]})
        grade = grade_readonly(answer, {"kind": "retrieve"}, self.project, self.before,
                              {"status": "exited", "snapshot_unchanged": True})
        self.assertFalse(grade["passed"])
        self.assertTrue(grade["checks"]["literal_evidence"])

    def test_partial_usage_not_double_counted(self):
        result = analyze([
            {"type": "message_update", "usage": {"input": 100, "output": 1}},
            {"type": "message_update", "usage": {"input": 100, "output": 2}},
            {"type": "message_end", "message": {"role": "assistant",
             "usage": {"input": 100, "output": 2, "cacheRead": 0, "cacheWrite": 0}}},
        ])
        self.assertEqual(result["tokens"]["input"], 100)
        self.assertIsNone(result["billing_cost"])

    def test_unfinished_tool_is_unknown(self):
        result = analyze([{"type": "tool_execution_start", "toolCallId": "x", "toolName": "read"}])
        self.assertEqual(result["pending_ids"], ["x"])
        self.assertIn("unfinished_tool_calls", result["labels"])
        self.assertIsNone(result["root_cause"])

    def test_regression_blocks_release(self):
        old = {"dataset_version": "v1", "results": [{"case_id": "a", "passed": True}]}
        new = copy.deepcopy(old)
        new["results"][0]["passed"] = False
        self.assertEqual(compare(old, new)["regressions"], ["a"])
        self.assertFalse(compare(old, new)["allow_release"])

    def test_changed_case_set_cannot_be_compared(self):
        old = {"dataset_version": "v1", "results": [{"case_id": "a", "passed": True}]}
        new = {"dataset_version": "v1", "results": [{"case_id": "b", "passed": True}]}
        with self.assertRaises(ValueError):
            compare(old, new)

if __name__ == "__main__":
    unittest.main()

