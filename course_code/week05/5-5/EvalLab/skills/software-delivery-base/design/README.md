# design 目录 — 设计文档（输入/输出）

将设计文档放在本目录。skill 启动后会读取本目录下所有文档（README 除外）作为设计输入，
并据此生成「设计审查检查单」（`$CHECK_DIR/02-design.md`）。

当本目录为空时，架构师在阶段 3 按 `references/architect-design-generation-flow.md` 的8步流程生成完整设计文档集。

## 文件结构

### 协调文件（架构师生成）

| 文件 | 说明 |
|------|------|
| `_design-context.md` | 上下文协调文件（事实表+决策+跨引用索引+进度看板） |
| `_module-split.md` | 功能模块拆分清单 |
| `_application-architecture.md` | 应用架构划分（仅微服务时） |
| `_technical-decisions.md` | 技术决策清单 |

### 设计文档（架构师生成）

| 文件 | 说明 | 必须/可选 |
|------|------|----------|
| `01-tech-stack.md` | 技术栈选型 | 必须 |
| `02-system-architecture.md` | 系统架构设计 | 必须 |
| `03-database-design.md` | 数据库设计 | 必须 |
| `04-api-design.md` | 接口设计 | 必须 |
| `05-frontend-design.md` | 前端设计 | 可选 |
| `06-mobile-design.md` | 移动端设计 | 可选 |
| `07-deployment-design.md` | 部署设计 | 可选 |
| `08-security-design.md` | 安全设计 | 可选 |

## 建议内容

设计文档应覆盖以下维度：

1. **系统架构**：架构类型、分层结构、技术选型
2. **后端模块划分**：模块职责、依赖关系、包结构
3. **接口设计**：每个接口的路径/方法、入参、出参、异常码
4. **数据库设计**：表结构、ER关系、初始化数据
5. **前端设计**：页面/路由结构、组件划分、状态管理
6. **业务流程**：时序图/流程图、关键分支与异常处理路径
7. **关键算法/规则**：核心计算逻辑、状态机、边界条件
8. **约束与边界**：性能指标、并发控制、幂等、限流策略

## 命名建议

- 协调文件以 `_` 前缀命名：`_design-context.md`、`_module-split.md`、`_application-architecture.md`、`_technical-decisions.md`
- 设计文档按编号排序：`01-tech-stack.md`、`02-system-architecture.md`、`03-database-design.md`、`04-api-design.md`
- 开发任务设计文档（架构师产出）放在 `plans/` 目录，命名为 `DES-<开发任务编号>-*.md`
