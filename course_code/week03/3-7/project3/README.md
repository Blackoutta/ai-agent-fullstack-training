# project3：Codebase Agent


## 目录名对齐

| 课纲说法 | 实际路径 | 用在哪个任务 |
| --- | --- | --- |
| `sample/1_login_demo` | `samples/1_login_demo` | 任务一（只读 + 写一份文档） |
| `sample/2_bugfix` | `samples/2_bug_fix/demo-app` | 任务二（跑测试 + 改 src） |


## 模型：DeepSeek（默认口径）


- 端点 `https://api.deepseek.com`、模型 `deepseek-v4-flash`，都写在 `config/platform.yaml` 的
  `gateway` / `model` 段；想临时换，用环境变量 `GATEWAY_BASE_URL` / `GATEWAY_MODEL_ID` 覆盖即可。
- **关闭思考**：`src/pi/provider.ts` 把模型声明成 DeepSeek 那套 compat，且不给思考档位，pi-ai 就会下发
  `thinking: {type: "disabled"}`。想打开得显式抬思考档位。
- 没设 `DEEPSEEK_API_KEY` 时**不连网**，而是降级回任务条目的离线脚本，并在开头说破
  （`[决策器] mock:... · DEEPSEEK_API_KEY 未设置，降级为离线脚本决策器（...）`）。
- 想全程离线、可反复复现（课堂与 CI），显式加 `--decider mock`；详见文末「切回离线」。


## 任务 一：

### 1. 终端 A：领任务开跑

```bash
cd project3/v2
node --import tsx src/cli.ts agent "帮我找出该项目的登录逻辑，并生成 Markdown 说明文档。"   --dir ../samples/1_login_demo
```


### 2. 终端 B：人批，然后执行那张单

第 1 步的收口 JSON 里有两个长 id，别混：`trace_id` 是这一整趟 Run 的编号（给 `audit --trace-id` 用），
`pending_approval_id` 才是那张"等人批的写入单"。下面两条都填 **`pending_approval_id`**：

```bash
cd project3/v2
node --import tsx src/cli.ts approvals decide <pending_approval_id> \
  --decision approve --actor trainer-1 --roles maintainer --task understand
node --import tsx src/cli.ts approvals execute <pending_approval_id> --task understand
```

`decide` 用于审批（把单子标成 approved，不碰文件），`execute` 用于执行（真正落盘）。


### 3. 验收与复原

```bash
cat ../samples/1_login_demo/artifacts/login-flow.md
node --import tsx src/cli.ts audit --trace-id <trace_id>   # 这里的 id 才是第 1 步打印的 trace_id
node --import tsx src/cli.ts audit                         # 不带参数：dump 最近 100 条
```

复原，跑完这一趟样本仓库回到起点：

```bash
rm -rf ../samples/1_login_demo/artifacts
git -C ../samples/1_login_demo status --porcelain -uall   # 输出为空＝已复原
```


## 任务二 · 测试生成与修复：可反复执行

目标一句话：**给指定函数补充测试，并根据测试失败日志进行修复。**
Agent 要做的：跑测试拿基线 → 读失败用例与被测源码 → 定位缺陷 → 修 `src`（需要时把新测试补到 `tests/generated/`）→
复跑确认全绿 → `git_diff` 输出变更说明。样本里预置了三条红用例，缺陷在 `src/auth/session-policy.ts`：到期比较只比到“哪天”。
**已有测试禁写**（`deny_write_extra: ["tests/**"]`），靠改测试让红用例变绿这条路被沙箱堵死；
新增测试只能落在 `tests/generated/**`（`allow_write_extra` 单点放开，靠沙箱的“允许例外”机制生效）。

这一类任务的审批默认交给 LangGraph 那张图（`via: http`），并且额外把 `run_test` 点名进了门口——
它自带"不需确认"，但这一趟要执行仓库里的 npm script，所以必须过人。所以要三个终端。

### 1. 终端 1：把审批图起起来

```bash
cd project3/v2
HITL_API_KEY=demo-key HITL_DB=/tmp/hitl-demo.db ../.venv/bin/python -u hitl/service.py
```

`-u` 是为了那行启动信息立刻可见（Python 的 stdout 在被重定向时是全缓冲的）。
```text
{"host": "127.0.0.1", "port": 8383, "checkpoint_db": "/private/tmp/hitl-demo.db"}
```

图会一直占着这个终端。另开一条命令确认它还活着（`demo-key` 是这里现编的演示值，不是任何真实凭据）：

```bash
curl -s -H "Authorization: Bearer demo-key" http://127.0.0.1:8383/health
```

```text
{"status":"ok","graph":"approval","checkpoint_db":"/private/tmp/hitl-demo.db"}
```

### 2. 终端 2：领任务开跑

