# config 目录 — 中间件配置（输入，自动读取）

本目录存放中间件连接配置。skill 在**阶段0**自动读取，并在**阶段3**把连接信息注入到
生成的后端 Spring Boot `application.yml` / `application-dev.yml`。

## 文件说明

| 文件 | 用途 | 是否随技能仓库分发 |
|------|------|-------------------|
| `middleware.example.yaml` | 配置模板（占位符） | 是 |
| `middleware.local.yaml` | 本地实际配置（真实凭据） | **否**——用户在本地创建，已 gitignore |
| `.gitignore` | 忽略本地凭据文件 | 是 |

## 读取优先级

1. `middleware.local.yaml`（若存在）—— 本地实际值，优先使用
2. `middleware.example.yaml`（回退）—— 占位符，仅用于了解结构

> 若两者都不存在，skill 会停止并提示用户创建配置文件。

## 字段与生成代码的对应（Spring Boot 为例）

| 配置字段 | 生成到 | 生成形式 |
|---------|--------|---------|
| mysql.host/port/database | `spring.datasource.url` | `jdbc:mysql://${MYSQL_HOST:localhost}:${MYSQL_PORT:3306}/${MYSQL_DB:app_db}?...` |
| mysql.username | `spring.datasource.username` | `${MYSQL_USERNAME:root}` |
| mysql.password | `spring.datasource.password` | `${MYSQL_PASSWORD:<local>}` |
| redis.* | `spring.data.redis.*` | 同上，环境变量带默认值 |

## 安全须知

- 真实密码只放在用户本地创建的 `middleware.local.yaml`（已 gitignore）
- 生成的 `application.yml` 使用 `${VAR:default}` 语法：本地可直接运行，生产用环境变量覆盖默认值
