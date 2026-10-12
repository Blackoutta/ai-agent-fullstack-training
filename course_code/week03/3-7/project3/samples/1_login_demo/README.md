# Login Demo

## 关键文件

- `src/routes/login.ts`: 登录入口，`POST /api/login`
- `src/services/auth-service.ts`: 登录业务逻辑
- `src/repositories/user-repository.ts`: 用户查询
- `src/db/database.ts`: 模拟数据库访问，明确访问 `users` 表
- `src/middleware/auth-middleware.ts`: 认证中间件
- `src/utils/password.ts`: 密码校验
- `src/utils/token.ts`: token 签发与校验
