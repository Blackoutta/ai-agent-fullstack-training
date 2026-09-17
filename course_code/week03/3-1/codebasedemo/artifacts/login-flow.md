# login_demo 登录逻辑说明

本文档基于对仓库源码的实际阅读整理，所有结论均可在下方“引用源码”中逐条核对。

## 1. 服务启动与路由挂载

- `src/server.ts` 中 `createApp()` 创建 Express 应用，并 `app.listen(3001)` 启动服务。
- `src/app.ts` 中：
  - `app.use(express.json())`：解析 JSON 请求体，是 `request.body` 可用的前提。
  - `app.use("/api", loginRouter)`：把登录路由挂在 `/api` 前缀下。
  - `app.use("/api", profileRouter)`：把受保护的用户信息路由挂在 `/api` 前缀下。
  - `app.get("/health", ...)`：健康检查接口，与登录无关。
- 因此登录接口的完整路径为 **`POST /api/login`**。

## 2. 分层职责

### 2.1 路由层：`src/routes/login.ts`

- `loginRouter.post("/login", async (request, response) => {...})` 是登录入口。
- 从 `request.body` 解构 `email` 与 `password`（可选字符串类型）。
- 若 `email` 或 `password` 为空，返回 `400 { error: "email and password are required" }`。
- 参数完整时调用 `authService.login(email, password)`。
- 成功返回 `200`，响应体即 `LoginResult`。
- 捕获异常后返回 `401`，错误信息取 `error.message`，非 Error 时回退为 `"Login failed"`。

### 2.2 服务层：`src/services/auth-service.ts`

`AuthService.login(email, password)`：

1. `userRepository.findByEmail(email)` 查询用户。
2. 用户不存在 → 抛出 `Error("User not found")`。
3. `verifyPassword(password, user.passwordHash)` 校验密码。
4. 密码不匹配 → 抛出 `Error("Invalid password")`。
5. `issueAccessToken({ userId: user.id, role: user.role })` 签发令牌。
6. 返回 `{ accessToken, user: { id, email, displayName, role } }`。

注意：`user` 只挑选了 `id/email/displayName/role`，**不包含 `passwordHash`**，因此响应不会泄露密码字段。

通过 `export const authService = new AuthService()` 以单例形式导出。

### 2.3 仓储层：`src/repositories/user-repository.ts`

- `UserRepository.findByEmail(email)` 只做一件事：`queryOne("users", { email })`。
- 通过 `export const userRepository = new UserRepository()` 导出单例。

### 2.4 数据库层：`src/db/database.ts`

- 并非真实数据库，而是内存数组 `usersTable`，内含两条记录：
  - `u_1001 / demo@example.com / hash:demo123 / Demo User / member`
  - `u_1002 / admin@example.com / hash:admin123 / Admin User / admin`
- `queryOne(table, where)` 在 `getTable(table)` 返回的行中查找**第一个**满足 `where` 全部键值相等的记录，找不到返回 `undefined`。
- `getTable` 中 `TableName` 目前仅包含 `"users"`。

### 2.5 密码工具：`src/utils/password.ts`

- `verifyPassword(plainTextPassword, passwordHash)` 的实现是 `passwordHash === \`hash:${plainTextPassword}\``。
- 即等于把明文加 `hash:` 前缀后做字符串相等比较，属于 **demo 级校验，并非真实哈希**（注释亦明确说明 "Demo-only password check"）。

### 2.6 令牌工具：`src/utils/token.ts`

- `issueAccessToken(payload)`：把 `{ userId, role }` 序列化为 JSON，再做 `base64url` 编码，拼接为 `demo-token.<encoded>`。
- `parseAccessToken(token)`：
  - 若不以 `demo-token.` 开头，返回 `null`。
  - 否则去掉前缀，`base64url` 解码并 `JSON.parse` 为 `AuthTokenPayload`；解析异常时返回 `null`。
- 该令牌**未加密、未签名**，载荷可被任意构造，仅用于演示。

### 2.7 类型定义：`src/types/user.ts`

- `UserRecord`：`id / email / passwordHash / displayName / role`，`role` 为 `"admin" | "member"`。
- `LoginResult`：`accessToken` 与 `Pick<UserRecord, "id" | "email" | "displayName" | "role">`。
- `AuthTokenPayload`：`userId` 与 `role`。

## 3. 调用链

### 3.1 登录成功

