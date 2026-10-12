# login_demo 登录调用链说明

## 1. 登录入口

- 服务启动入口：`src/server.ts`
  - `createApp()` 创建 Express 应用。
  - `app.listen(3001)` 启动 HTTP 服务。
- 路由挂载入口：`src/app.ts`
  - `app.use("/api", loginRouter)` 挂载登录路由。
  - 因此登录接口的完整路径是 `POST /api/login`。
- 实际登录处理函数：`src/routes/login.ts`
  - `loginRouter.post("/login", ...)` 是代码中的登录入口。

## 2. 关键模块职责

### 2.1 路由层

`src/routes/login.ts`

- 从 `request.body` 中读取 `email` 和 `password`。
- 若任一字段缺失，直接返回 `400`。
- 参数完整时，调用 `authService.login(email, password)`。
- 如果 Service 抛错，则统一返回 `401`，并透出错误信息。

### 2.2 Service 层

`src/services/auth-service.ts`

- 调用 `userRepository.findByEmail(email)` 查询用户。
- 用户不存在时抛出 `User not found`。
- 调用 `verifyPassword(password, user.passwordHash)` 校验密码。
- 密码错误时抛出 `Invalid password`。
- 校验通过后，调用 `issueAccessToken(...)` 生成访问令牌。
- 最后返回 `{ accessToken, user }` 给路由层。

### 2.3 Repository 层

`src/repositories/user-repository.ts`

- `findByEmail(email)` 只负责“按邮箱查用户”。
- 具体查询动作委托给数据库访问函数 `queryOne("users", { email })`。

### 2.4 数据库访问层

`src/db/database.ts`

- 这里不是外部数据库，而是内存中的 `usersTable` 数组。
- `queryOne(table, where)` 会遍历表数据，找到第一个满足条件的用户记录。
- 目前内置了两条用户数据：
  - `demo@example.com / demo123`
  - `admin@example.com / admin123`
- 密码在表里以 `hash:明文密码` 的形式保存，例如 `hash:demo123`。

### 2.5 密码工具

`src/utils/password.ts`

- `verifyPassword` 的逻辑非常直接：
  - 判断数据库中的 `passwordHash` 是否等于 ``hash:${plainTextPassword}``
- 这说明它是教学用的 demo 校验方式，不是真实加密哈希。

### 2.6 Token 工具

`src/utils/token.ts`

- `issueAccessToken(payload)` 会把 `{ userId, role }` 转成 JSON。
- 再做 `base64url` 编码，拼成 `demo-token.<encoded>` 形式的字符串。
- `parseAccessToken(token)` 做相反操作：
  - 先校验前缀是否为 `demo-token.`
  - 再解码并解析出用户身份载荷

### 2.7 认证中间件

`src/middleware/auth-middleware.ts`

- 该中间件不参与“登录”本身，而是用于“登录后访问受保护接口”。
- 它从 `Authorization` 请求头中读取 `Bearer <token>`。
- 若请求头缺失或格式不对，返回 `401 Missing bearer token`。
- 若 token 解析失败，返回 `401 Invalid token`。
- 解析成功后，把 payload 写入 `response.locals.currentUser`，再调用 `next()`。

### 2.8 受保护路由

`src/routes/profile.ts`

- `GET /api/profile` 使用了 `authMiddleware`。
- 只要 token 合法，就会返回：
  - `message: "Authenticated request"`
  - `currentUser: response.locals.currentUser`

## 3. 主要调用链梳理

### 3.1 登录成功链路

1. 客户端请求 `POST /api/login`
2. `src/server.ts` 启动的服务收到请求
3. `src/app.ts` 将 `/api/login` 分发给 `loginRouter`
4. `src/routes/login.ts` 读取 `email/password`
5. 路由调用 `authService.login(email, password)`
6. `src/services/auth-service.ts` 调用 `userRepository.findByEmail(email)`
7. `src/repositories/user-repository.ts` 调用 `queryOne("users", { email })`
8. `src/db/database.ts` 从 `usersTable` 中找到匹配用户
9. `src/services/auth-service.ts` 调用 `verifyPassword(password, user.passwordHash)`
10. `src/utils/password.ts` 校验密码是否匹配
11. 校验通过后，`src/services/auth-service.ts` 调用 `issueAccessToken({ userId, role })`
12. `src/utils/token.ts` 生成 `demo-token.<encoded>`
13. Service 返回 `{ accessToken, user }`
14. `src/routes/login.ts` 返回 `200` JSON 响应

可简化为：

`POST /api/login -> login route -> authService.login -> userRepository.findByEmail -> queryOne(users) -> verifyPassword -> issueAccessToken -> 200 response`

### 3.2 登录失败链路

#### 情况 A：缺少参数

`src/routes/login.ts` 在路由层直接返回：

- `400 { error: "email and password are required" }`

#### 情况 B：用户不存在

调用链进入 Service 后：

- `userRepository.findByEmail(email)` 查不到用户
- `authService.login` 抛出 `User not found`
- 路由层捕获后返回 `401`

#### 情况 C：密码错误

调用链进入密码校验后：

- `verifyPassword(...)` 返回 `false`
- `authService.login` 抛出 `Invalid password`
- 路由层捕获后返回 `401`

## 4. 登录后的鉴权调用链

登录接口返回的 `accessToken` 会被后续受保护接口使用，例如 `GET /api/profile`。

调用链如下：

1. 客户端把登录得到的 token 放入请求头：
   - `Authorization: Bearer <accessToken>`
2. 请求进入 `src/routes/profile.ts`
3. 先执行 `authMiddleware`
4. `authMiddleware` 调用 `parseAccessToken(token)`
5. `src/utils/token.ts` 解码出 `{ userId, role }`
6. 中间件把该信息写入 `response.locals.currentUser`
7. `profileRouter` 处理函数返回当前用户信息

可简化为：

`GET /api/profile -> authMiddleware -> parseAccessToken -> response.locals.currentUser -> profile response`

## 5. 结论

这个 demo 的分层很清楚：

- `server/app` 负责启动与挂载
- `route` 负责 HTTP 入参和响应
- `service` 负责登录业务判断
- `repository` 负责按条件查用户
- `db` 负责模拟 users 表访问
- `utils` 负责密码校验和 token 编解码
- `middleware` 负责登录后的身份校验

如果只看“登录入口”，答案是：

- 运行入口：`src/server.ts`
- 路由挂载点：`src/app.ts`
- 登录接口入口：`src/routes/login.ts` 中的 `POST /login`
- 完整请求路径：`POST /api/login`
