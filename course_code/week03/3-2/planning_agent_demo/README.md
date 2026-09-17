# Planning Agent Demo

3.2 的配套工程：在 3.1 的 pi Agent Loop 上接入计划层，跑通「修复登录模块到期边界失败测试」的完整闭环。

## 跑起来

```bash
npm install
npm test          # 计划规则 + Loop 集成，共 18 个用例
npm run build     # tsc 类型检查
npm start         # 接真实 Gateway，模型驱动同一条 Loop，中文输出
```

## 结构

沿用 3.1 的文件分工，本节新增计划相关模块：

|文件|职责|
|---|---|
|`src/model.ts`|模型注册，接入 Gateway（与 3.1 相同）|
|`src/run-context.ts`|一次 Run 的路径边界，以及目标/边界/回归三组测试范围|
|`src/runtime.ts`|受控执行入口：读写文件、`apply_patch`、`run_test`，并产出证据|
|`src/plan-store.ts`|计划状态：依赖检查、证据校验、原子修订、修订预算|
|`src/plan-tools.ts`|`create_plan` / `get_plan` / `update_plan_step` / `revise_plan`|
|`src/completion-contract.ts`|完成契约：代码理解任务与修复任务各一份|
|`src/planning-prompt.ts`|运行提示词与每轮替换的计划快照|
|`src/pi-tools.ts`|把 Runtime 与计划层适配成 pi 的 AgentTool|
|`src/loop-guard.ts`|轮数、重复动作、计划门禁、完成契约与 Follow-up|
|`src/agent-runner.ts`|装配 pi Loop 与计划层|
|`src/main.ts`|真实 Gateway 入口，打印计划与证据摘要|
|`tests/plan-store.test.ts`|计划层不变量|
|`tests/agent-runner.test.ts`|Loop 集成：拦截、证据、修订、完成契约|
|`fixtures/demo-app/`|目标仓库：登录流程 + 待修复的会话有效期判断|

## 案例

`fixtures/demo-app/src/auth/session-policy.ts` 的 `isSessionExpired` 只比较 UTC 日期，
会话会晚最多 24 小时失效。CI 里只在跨 UTC 日界线时偶发失败，课堂用固定时钟在
`tests/session-boundary.test.ts` 里稳定复现。

修复前 `tests/session-policy.test.ts` 与 `tests/session-boundary.test.ts` 失败，
`tests/login-flow.test.ts` 通过。修复只改 `session-policy.ts`，公共 API 不变。

## 课堂观察点

1. `modifyPasswordLogic` 在 `reproduce` 完成前不能启动。
2. 没有证据、证据不属于该步骤、证据满足不了验收条件，三种情况都不能完成。
3. `revise_plan` 保留旧步骤并标记 `skipped`，下游依赖原子改接到新步骤。
4. 修订必须带理由和证据，并受 `maxRevisions` 限制；校验失败时原计划一字不变。
5. 当前代码版本之外的测试通过结果不能用于交付。
6. 计划已创建时，写入、改代码、跑测试必须携带 `planStepId`，否则在执行前被拦下。
7. 模型提前给出 Final Answer 不会结束任务，完成契约会拒绝并注入 Follow-up。