```bash
cd project3/v2
HITL_API_KEY=demo-key node --import tsx src/cli.ts agent "给登录会话模块补充测试并修复失败用例" \
  --task fix_tests --dir ../samples/2_bug_fix/demo-app
```


### 3. 终端 1（或终端 3）：逐单批，图放行后 Loop 自己往下走

```bash
cd project3/v2
HITL_API_KEY=demo-key node --import tsx src/cli.ts approvals tickets --task fix_tests
HITL_API_KEY=demo-key node --import tsx src/cli.ts approvals decide <ticketId> \
  --decision approve --actor lead-1 --roles tech_lead --task fix_tests
```

### 4. 顺手看一眼红线（可选，一分钟）

同一条流程，把批单的人换成名单外的角色：

```bash
HITL_API_KEY=demo-key node --import tsx src/cli.ts approvals decide <ticketId> \
  --decision approve --actor dev-9 --roles developer --task fix_tests
```

```text
{
  "ticketId": "236727d2-c755-451d-904e-0a9cb599ec16",
  "status": "rejected",
  "code": "APPROVER_ROLE_DENIED",
  "decidedBy": "dev-9",
  "feedback": "审批人角色 developer 不在审批名单 maintainer、tech_lead 里"
}
```

跑 agent 的那个终端当场收口，收口码就是图给的那一个：

```json
{ "stop": true, "code": "APPROVER_ROLE_DENIED", "reason": "审批人角色 developer 不在审批名单 maintainer、tech_lead 里" }
```

"谁能批"不写在任何一段提示词里，改的是 `config/tasks.yaml` 的 `approval.approvers`；名单清空更狠，
图在第一道门就把单子弹回（`NO_APPROVER_CONFIGURED`），连人都不会惊动。这一步之后样本仓库未改动，
回到第 2 步重跑一遍即可。

### 5. 验收与复原

先确认基线：开工前跑这一条，样本仓库自己报的是 4 过 3 红（缺陷没修）。

```bash
npm --prefix ../samples/2_bug_fix/demo-app test --silent | grep "ℹ tests\|ℹ pass\|ℹ fail"
```

```text
ℹ tests 7
ℹ pass 4
ℹ fail 3
```

跑完这一趟（第 2 步到第 3 步）再看两处。一处是改动范围：

```bash
git -C ../samples/2_bug_fix/demo-app diff --stat
```

```text
 src/auth/session-policy.ts | 4 +---
 1 file changed, 1 insertion(+), 3 deletions(-)
```

三行日期串比较换成一行时间戳比较，`tests/` 一行未动。另一处是结果：

```bash
npm --prefix ../samples/2_bug_fix/demo-app test --silent | grep "ℹ tests\|ℹ pass\|ℹ fail"
```

```text
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

复原，让下一趟从同一条红基线开始：

```bash
git -C ../samples/2_bug_fix/demo-app checkout -- src/auth/session-policy.ts
git -C ../samples/2_bug_fix/demo-app status --porcelain -uall   # 输出为空＝已复原
pkill -f "hitl/service.py"
```

### 6. 不想起图的时候：一个前缀退到本地表

```bash
cd project3/v2
HITL_MODE=disabled node --import tsx src/cli.ts agent "给登录会话模块补充测试并修复失败用例" --task fix_tests
```

```json
{ "stop": { "stop": true, "code": "AWAITING_APPROVAL", "reason": "工具调用正在等待人工审批" },
  "pending_approval_id": "2899fa99-28a8-4783-8020-e3506548ada4" }
```

`HITL_MODE` 这一层永远大过 `tasks.yaml`，但它只换裁定人，不动门口：`审批门口=[run_test]` 照旧生效，
所以第一次 `run_test` 仍被拦下。区别在于本地表不会等——Loop 当场收口，之后按任务一那两条
`approvals decide` / `approvals execute` 手动执行这张单，一次只推进一步。
想一遍跑到底、看 Loop 自己等到放行再继续，就用上面那张图。

图没起起来时会怎样，取决于你少了哪一层，两种都会当场停手而不是"当它是批准了"：

```text
# 忘了带 HITL_API_KEY（客户端就不发这一趟 HTTP）
{ "stop": true, "code": "HITL_KEY_MISSING", "reason": "审批服务需要环境变量 HITL_API_KEY" }

