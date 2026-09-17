# 登录模块会话过期边界问题 —— 修复记录

## 1. 结论摘要

**未发现需要修复的会话过期边界缺陷，未对源码做任何改动。**

任务前提（"会话过期边界存在问题"）在本次取证中被证据推翻：在源码未改动的状态下，
目标测试、边界测试、回归测试三个范围**全部通过**（真实退出码 0），且 `isSessionExpired`
的实现已采用精确时间戳比较，边界语义正确。按照任务约束"先取证再改代码、不基于猜测修改"，
在无可复现失败、无确认根因的情况下不做修改，否则将构成无依据改动并可能引入真实回归。

## 2. 涉及的真实实现（取证，非按文件名推测）

| 文件 | 职责 | 关键事实 |
|---|---|---|
| `src/auth/session-policy.ts` | 会话过期判断 | `return nowMs >= expiresAtMs;` 到期时刻本身即判为已过期 |
| `src/auth/session.ts` | 创建会话 | `expiresAt` 硬编码为 `"2099-01-01T00:00:00.000Z"` |
| `src/routes/login.ts` | 登录路由 | 调用 `verifyPassword` 与 `createSession`，返回 `sessionToken` |
| `src/services/auth-service.ts` | 用户校验 | 提供 `verifyPassword(email, password)` |

`src/auth/session-policy.ts` 当前完整逻辑（900 bytes，多次读取一致）：

```ts
export function isSessionExpired(session: ExpiringSession, now: Date): boolean {
  const expiresAtMs = Date.parse(session.expiresAt);
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;

  if (!Number.isFinite(expiresAtMs)) {
    return true; // 非法到期时刻 → 安全按已过期处理
  }
  if (!Number.isFinite(nowMs)) {
    return true; // 非法 now → 安全按已过期处理
  }
  return nowMs >= expiresAtMs; // 到期时刻本身即视为已过期
}
```

源码文件头注释记录的历史问题（"原先只比较 UTC 日期、忽略时刻、最多晚 24 小时失效"）
在当前版本中已不复存在，属**已修复状态**。

## 3. 独立审计（既有测试未覆盖边界输入）

对 `isSessionExpired` 逐项核对实现行为：

| 输入情形 | 实际返回 | 是否符合预期 |
|---|---|---|
| `expiresAt` 为 `null` / 非法字符串 | `true`（`Number.isFinite(NaN)` 为假） | ✅ 安全兜底，不产生永不失效会话 |
| `now` 非 Date 对象 | `true` | ✅ 安全兜底 |
| `now` 早于到期时刻 | `false` | ✅ 有效 |
| `now` 等于到期时刻 | `true` | ✅ 到期即失效，边界用 `>=` 正确 |
| `now` 晚于到期时刻 | `true` | ✅ 已过期 |

全仓搜索确认：
- `isSessionExpired` 仅出现于 `src/auth/session-policy.ts`（定义）与两个测试文件（调用）。
- 全仓 `expired` 命中 0 处，`Date.parse` 命中 1 处（即本文件），无第二处过期逻辑。
- 不存在未覆盖的隐藏边界路径。

**审计结论：不存在未覆盖缺陷，无需修改。**

## 4. 测试实际结果（真实退出码）

四个阶段（诊断、基线、验证、独立审计）多次执行结果一致：

| 范围 | 测试文件 | 用例数 | 通过 | 失败 | 退出码 |
|---|---|---|---|---|---|
| target | `tests/session-policy.test.ts` | 2 | 2 | 0 | 0 |
| boundary | `tests/session-boundary.test.ts` | 3 | 3 | 0 | 0 |
| regression | `tests/login-flow.test.ts` | 2 | 2 | 0 | 0 |

边界用例语义与实现一致：
- 到期前 `2026-09-11T00:29:59.999Z` → 有效（`false`）
- 到期时刻 `2026-09-11T00:30:00.000Z` → 已过期（`true`）
- 到期后 `2026-09-11T00:30:00.001Z` → 已过期（`true`）

对应验证证据：`ev-22`~`ev-24`（基线）、`ev-25`~`ev-27`（验证）、`ev-30`（审计）。

## 5. 改动

**无源码改动。** 这是基于证据的判定，而非遗漏：
修改当前正确且已通过验证的代码会降低正确性并违反"最小必要修改"约束。

计划中 `fix` 步骤因根因不成立被修订为 `baseline`（依据证据 `ev-17`~`ev-21`），
并在验收方要求下追加 `audit` 独立审计步骤（计划修订记录 v2、v3）——
两次修订均由证据驱动，均未产生无依据的源码修改。

## 6. 未验证项 / 待确认

以下属于"功能缺口"而非"边界 bug"，需要需求方确认后再决定是否修改：

1. **过期校验未接入生产路径**：`src/routes/login.ts` 创建会话后从未调用
   `isSessionExpired`，会话校验在登录流程中未接线。
2. **过期时刻被写死**：`createSession` 固定返回 `2099-01-01`，实际不存在"会话过期"行为。

若"边界问题"指的是上述任一项，请提供具体失败现象（测试名、期望 vs 实际），
我将据此重新诊断并做最小修改。

## 7. 复现命令说明

本次通过测试工具的三个范围运行：
- target：`tests/session-policy.test.ts`
- boundary：`tests/session-boundary.test.ts`
- regression：`tests/login-flow.test.ts`

四个阶段多次执行的退出码均为 0。
