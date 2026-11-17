# 架构师系统级设计文档生成流程

> 本文档是 SKILL.md 的详细说明，执行时请以 SKILL.md 为准。

> **前置条件**：
> 1. 架构师必须在阶段 0 步骤 4（范围确认）完成架构类型确认
> 2. 架构师必须在阶段 2 检查 `$DESIGN_DIR` 状态，确认需要生成系统级设计文档
> 3. 本流程仅在 `$DESIGN_DIR` 无实际设计文档时执行

## 执行方式

- **主上下文执行**：步骤1-4（读取输入/事实表/模块划分/技术决策）、步骤6b（待确认回写）、步骤8（校验交付）
- **subagent 隔离执行**：步骤5（前序文档生成）、步骤6a（待确认扫描）、步骤7（核心文档生成）
- **协调文件**：`$DESIGN_DIR/_design-context.md` 承载事实表摘要、决策摘要、跨文档引用索引、进度看板
- **并行策略**：步骤5和步骤7采用分层并行，同层文档同时派发subagent，层间串行

### 并行依赖图

```
步骤5 第1波（并行）: _module-split + _application-architecture + _technical-decisions + 01-tech-stack
步骤5 第2波（串行）: 02-system-architecture
步骤7 第3波（并行）: 03-database-design + 05-frontend-design（若需要）
步骤7 第4波（串行）: 04-api-design
步骤7 第5波（可选并行）: 06-mobile-design + 07-deployment-design + 08-security-design
```

## 输出清单

```text
$DESIGN_DIR/
├── _design-context.md            # 上下文协调文件
├── _module-split.md              # 功能模块拆分清单
├── _application-architecture.md  # 应用架构划分（仅微服务）
├── _technical-decisions.md       # 技术决策清单
├── 01-tech-stack.md              # 技术栈
├── 02-system-architecture.md     # 系统架构
├── 03-database-design.md         # 数据库设计
├── 04-api-design.md              # API 设计
├── 05-frontend-design.md         # 前端设计（可选）
├── 06-mobile-design.md           # 移动端设计（可选）
├── 07-deployment-design.md       # 部署设计（可选）
└── 08-security-design.md         # 安全设计（可选）
```

## 标准流程

### 步骤 1：读取输入

读取需求文档建立全局视图：

1. 读取 `$REQUIREMENTS_DIR/` 下的所有需求文档
2. 读取 `specification/` 下的开发规范文档
3. 读取 `$CONFIG_DIR/middleware.example.yaml` 了解中间件配置结构
4. 若 `$PLANS_DIR/WP-*.md` 存在，读取工作包了解功能范围
5. 若以上均不存在，停止并提示用户先提供需求文档

### 步骤 2：建立事实表

从需求文档中抽取结构化事实，后续文档只能引用事实表或已确认决策，不得即兴造名。

**必须抽取**：

| 类别 | 内容 |
|------|------|
| 业务功能清单 | 功能名称、功能概述、新增/优化 |
| 实体清单 | 实体名、来源功能、关键字段 |
| 角色权限 | 角色、菜单权限、数据权限 |
| 业务流程 | 流程步骤、触发条件、异常分支 |
| 输入输出要素 | 字段名、类型、长度、必输性、校验规则 |
| 性能指标 | 响应时间、并发量、数据量级 |
| 外部系统对接 | 对接系统、接口方式、数据流向 |

落盘 `$DESIGN_DIR/_design-context.md` 第1节。

### 步骤 3：功能模块与应用架构划分

基于事实表业务功能清单，与用户交互确定模块划分：

1. **初步分析**：基于事实表，分析可能的功能模块
2. **询问架构形态**：
   - **前置检查**：若 `$CHECK_DIR/00-env/architecture-decision.md` 已存在（阶段0已确认），直接使用已有决策，跳过询问
   - **仅在文件不存在时**：用 `question` 工具 **`ui-standards §1.2` 架构类型选择模板** 询问用户单体/微服务
3. **展示映射建议**：展示「业务功能 → 模块」映射建议，与用户探讨
4. **落盘确认**：落盘后展示摘要获确认

**模块拆分原则**：

| 场景 | 粒度 | 判断依据 |
|------|------|----------|
| 功能独立、职责单一 | 1:1 映射 | 一个业务功能对应一个模块 |
| 多个功能围绕同一实体/业务领域 | 聚合（N:1） | 如查询/新增/修改聚合为XX管理模块 |
| 功能复杂、跨多个技术域 | 拆分（1:N） | 如涉及联机+批处理+文件处理 |

落盘 `_module-split.md` 后，更新 `$DESIGN_DIR/_design-context.md` 第2节。

### 步骤 4：确认技术决策

按以下类别逐一与用户确认关键决策。**优先从需求文档和用户已有约束中推断，只有影响后续设计且无法推断时才提问。**

**必问决策项**：

| 类别 | 决策项 |
|------|--------|
| 技术选型 | 后端框架、前端框架、数据库、ORM/持久层、API风格 |
| 架构决策 | 架构形态、系统边界、外部系统对接、同步/异步、事务边界 |
| 命名规范 | 包名/模块名、API路径命名、数据库表/字段命名 |
| 安全认证 | 认证方式、权限模型、敏感数据处理 |
| 部署运维 | 服务端口、配置方式、容器化方案 |

落盘 `_technical-decisions.md` 后，更新 `$DESIGN_DIR/_design-context.md` 第2节。

### 步骤 5：生成前序文档（分层并行）

按依赖关系分层，**同层文档并行派发 subagent**，层间串行：