# 带了密钥但图没起
{ "stop": true, "code": "HITL_UNREACHABLE", "reason": "审批服务 http://127.0.0.1:8383 不可达：先起 hitl/service.py（fetch failed）" }
```

两种情况下样本仓库都未被改动（`git status --porcelain -uall` 输出为空），起好图重跑第 2 步即可。

## 换 pi 入口跑同一趟

同一份运行时，装进 pi 的扩展点里跑。默认也是 DeepSeek；没设 `DEEPSEEK_API_KEY` 就降级回离线脚本并说破
（这里的 `--offline` 只关掉 pi 启动期的联网检查，不拦模型请求）：

```bash
cd project3/v2
./node_modules/.bin/pi --print --offline --no-session --no-builtin-tools --no-skills \
  -e src/pi/coding-agent-extension.ts --managed-task understand \
  "帮我找出该项目的登录逻辑，并生成 Markdown 说明文档。"
```

```text
[决策器] real:deepseek/deepseek-v4-flash · DEEPSEEK_API_KEY 已设置，连接 https://api.deepseek.com
[决策器 · 第1步] real:deepseek/deepseek-v4-flash
...
```

同一个门口，两条入口的收口时机不同：CLI 在拦下写入那一步就停环等人，pi 的 Loop 没有"还要不要继续"这个钩子，
它把拒绝文案当成工具结果喂回去、继续往下走，最后**自己宣布审批已通过**——而文件没落盘。
这就是交付物那一行会写"自述无据 是"的原因：判断只能以审计为准，不能听模型自述。

`--no-skills` 也别省：pi 自带系统提示词 29,792 字符（含技能目录），去掉之后只剩 2,777 字符，
同一趟从 46,869 token 降到 20,197 token。`config/platform.yaml` 里的 `max_total_tokens: 30000`
是按去掉之后校准的。

## 切回离线（可选）

真模型是默认口径，但它不照脚本走：同一个目标可能烧满 12 次工具调用停在 `MAX_TOOL_CALLS`，
每趟输出也不一样，不适合当"可反复执行"的课堂演示。要回到确定性、不联网的那一套：

```bash
cd project3/v2
# mock：只准离线；没脚本直接报 SCRIPT_REQUIRED
node --import tsx src/cli.ts agent "帮我找出该项目的登录逻辑，并生成 Markdown 说明文档。" \
  --dir ../samples/1_login_demo --decider mock

# auto：有离线脚本就用脚本，没有才连 DeepSeek
node --import tsx src/cli.ts agent "帮我找出该项目的登录逻辑，并生成 Markdown 说明文档。" \
  --dir ../samples/1_login_demo --decider auto
```

`--decider` 三档：`real`（默认，直连 DeepSeek；没密钥降级到脚本并说破）/ `auto`（离线优先）/
`mock`（只准离线）。三种口径都会把"这一趟是谁在决策"打在开头，并写进 `decider.selected` 这笔账。

## 复跑之前，先看这三件事

1. 两个样本仓库都要干净：`git -C samples/1_login_demo status --porcelain -uall` 与
   `git -C samples/2_bug_fix/demo-app status --porcelain -uall` 都输出为空。
2. 审批账本 `v2/data/platform.db` 是运行产物，会一直攒单。想从干净账本开始就删掉它——
   连同历史审计与 Trace 一起没了，转录要事先留好。
3. 构建配置改不动：`config/platform.yaml` 的 `sandbox.deny_write` 写着 `package.json`、
   `package-lock.json`、`tsconfig.json`、`**/node_modules/**`、`.git/**`。Agent 试图改这些会被策略拒绝，
   拒绝原因当工具结果喂回模型，它得换路。
   沙箱还有一层“允许例外”：`sandbox.allow_write`（平台级）与任务条目的 `allow_write_extra`——
   命中 `deny_write` 但落在允许名单里的路径放行。默认都是空，行为与以前完全一致；
   任务二就是用它在封死的 `tests/` 里单点放开 `tests/generated/**`。

## 评估入口

一条命令把各类任务各跑一遍，汇出可复核的报告（默认离线、不代人批准）：

```bash
cd project3/v2
node --import tsx src/cli.ts eval                     # 跑 tasks.yaml 里的全部任务类型
node --import tsx src/cli.ts eval --case fix_tests    # 只跑点名的任务类型
node --import tsx src/cli.ts eval --decider real       # 想连真模型评估时显式指定
```

报告落两份：`artifacts/eval_report.md` 与 `artifacts/eval_report.json`。每次评估使用独立工作副本与独立账本
（`project3/.eval-runs/<时间>-<任务>/`），工作副本路径、账本路径与 Trace 编号都写进报告，便于逐条复核。
**执行状态**（已完成 / 待审批 / 已停止）与**验收结论**（交付物有没有账）分开记：待审批的任务绝不会被计为完成，
自动生成报告不等于自动批准。

## 这一节还不做

- 不接 MCP：十件工具走 pi 的 `registerTool` 扩展点，装配在 `session_start`。
- 不改样本的已有测试来让它变绿；`tests/**` 的禁写红线由沙箱保证，新增测试只能写 `tests/generated/`。
