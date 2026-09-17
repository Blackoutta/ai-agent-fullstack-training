# 登录流程说明

## 总览

该项目采用典型的「凭据校验 → 签发会话」登录模型。登录入口接收邮箱与密码，经认证服务校验后为通过的用户签发一个会话令牌（session token）。代码组织为三个独立文件，形成清晰的调用链：

```
src/routes/login.ts          (入口路由)
        │
        ▼
src/services/auth-service.ts (认证服务：校验凭据)
        │
        ▼ (校验通过后返回 user)
        │
src/auth/session.ts          (会话模块：签发 token)
```

## 调用链详细解析

### 1. 入口路由 — `src/routes/login.ts`

`loginRoute(payload)` 接收 `LoginPayload`（结构要求见下文）作为参数：

```typescript
export interface LoginPayload {
  email: string;    // 用户邮箱
  password: string; // 明文密码
}
```

处理流程：
1. 调用 `verifyPassword(payload.email, payload.password)` 校验用户身份；该校验为 **异步**（`await`）。
   - 若校验抛错（用户不存在 / 密码错误），异常会从这里向外传播，路由不会继续执行。
2. 校验成功后，拿到返回的 `user` 对象（含 `id`）。
3. 调用 `createSession(user.id)` 为该用户创建会话对象。
4. 组装 HTTP 响应：

```typescript
return {
  status: 200,
  body: {
    message: "login ok",
    sessionToken: session.token,  // 会话令牌
    userId: user.id,
  },
};
```

### 2. 认证服务 — `src/services/auth-service.ts`

该模块持有一份 **内存中的用户表** `USERS`（当前仅一名测试用户）：

```typescript
const USERS = [
  {
    id: "user-1001",
    email: "alice@example.com",
    passwordHash: "hash:secret-123",
  },
];
```

> 注意：用户数据以硬编码方式存放在内存数组中，并非数据库存储。

`verifyPassword(email, password)`（异步函数）实现校验逻辑：

1. 用 `email` 在 `USERS` 中查找匹配用户（`find`）。
2. **若未找到用户** → `throw new Error("USER_NOT_FOUND")`。
3. 将传入的明文密码按相同规则拼接构造「候选哈希」：

   ```typescript
   const candidateHash = `hash:${password}`;
   ```

4. 比较 `candidateHash` 与存储的 `user.passwordHash`。
   - **不相等** → `throw new Error("INVALID_PASSWORD")`。
   - **相等** → 返回脱敏后的用户信息（仅 `id` 与 `email`，不含密码哈希）：

   ```typescript
   return { id: user.id, email: user.email };
   ```

### 3. 会话模块 — `src/auth/session.ts`

`createSession(userId)` 为给定用户签发一个会话对象：

```typescript
export function createSession(userId: string) {
  return {
    token: `session-${userId}`,       // token 前缀固定为 "session-"
    userId,
    expiresAt: "2099-01-01T00:00:00.000Z",  // 远期过期时间（硬编码）
  };
}
```

说明要点：
- 会话令牌由字符串前缀 `"session-"` + 用户 id 拼接而成（**非随机**，可预测）。
- 过期时间被硬编码为 `2099-01-01`，实际请求中不会因时间而自然过期。
- `token` 被返回给入口路由并写入响应体的 `sessionToken` 字段，供后续请求携带使用。

## 关键细节与潜在风险

| 关注点 | 现状 | 备注 |
| ------ | ---- | ---- |
| 密码存储 | 明文拼 `hash:` 前缀模拟哈希 | 非真实加密，仅为演示 |
| 会话令牌 | `${session-}${userId}` 可预测拼接 | 无随机性、无签名 |
| 令牌过期 | 硬编码 2099 年的远期时间 | 不会自然失效 |
| 用户来源 | 内存常量数组，仅 1 条 | 非数据库，重启即重置 |
| 异常处理 | 错误向上抛出，路由层未见兜底 try/catch | 依赖外层容器捕获 |
| 密码比对 | `hash:${password}` 拼接后全等比较 | 恒定时长方面未作处理 |

## 完整登录时序

1. 外部请求携带 `{ email, password }` 到达 `loginRoute`。
2. `verifyPassword` 被调用。
   - 邮箱不存在 → 抛 `USER_NOT_FOUND`，流程终止。
   - 邮箱存在但密码不匹配 → 抛 `INVALID_PASSWORD`，流程终止。
3. 校验通过 → 调用 `createSession(user.id)` 生成会话对象。
4. 返回响应：
   - `status: 200`
   - `body: { message: "login ok", sessionToken, userId }`

## 参考源码路径

- `src/routes/login.ts` — 登录入口路由与请求/响应结构
- `src/services/auth-service.ts` — 用户表定义与凭据校验
- `src/auth/session.ts` — 会话令牌创建
