# 治理桥接

固定使用同级 `codebase` 的 `buildPlatform → runManagedAgent`，不复刻 Loop。
源码手动变更仅在本目录、`codebase/src/pi/agent-runner.ts` 和对应 `tests/unit`。

## 运行

以下命令从课程工作区根目录执行。`tsx` 必须使用 Codebase 内的绝对 loader，
桥接目录无需安装依赖。需要 Node >=22.19，Python >=3.10。

```sh
ROOT="$PWD"
python3 -c 'import json,pathlib,tempfile; print(json.dumps({
 "workspace": str(pathlib.Path("codebase").resolve()),
 "run_dir": tempfile.mkdtemp(prefix="eval-bridge-"),
 "task": {"prompt": "说明 PolicyEngine 的只读治理"},
 "strategy": {"system_prompt": "仅根据源码回答", "model": "deepseek-v4-flash",
   "base_url": "https://api.deepseek.com", "api_key_env": "DEEPSEEK_API_KEY",
   "rag_mode": "off", "top_k": 5,
   "input_price": None, "output_price": None, "cache_price": None},
 "mode": "offline", "max_tokens": 2048, "timeout": 45
}, ensure_ascii=False))' |
node --import "$ROOT/codebase/node_modules/tsx/dist/esm/index.mjs" \
  "$ROOT/codebaseEval/bridge/worker.ts"
```

这是离线脚本演示：显式 `mock` + inline script，真实 Runtime 读取 `src/policy.ts`，
再输出带演示声明的固定回答。工具成功与否看 audit，不能将这段回答当作模型解题或通过成绩。
`faux` usage 是脚本决策器的实际统计，不是真实模型 Token 消耗或费用。

Live 将 `mode` 改为 `live`，在启动前由安全渠道配置 `strategy.api_key_env` 对应的环境变量。
桥接预检查凭据，显式 `real`，无任务脚本可降级；缺少凭据直接返回 error，不发网络请求。
测试不使用 live 网络。

## 契约

stdin 一行 JSON：`{workspace,run_dir,task,strategy,mode,max_tokens,timeout}`。
`timeout` 单位秒；`max_tokens` 是每次模型响应上限，总预算仍遵循原 YAML。
`task.prompt` 必须已包含 Python 检索注入的证据，Node 不重复检索。
策略字段采用 `design/architecture.md` 定义，价格允许 null；
null 在 Runtime 预算侧按 0 处理，并不表示已知免费，父端仍须用策略快照标记费用未知。

stdout 仅 JSONL：`start`、`decider`、`message`、工具开始/结束摘要以及唯一最终结果：

```json
{"type":"result","result":{},"trace":[],"audit":[],"messages":[{"usage":{},"stopReason":"stop","errorMessage":null,"model":"...","provider":"...","text":"..."}],"execution_status":"completed"}
```

`result` 是原运行器返回对象，含 `final_answer/stop/decider`；启动异常时含
`final_answer:""` 与 `error`。trace/audit 为原 Store 记录，JSON 字段保留原结构。
只有 Runtime 的 `COMPLETED` 且没有模型 error/aborted 才标 completed；
预算终止、待审批、异常和模型 error/aborted 均标 error。
工具错误保留在 audit，由评测检查判定，不伪装成功。
messages 只投影 assistant 的文本、usage、终止原因、错误、模型和 provider，不输出 thinking。
Node 警告等 stderr 不混入 JSONL。

每次从原 `platform.yaml` 解析重写 `run_dir/governance-*/` 下的配置、提示词、空任务表和独立 SQLite。
路径全部绝对，保留原读路径禁令和审批机制，不使用原账本，不自动审批。
白名单固定 `list_files/search_code/read_file/read_directory/git_diff/git_status`，
角色 reviewer、执行模式 plan、所有写路径禁用；Runtime memory/RAG 关闭。
课堂 `GATEWAY_BASE_URL/GATEWAY_MODEL_ID/HITL_MODE` 覆盖在运行期间屏蔽并恢复。

Python 父端集成使用 `bridge.client.run_worker(payload, cancel=threading.Event(), on_event=...)`。
它创建独立进程组，超时或取消 `killpg(SIGKILL)` 并回收进程；返回上述最终结构。
`on_event` 在子进程结束后按 JSONL 顺序回放，不是实时流式回调。
调用方应传隔离工作副本和运行目录；worker 只读源码，配置/账本写入 run_dir。
直接执行 Node 命令只受 Runtime 轮次预算约束，网络卡住时的硬超时必须由 Python 父端保障。

## 验证

```sh
codebase/node_modules/.bin/vitest run codebaseEval/bridge/worker.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s codebaseEval/bridge -p 'test_*.py' -v
npm --prefix codebase run check
```

Core 回归须从 `codebase` 目录运行：

```sh
./node_modules/.bin/vitest run tests/unit
```

当前课程副本缺少 `samples/2_bug_fix/demo-app`，原 `kg_eval.test.ts` 的样本复制用例会
在进入 Runtime 前报 ENOENT。无需补造源码或改原测试；其余 core 回归可独立运行：

```sh
./node_modules/.bin/vitest run tests/unit --exclude tests/unit/kg_eval.test.ts
```
