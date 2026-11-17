# 交付汇总报告 (Delivery Summary)

> 由阶段 7 在硬门禁通过、软门禁通过或用户确认放行后生成。

- 交付时间：__________
- 交付目录：`$DELIVER_DIR/`

## 交付清单

### 后端

| 产物类型 | 路径 | 说明 |
|---------|------|------|
| 业务功能代码 | `$DELIVER_DIR/backend/src/main/java/` | 按设计分层实现 |
| 后端单元测试 | `$DELIVER_DIR/backend/src/test/java/` | JUnit5 + Mockito |
| 数据库SQL | `$DELIVER_DIR/sql/schema.sql` | 建表脚本 |
| 构建文件 | `$DELIVER_DIR/backend/pom.xml` | Maven + Jacoco |
| 覆盖率报告 | `$DELIVER_DIR/backend/target/site/jacoco/` | mvn verify 生成 |

### 前端

| 产物类型 | 路径 | 说明 |
|---------|------|------|
| 前端工程 | `$DELIVER_DIR/frontend/src/` | Vue3 + TS + Vite + Element Plus |
| 前端单元测试 | `$DELIVER_DIR/frontend/tests/` | Vitest + @vue/test-utils |
| 构建配置 | `$DELIVER_DIR/frontend/{package.json,vite.config.ts,tsconfig.json}` | 依赖/构建/类型/规范 |
| 覆盖率报告 | `$DELIVER_DIR/frontend/tests/coverage/` | npm run coverage 生成 |

### 移动端

> 技术栈：__________（无移动端时整节标注 N/A）

| 产物类型 | 路径 | 说明 |
|---------|------|------|
| 移动端工程 | `$DELIVER_DIR/mobile/src/` | 由技术栈决定 |
| 移动端单元测试 | `$DELIVER_DIR/mobile/tests/` | 按技术栈测试框架 |

### 运维

| 产物类型 | 路径 | 说明 |
|---------|------|------|
| CI/CD 配置 | `$DELIVER_DIR/ops/.github/workflows/` | GitHub Actions / GitLab CI |
| 容器化配置 | `$DELIVER_DIR/ops/{Dockerfile,docker-compose.yml}` | 容器构建与编排 |
| 部署脚本 | `$DELIVER_DIR/ops/deploy/` | 环境部署与发布脚本 |
| 监控告警 | `$DELIVER_DIR/ops/monitoring/` | Prometheus / Grafana |

## 质量门禁最终结论

| 门禁 | 阈值 | 后端结果 | 前端结果 | 移动端结果 | 运维结果 | 状态 |
|------|------|---------|---------|-----------|---------|------|
| 设计符合性 | 100% 符合 | ___ | ___ | ___ | N/A | ☐ 通过 |
| 代码规范 | 无 Blocker/Critical | ___ | ___ | ___ | N/A | ☐ 通过 |
| 行覆盖率 | ≥ 80% | ___% | ___% | ___% | N/A | ☐ 通过 ☐ 用户确认放行 |
| 分支覆盖率 | ≥ 70% | ___% | ___% | ___% | N/A | ☐ 通过 ☐ 用户确认放行 |

## 已知遗留项

| 类型 | 描述 | 原因/说明 |
|------|------|----------|
| ___ | ___ | ___ |

## 构建与运行说明

```bash
# 后端
cd $DELIVER_DIR/backend
mvn clean verify          # 编译 + 单测 + Jacoco 报告 + 阈值校验
# 覆盖率报告：target/site/jacoco/index.html

# 前端
cd $DELIVER_DIR/frontend
npm install               # 安装依赖
npm run dev               # 本地开发
npm run build             # 生产构建
npm run coverage          # 单测 + 覆盖率报告（tests/coverage/）
npm run lint              # ESLint 规范检查
```

## 交付状态

☐ 硬门禁全部通过、软门禁通过或经用户确认放行，交付完成。

> 硬门禁未通过时不得勾选此项；软门禁未达标须经用户通过 `question` 工具显式确认放行后方可标记遗留。