```
第1波（并行）: _module-split + _application-architecture + _technical-decisions + 01-tech-stack
第2波（串行）: 02-system-architecture（依赖第1波全部）
```

> **加速原理**：第1波4个文档无相互依赖，同时派发4个subagent并行生成，耗时从4次串行之和降为1次最慢的subagent耗时。

**Subagent 通用派发模板**：

```text
任务: 生成 {文档名}（{文档编号}）

读取（按需，不全量加载）:
- $DESIGN_DIR/_design-context.md（事实表+决策+跨引用索引+进度看板）
- $DESIGN_DIR/_module-split.md（模块清单）
- $DESIGN_DIR/_technical-decisions.md（技术决策）
- $DESIGN_DIR/_application-architecture.md（微服务时）
- {该文档所需的需求文档}
- {若依赖前序文档：直接读取前序文档全文}

执行纪律:
1. 先读 _design-context.md 第4节进度看板，确认依赖的前序文档状态为"已完成"。
2. 读取第3节跨引用索引，确认前序文档中的表名/API路径，避免命名不一致。
3. 未确认事实写"待确认"，不编造。

写入 $DESIGN_DIR/{文档编号}.md。

完成后只返回:
- 文件路径
- 跨文档引用摘要（供更新 _design-context.md 第3节）
- 待确认项（不超过5条）

不要返回文档正文。
```

**并行派发规则**：

1. **第1波**：同时派发4个subagent（`_module-split`、`_application-architecture`、`_technical-decisions`、`01-tech-stack`），每个subagent只需读取 `_design-context.md` 作为输入
2. **等待第1波全部返回**后，统一检查文件落盘、更新 `_design-context.md` 进度看板
3. **第2波**：派发1个subagent生成 `02-system-architecture`，需读取第1波全部产物

**每次 subagent 返回后**：
1. 检查文件是否已落盘且非空
2. 更新 `$DESIGN_DIR/_design-context.md` 第3节和第4节
3. 记录待确认项
4. 若当前波次全部完成，进入下一波次

### 步骤 6：待确认事项确认

#### 6a. 扫描待确认项（派发 subagent）

扫描前序文档中的所有「待确认」标记，返回汇总表。

#### 6b. 逐项确认与回写（主上下文）

展示汇总表，逐项与用户确认：

| 类型 | 回写目标 | 回写动作 |
|------|---------|---------|
| 技术决策类 | `_technical-decisions.md` | 将"待确认"替换为确认值 |
| 业务事实类 | 原文档对应位置 | 将"待确认"替换为确认值 |
| 仍无法确认 | 原位置保留 | 保留"待确认"，追加原因和影响说明 |

### 步骤 7：生成核心与后续文档（分层并行）

按依赖关系分层，**同层文档并行派发 subagent**：

```
第3波（并行）: 03-database-design + 05-frontend-design（若需要）
第4波（串行）: 04-api-design（依赖03的表结构）
第5波（可选并行）: 06-mobile-design + 07-deployment-design + 08-security-design
```

> **加速原理**：03-database-design和05-frontend-design无相互依赖，可并行生成。04-api-design依赖03的表结构，需等03完成。

**03-database-design 专用策略**（需覆盖全部实体）：
- 阶段一（表清单）：读取事实表实体清单，生成表清单
- 阶段二（分批字段设计）：按模块分批生成字段设计和 CREATE TABLE
- 阶段三（补充章节）：生成索引、枚举参数、初始化迁移、数据安全等章节

**04-api-design 专用策略**：
- 必须在 03-database-design 完成后执行
- 读取 03 的表结构，确保API字段与数据库字段一致
- 按服务分组生成API定义

可选文档（05-08）根据项目实际情况决定是否生成。

**并行派发规则**：

1. **第3波**：同时派发 `03-database-design` 和 `05-frontend-design`（若需要）
2. **等待03返回后**：派发 `04-api-design`
3. **第5波**（可选）：同时派发 `06-mobile-design`、`07-deployment-design`、`08-security-design`

### 步骤 8：校验并交付

**校验项**：

| 检查项 | 说明 |
|--------|------|
| 文件完整性 | 必须文档（01-04）+ `_` 前缀文件全部存在且非空 |
| 模块一致性 | `_module-split.md` 的模块标识与 `02-system-architecture.md` 一致 |
| 决策引用 | `_technical-decisions.md` 的关键决策在架构/部署/安全文档中被引用 |
| 跨引用一致 | 03的表名 → 04的API → 05的页面路由，引用链完整 |
| 待确认清零 | 所有"待确认"项已在步骤6确认并回写 |

校验不通过时先补齐再交付。交付后更新 `$CHECK_DIR/02-design.md` 供阶段4审查使用。

## 纪律要求

### 跨文档一致性

- 同一系统名、模块名、角色名、表名、字段名、API路径必须完全一致
- 模块名统一来源为 `_module-split.md`
- 数据库字段必须能追溯到需求文档中的输入/输出要素
- API 请求/响应字段必须能对应数据库字段或明确标注为派生字段

### 待确认项管理

- 未确认事实写"待确认"，不编造
- 步骤6确认的技术决策必须同步回写 `_technical-decisions.md`
- 数据库实体和 API 字段依赖已确认的决策，不可跳过步骤6直接生成 03/04

### 上下文管理

- 文档生成通过 subagent 隔离执行，主上下文不持有文档正文
- subagent 只返回摘要（跨引用索引+待确认项），不返回正文
- 阶段间通过 `_design-context.md` 传递状态
- **并行派发**：同层文档同时派发多个subagent，等待全部返回后统一更新协调文件再进入下一波次
- 并行时每个subagent独立读取 `_design-context.md`，互不干扰
