"""Local same-origin API and static Vue application server."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .analysis import markdown_report
from .common import ROOT, load_env, scrub
from .engine import Engine


def handler_for(engine):
    class Handler(BaseHTTPRequestHandler):
        server_version = "CodebaseEval/1.0"

        def log_message(self, *_args):
            pass

        def send(self, status, value, content_type="application/json; charset=utf-8", attachment=None):
            payload = json.dumps(scrub(value), ensure_ascii=False, allow_nan=False).encode() if content_type.startswith("application/json") else value
            if isinstance(payload, str):
                payload = payload.encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json") else "no-cache")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
            if attachment:
                self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
            self.end_headers()
            self.wfile.write(payload)

        def safe_request(self):
            host = self.headers.get("Host", "")
            expected = {f"localhost:{self.server.server_port}", f"127.0.0.1:{self.server.server_port}"}
            if host not in expected:
                raise PermissionError("仅允许本机同源请求")
            origin = self.headers.get("Origin")
            if origin and origin not in {f"http://{h}" for h in expected}:
                raise PermissionError("拒绝跨站请求")

        def body(self):
            if self.headers.get_content_type() != "application/json":
                raise ValueError("请求必须使用 application/json")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1_000_000:
                raise ValueError("请求大小必须为 1 到 1000000 字节")
            self.connection.settimeout(10)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("请求体不完整")
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError("JSON 必须为对象")
            return value

        def dispatch(self):
            try:
                self.safe_request()
                self.route()
            except PermissionError as exc:
                self.send(403, {"error": str(exc)})
            except KeyError as exc:
                self.send(404, {"error": str(exc)})
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                self.send(400, {"error": str(exc)})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                self.send(500, {"error": "平台内部错误，请查看本机服务状态"})

        def route(self):
            parsed = urlparse(self.path)
            parts = [unquote(p) for p in parsed.path.split("/") if p]
            method = self.command
            if not parts or parts[0] != "api":
                if method != "GET":
                    return self.send(405, {"error": "方法不支持"})
                return self.static(parsed.path)
            route = parts[1:]
            if method == "GET" and route == ["state"]:
                return self.send(200, engine.state())
            if method == "GET" and route == ["tasks", "export"]:
                return self.send(200, {"tasks": engine.store.list("task")}, attachment="benchmark.json")
            if method == "POST" and route == ["tasks", "import"]:
                return self.send(201, engine.import_tasks(self.body()))
            if method == "POST" and route == ["tasks"]:
                return self.send(201, engine.save_task(self.body()))
            if method == "POST" and route == ["strategies"]:
                return self.send(201, engine.save_strategy(self.body()))
            if method == "DELETE" and len(route) == 2 and route[0] in {"tasks", "strategies"}:
                engine.store.delete("task" if route[0] == "tasks" else "strategy", route[1])
                return self.send(200, {"deleted": True})
            if method == "POST" and route == ["experiments"]:
                return self.send(201, engine.start(self.body()))
            if method == "POST" and len(route) == 3 and route[0] == "experiments" and route[2] == "cancel":
                self.body()
                return self.send(200, engine.cancel(route[1]))
            if method == "GET" and len(route) == 2 and route[0] == "runs":
                return self.send(200, engine.get_run(route[1]))
            if method == "POST" and len(route) == 3 and route[0] == "runs":
                data = self.body()
                if route[2] == "judge":
                    return self.send(200, engine.run_judge(route[1]))
                if route[2] == "reviews":
                    return self.send(201, engine.review(route[1], data))
            if method == "GET" and route in [["compare"], ["reports"]]:
                query = parse_qs(parsed.query)
                report = engine.comparison(query.get("baseline", [""])[0], query.get("candidate", [""])[0],
                                           query.get("experiment", [""])[0])
                if route == ["compare"]:
                    return self.send(200, report)
                if query.get("format", ["json"])[0] == "md":
                    return self.send(200, markdown_report(report), "text/markdown; charset=utf-8", "regression.md")
                return self.send(200, report, attachment="regression.json")
            self.send(404, {"error": "API 路径不存在"})

        def static(self, url):
            base = (ROOT / "frontend/dist").resolve()
            path = (base / unquote(url).lstrip("/")).resolve()
            if not path.is_relative_to(base):
                return self.send(403, {"error": "非法路径"})
            if not path.is_file():
                path = base / "index.html"
            if not path.is_file():
                return self.send(503, "请先执行 npm run setup 构建前端", "text/plain; charset=utf-8")
            self.send(200, path.read_bytes(), mimetypes.guess_type(str(path))[0] or "application/octet-stream")

        do_GET = dispatch
        do_POST = dispatch
        do_DELETE = dispatch

    return Handler


def main():
    load_env()
    parser = argparse.ArgumentParser(description="本地 Codebase Eval 平台")
    parser.add_argument("--port", type=int, default=int(os.environ.get("EVAL_PORT", "8765")))
    parser.add_argument("--data-dir", default=os.environ.get("EVAL_DATA_DIR", str(Path.home() / ".codebase-eval")))
    args = parser.parse_args()
    engine = Engine(args.data_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(engine))
    print(f"Codebase Eval: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        engine.close()


if __name__ == "__main__":
    main()