1. 客户端请求 `POST /api/login`，体为 `{ email, password }`。
2. `src/app.ts` 的 `express.json()` 解析请求体，并将请求分发到 `loginRouter`。
3. `src/routes/login.ts` 读取 `email/password`，校验非空。
4. 调用 `authService.login(email, password)`。
5. `auth-service.ts` 调用 `userRepository.findByEmail(email)`。
6. `user-repository.ts` 调用 `queryOne("users", { email })`。
7. `database.ts` 在 `usersTable` 中按 `email` 匹配到用户记录。
8. 回到 `auth-service.ts`，调用 `verifyPassword(password, user.passwordHash)`。
9. `password.ts` 比较 `hash:${password}` 与存储值，返回 `true`。
10. `auth-service.ts` 调用 `issueAccessToken({ userId, role })`。
11. `token.ts` 生成 `demo-token.<base64url(payload)>`。
12. Service 返回 `{ accessToken, user }`。
13. 路由返回 `200` 与 JSON 结果。

简化路径：

`POST /api/login -> express.json -> loginRouter -> authService.login -> userRepository.findByEmail -> queryOne(users) -> verifyPassword -> issueAccessToken -> 200`

### 3.2 登录失败

| 场景 | 触发位置 | 结果 |
| --- | --- | --- |
| 缺少 `email` 或 `password` | `src/routes/login.ts` 参数校验 | `400 { error: "email and password are required" }` |
| 邮箱查无用户 | `auth-service.ts` 抛 `User not found`，路由捕获 | `401 { error: "User not found" }` |
| 密码不匹配 | `auth-service.ts` 抛 `Invalid password`，路由捕获 | `401 { error: "Invalid password" }` |

失败响应统一由路由层 `catch` 输出，因此错误信息来源于 Service 抛出的 `Error.message`。

## 4. 登录后的鉴权链（登录逻辑的延伸）

登录返回的 `accessToken` 供受保护接口使用，例如 `GET /api/profile`：

1. 客户端在请求头带上 `Authorization: Bearer <accessToken>`。
2. `src/routes/profile.ts` 的 `GET /profile` 先经过 `authMiddleware`。
3. `src/middleware/auth-middleware.ts`：
   - 读取 `request.headers.authorization`。
   - 不以 `"Bearer "` 开头 → `401 { error: "Missing bearer token" }`。
   - 去掉前缀后调用 `parseAccessToken(token)`。
   - 解析结果为 `null` → `401 { error: "Invalid token" }`。
   - 成功则写入 `response.locals.currentUser = payload` 并 `next()`。
4. `profile` 处理函数返回 `{ message: "Authenticated request", currentUser }`。

简化路径：

`GET /api/profile -> authMiddleware -> parseAccessToken -> response.locals.currentUser -> 200`

## 5. 关键观察与风险点

- **密码校验是明文体比较**：`hash:` 前缀 + 明文，任何能读到表数据的人都能直接还原密码，生产环境必须替换为 bcrypt/argon2 等慢哈希。
- **令牌无签名**：`issueAccessToken` 只是 base64url 编码，`parseAccessToken` 也只解码校验前缀，中间件无法识别伪造令牌。
- **用户不存在与密码错误信息可区分**：分别返回 `User not found` 与 `Invalid password`，存在用户枚举风险，建议统一为模糊提示。
- **无速率限制与锁定机制**：登录接口未做防暴力破解处理。
- **内存数据**：`usersTable` 为进程内常量，重启即重置，且 `queryOne` 为线性查找。
- **响应为 token 与用户绑定**：登录后即签发，无刷新/过期机制。

## 6. 结论

- 运行入口：`src/server.ts`
- 路由挂载点：`src/app.ts`
- 登录接口入口：`src/routes/login.ts` 中的 `POST /login`
- 完整请求路径：`POST /api/login`
- 核心业务逻辑：`src/services/auth-service.ts` 的 `AuthService.login`

分层清晰：`server/app` 负责启动与挂载，`route` 负责 HTTP 出入参，`service` 负责登录业务判断，`repository` 负责按条件查用户，`db` 负责模拟 users 表访问，`utils` 负责密码校验与 token 编解码，`middleware` 负责登录后的身份校验。

## 7. 引用源码

- `src/server.ts`
- `src/app.ts`
- `src/routes/login.ts`
- `src/routes/profile.ts`
- `src/services/auth-service.ts`
- `src/repositories/user-repository.ts`
- `src/db/database.ts`
- `src/utils/password.ts`
- `src/utils/token.ts`
- `src/middleware/auth-middleware.ts`
- `src/types/user.ts`
