---
name: software-delivery-ops
description: 软件交付流水线 - 运维角色。负责CI/CD配置、容器化配置、监控配置（阶段3）、交付汇总（阶段7）。配置文件无需设计符合性/代码质量审查。触发条件：用户选择运维角色、说"运维"、"CI/CD"、"Docker"、"容器化"、"监控"、"/software-delivery-ops"。
---

# 软件交付流水线 - 运维角色

> 运维负责CI/CD、容器化、监控配置，执行阶段0→阶段3→阶段7。
> **注意**：运维产物为配置文件（Dockerfile、docker-compose.yml、CI/CD配置等），非业务代码，因此不需要进行设计符合性审查和代码质量审查。

---

## 阶段0特殊处理（运维直接触发）

当通过 `/software-delivery-ops` 直接触发时，**跳过步骤1角色确认**，因为角色已确定为运维。

执行流程调整为：
1. **步骤0：路径确认** - 使用 `ui-standards §1.1` 模板
2. **步骤1：角色确认** - ⏭️ **跳过**（角色已确定为运维）
3. **步骤2：前置条件检查** - 检查架构类型、设计文档、代码框架
4. **步骤3：展示流水线状态** - 使用 §2.1 模板展示当前流水线状态

角色确认后直接展示：
```
**👤 角色确认**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：运维
执行阶段：阶段0 → 阶段3 → 阶段7
核心职责：CI/CD、容器化、监控配置
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 前置依赖

本技能依赖 `software-delivery-base` 技能提供的：
- 阶段0环境准备流程
- UI标准模板（`references/ui-standards.md`）
- 质量门禁规则
- 模板文件（`templates/delivery-summary.md`、`templates/code-quality-review.md`）

执行前请确保阶段0已完成。

---

## 前置条件检查（必须执行）

1. **架构类型已确认**：`$CHECK_DIR/00-env/architecture-decision.md` 存在
2. **设计文档已生成**：`$DESIGN_DIR` 下有设计文档（特别是 `07-deployment-design.md`）
3. **代码框架已搭建**：项目目录结构已就绪

不满足时用 `question` 工具提醒用户先执行架构师角色。

---

## 阶段3：编码实现

### 开发流程

1. 读取 `$DESIGN_DIR/07-deployment-design.md` 了解部署设计
2. **严格按照设计方案**实现运维配置
3. 遵循最佳实践
4. **不得偏离设计方案**

### 编码内容

1. **CI/CD配置**：
   - GitHub Actions / GitLab CI 流水线配置
   - 构建、测试、部署阶段定义
   - 环境变量和密钥管理

2. **容器化配置**：
   - Dockerfile（多阶段构建、非root用户、镜像瘦身）
   - docker-compose.yml（服务编排、网络、卷挂载）
   - 环境配置分离（dev/staging/prod）

3. **部署脚本**：
   - 环境部署脚本
   - 发布脚本
   - 回滚脚本

4. **监控配置**：
   - Prometheus 配置
   - Grafana Dashboard
   - 告警规则

5. **生成完成后直接进入阶段7**（运维配置无需设计符合性/代码质量审查）

### 并行策略

| 步骤 | 执行方式 | 说明 |
|------|----------|------|
| 读取部署设计 | subagent | 文件读取 |
| 生成CI/CD配置 | subagent | 可并行生成 |
| 生成Docker配置 | subagent | 可并行生成 |
| 生成监控配置 | subagent | 可并行生成 |

---

## 阶段7：交付汇总

### 执行流程

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 使用 `templates/delivery-summary.md` 生成 `$CHECK_DIR/07-delivery.md`
3. **运维职责**：确认CI/CD配置、容器化配置、监控配置已就绪
4. 使用 `question` 工具 `ui-standards §1.8` 交付确认模板
5. 展示 `ui-standards §5.2` 阶段完成提示

### 交付清单

| 产物类型 | 路径 | 说明 |
|---------|------|------|
| 后端单元测试 | `$DELIVER_DIR/backend/src/test/java/` | JUnit5 + Mockito（由后端开发生成） |
| 前端单元测试 | `$DELIVER_DIR/frontend/tests/` | Vitest + @vue/test-utils（由前端开发生成） |
| 移动端单元测试 | `$DELIVER_DIR/mobile/tests/` | 按技术栈测试框架（由移动端开发生成） |
| CI/CD 配置 | `$DELIVER_DIR/ops/.github/workflows/` | GitHub Actions / GitLab CI |
| 容器化配置 | `$DELIVER_DIR/ops/{Dockerfile,docker-compose.yml}` | 容器构建与编排 |
| 部署脚本 | `$DELIVER_DIR/ops/deploy/` | 环境部署与发布脚本 |
| 监控告警 | `$DELIVER_DIR/ops/monitoring/` | Prometheus / Grafana |

### 交付确认

使用 `question` 工具 `ui-standards §1.8` 交付确认模板：

| 选项 | 说明 |
|------|------|
| 确认交付 | 所有门禁通过，交付完成 |
| 查看遗留项 | 查看未通过的门禁和遗留问题 |
| 取消 | 暂不交付 |

---

## 最佳实践

### Dockerfile

```dockerfile
# 多阶段构建
FROM maven:3.8-openjdk-17 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

FROM openjdk:17-jre-slim
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
RUN useradd -r appuser
USER appuser
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### docker-compose.yml

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=prod
    depends_on:
      - mysql
      - redis
  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_PASSWORD}
    volumes:
      - mysql-data:/var/lib/mysql
  redis:
    image: redis:7-alpine
volumes:
  mysql-data:
```

---

## UI模板引用

| 执行步骤 | UI模板引用 | 类型 |
|---------|-----------|------|
| 阶段0 路径确认 | `ui-standards §1.1` | question |
| 阶段0 角色选择 | `ui-standards §1.7` | question |
| 交付确认 | `ui-standards §1.8` | question |
| 断点续做 | `ui-standards §1.10` | question |
| 每阶段开始 | `ui-standards §5.1` | 状态展示 |
| 每阶段完成 | `ui-standards §5.2` | 状态展示 |
| 流水线状态 | `ui-standards §2.1` | 状态展示 |
| 前置条件不满足 | `ui-standards §4.1` | 错误格式 |
| 设计文档缺失 | `ui-standards §4.3` | 错误格式 |
| 中间件配置缺失 | `ui-standards §4.4` | 错误格式 |

---

## 触发条件

- 用户选择运维角色
- "运维" / "CI/CD" / "Docker" / "容器化" / "监控" / "部署"
- `/software-delivery-ops`
- `/software-delivery-ops --task=1`


