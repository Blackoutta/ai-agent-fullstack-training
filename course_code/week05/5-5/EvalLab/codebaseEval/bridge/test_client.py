import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bridge_client", Path(__file__).with_name("client.py"))
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class ClientTests(unittest.TestCase):
    def payload(self, directory):
        return {"workspace": str(client.CODEBASE), "run_dir": directory,
                "task": {"prompt": "检查策略"},
                "strategy": {"system_prompt": "只读", "model": "test", "base_url": "http://127.0.0.1:1",
                             "api_key_env": "EVAL_BRIDGE_MISSING_KEY"},
                "mode": "offline", "max_tokens": 1024, "timeout": 45}

    def test_offline(self):
        with tempfile.TemporaryDirectory() as directory:
            result = client.run_worker(self.payload(directory))
        self.assertEqual(result["execution_status"], "completed")
        self.assertEqual(len(result["messages"]), 2)
        self.assertTrue(any(row["event_type"] == "tool_execution" and row["code"] == "OK"
                            for row in result["audit"]))

    def test_cancel_and_timeout_kill_process_group(self):
        real_popen = subprocess.Popen
        for cancelled in (False, True):
            with self.subTest(cancelled=cancelled):
                processes = []

                def spawn(*args, **kwargs):
                    # 真实独立进程组，不等待网络或依赖 Runtime。
                    process = real_popen(
                        ["node", "-e", "require('child_process').spawn(process.execPath,"
                         "['-e','setInterval(()=>{},1000)']);setInterval(()=>{},1000)"],
                        **kwargs)
                    processes.append(process)
                    return process

                cancel = threading.Event()
                if cancelled:
                    cancel.set()
                with patch.object(client.subprocess, "Popen", side_effect=spawn), \
                        patch.object(client.os, "killpg", wraps=os.killpg) as killpg:
                    result = client.run_worker({"timeout": 0.3}, cancel=cancel)
                self.assertEqual(result["execution_status"], "error")
                self.assertIn("ABORTED" if cancelled else "TIMEOUT", result["result"]["error"])
                killpg.assert_called_once_with(processes[0].pid, signal.SIGKILL)
                self.assertIsNotNone(processes[0].returncode)

    def test_missing_live_key_never_falls_back(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"EVAL_BRIDGE_MISSING_KEY": ""}):
            payload = self.payload(directory)
            payload["mode"] = "live"
            result = client.run_worker(payload)
        self.assertEqual(result["execution_status"], "error")
        self.assertEqual(result["messages"], [])
        self.assertIn("禁止降级", result["result"]["error"])

    def test_paths_are_absolute(self):
        command = client.worker_command()
        self.assertTrue(Path(command[2]).is_absolute())
        self.assertTrue(Path(command[3]).is_absolute())


if __name__ == "__main__":
    unittest.main()
