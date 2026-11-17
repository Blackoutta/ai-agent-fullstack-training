---
name: software-delivery-architect
description: 软件交付流水线 - 架构师角色。主导系统级设计文档生成（阶段3）、代码框架搭建（阶段3）、最终全量审查（阶段4/5）。触发条件：用户选择架构师角色、说"架构设计"、"代码框架"、"设计文档"、"/software-delivery-architect"。
---

# 软件交付流水线 - 架构师角色

> 架构师主导设计和审查，执行阶段0→阶段2→阶段3（设计+脚手架）→阶段4/5（最终审查）。阶段6由测试角色负责。

---

## 阶段0特殊处理（架构师直接触发）

当通过 `/software-delivery-architect` 直接触发时，**跳过步骤1角色确认**，因为角色已确定为架构师。

执行流程调整为：
1. **步骤0：路径确认** - 使用 `ui-standards §1.1` 模板
2. **步骤1：角色确认** - ⏭️ **跳过**（角色已确定为架构师）
3. **步骤2：环境初始化** - 检测旧产物，必要时清理
4. **步骤3：输入收集** - 读取需求文档、中间件配置
5. **步骤4：范围确认** - 确认架构类型（单体/微服务）
6. **步骤5：任务登记** - 输出流程检查清单

角色确认后直接展示：
```
**🏗️ 架构师角色确认**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：架构师
执行阶段：阶段0 → 阶段2 → 阶段3 → 阶段4 → 阶段5 → 阶段6

核心职责：
  1. 阶段0步骤4：确认架构类型
  2. 阶段2：检查设计文档状态
  3. 阶段3：生成设计文档 + 搭建代码框架
  4. 阶段4/5/6：主导审查

⚠️ 重要：其他研发角色必须等待架构师完成阶段3后才能开始编码
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 前置依赖

本技能依赖 `software-delivery-base` 技能提供的：
- 阶段0环境准备流程
- UI标准模板（`references/ui-standards.md`）
- 质量门禁规则
- 模板文件

执行前请确保阶段0已完成。

---

## 1. 架构类型确认（阶段0步骤4：范围确认）

### 确认流程

1. 用 `question` 工具询问用户选择架构类型：
   - `monolith`：单体应用架构
   - `microservice`：微服务架构
2. 将选择记录到 `$CHECK_DIR/00-env/architecture-decision.md`
3. 后续设计文档和代码框架基于此选择生成

### 调整权限

架构师可根据项目实际情况建议调整架构类型，但**必须用 `question` 工具询问用户确认**，不得自行决定。

### 微服务技术栈选择

选择微服务架构时，**必须**用 `question` 工具询问用户选择技术栈（使用 `ui-standards §1.3` 模板）：

**一键选择模式（推荐）**：
- Spring Cloud Tencent（推荐）
- Spring Cloud Alibaba
- 逐个选择

**选择 Spring Cloud Tencent 后的额外确认步骤**：
1. **JDK/Spring Boot 版本确认**：`1.29.38-Finchley-RELEASE` 对应 Spring Boot 2.0.x，支持 JDK 8 和 JDK 11（包括 KONA JDK8），必须询问用户确认
2. **PolarisMesh 地址确认**：默认 `grpc://127.0.0.1:8091`（本地），询问用户选择本地或腾讯云托管

**逐个选择模式必选组件**：
- 服务注册中心：Nacos / Eureka / Consul / ZooKeeper
- API 网关：Spring Cloud Gateway / Zuul / Kong
- 配置中心：Nacos Config / Spring Cloud Config / Apollo
- 服务间通信：OpenFeign / RestTemplate / gRPC / 消息队列

---

## 2. 阶段2职责

> **强制执行**：阶段2是架构师的必执行阶段，不可跳过。阶段2完成后才能进入阶段3。

### 执行步骤（按顺序）

1. **步骤1：确认架构类型**
   - 读取 `$CHECK_DIR/00-env/architecture-decision.md`
   - 若文件不存在，提示用户先执行阶段0步骤4（架构类型确认）

2. **步骤2：检查设计文档状态**
   - 读取 `$DESIGN_DIR` 目录内容
   - 判断是否包含实际设计文档（排除 `_` 前缀的模板文件和 README.md）
   - 记录检查结果

3. **步骤3：生成开发任务设计（条件执行）**
   - **条件**：若 `$DESIGN_DIR` 包含实际设计文档（如 01-tech-stack.md, 03-database-design.md 等）
   - **执行**：为 `$PLANS_DIR/` 下的每个 `TASK-*.md` 文件生成对应的 `DES-*.md` 文件
   - **模板**：使用 `plans/des-template.md` 模板
   - **输出**：`$PLANS_DIR/DES-{TASK编号}-{任务名称}.md`

4. **步骤4：记录状态**
   - 若无实际设计文档 → 记录状态到 `$CHECK_DIR/00-env/pipeline-status.md`，推迟到阶段3生成
   - 若已生成DES文件 → 更新 `$CHECK_DIR/00-env/pipeline-status.md` 标记阶段2完成

### 阶段2完成检查清单

- [ ] 架构类型已确认（`$CHECK_DIR/00-env/architecture-decision.md` 存在）
- [ ] `$DESIGN_DIR` 目录内容已检查
- [ ] 若有实际设计文档，已为每个TASK生成对应的DES文件
- [ ] `$CHECK_DIR/00-env/pipeline-status.md` 已更新

### 阶段3前置条件检查

> 阶段3开始前，必须检查以下条件：

| 检查项 | 条件 | 不满足时处理 |
|--------|------|-------------|
| DES文件已生成 | `$PLANS_DIR/DES-*.md` 文件数量 = `$PLANS_DIR/TASK-*.md` 文件数量 | 回阶段2生成DES文件 |
| 架构类型已确认 | `$CHECK_DIR/00-env/architecture-decision.md` 存在 | 提示用户先执行阶段0步骤4 |

---

## 3. 阶段3职责

### 3.1 系统级设计文档生成（`$DESIGN_DIR` 仅含模板时）

> 详细流程见 `references/architect-design-generation-flow.md`

#### 执行方式

- **主上下文执行**：步骤1-4（读取输入/事实表/模块划分/技术决策）、步骤6b（待确认回写）、步骤8（校验交付）
- **subagent 隔离执行**：步骤5（前序文档生成）、步骤6a（待确认扫描）、步骤7（核心文档生成）
- **协调文件**：`$DESIGN_DIR/_design-context.md` 承载事实表摘要、决策摘要、跨文档引用索引、进度看板
- **并行策略**：步骤5和步骤7采用分层并行，同层文档同时派发subagent，层间串行

#### 输出清单

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

#### 标准流程（8步）

**步骤1：读取输入**
1. 读取 `$REQUIREMENTS_DIR/` 下的所有需求文档
2. 读取 `specification/` 下的开发规范文档
3. 读取 `$CONFIG_DIR/middleware.example.yaml` 了解中间件配置结构
4. 若 `$PLANS_DIR/WP-*.md` 存在，读取工作包了解功能范围
5. 若以上均不存在，停止并提示用户先提供需求文档

**步骤2：建立事实表**
从需求文档中抽取结构化事实，后续文档只能引用事实表或已确认决策，不得即兴造名。

必须抽取：
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

**步骤3：功能模块与应用架构划分**
基于事实表业务功能清单，与用户交互确定模块划分：
1. 初步分析：基于事实表，分析可能的功能模块
2. 询问架构形态（前置检查：若 `$CHECK_DIR/00-env/architecture-decision.md` 已存在，直接使用，跳过询问）
3. 展示映射建议：展示「业务功能 → 模块」映射建议，与用户探讨
4. 落盘确认：落盘后展示摘要获确认

模块拆分原则：
| 场景 | 粒度 | 判断依据 |
|------|------|----------|
| 功能独立、职责单一 | 1:1 映射 | 一个业务功能对应一个模块 |
| 多个功能围绕同一实体/业务领域 | 聚合（N:1） | 如查询/新增/修改聚合为XX管理模块 |
| 功能复杂、跨多个技术域 | 拆分（1:N） | 如涉及联机+批处理+文件处理 |

**模块划分方案**（用 `question` 工具让用户选择）：

| 方案 | 适用场景 | 划分逻辑 | 示例 |
|------|---------|---------|------|
| 按业务域聚合 | 功能边界清晰、业务领域明确 | 围绕同一业务实体/领域的功能聚合为一个模块 | 基础支撑（组织/用户/角色/部门/参数）、任务中心（模板/创建/流转/确认/催办/代理）、数据分析（统计报表/考核/驾驶舱）、系统管理（日志/批处理/通知/RPA） |
| 按开发任务分组 | 已有TASK划分、开发计划明确 | 将同一TASK下的工作包聚合为一个模块 | TASK-001系统基础设施（组织/用户/角色/部门/参数）、TASK-002任务管理核心（模板/创建/流转/确认/催办）、TASK-003统计报表、TASK-004驾驶舱与RPA、TASK-005系统管理与辅助功能 |
| 手动调整 | 用户有特定需求 | 用户自行指定每个功能的模块归属 | 由用户定义 |

选择后按对应方案展示「业务功能 → 模块」映射建议，与用户探讨确认。

落盘 `_module-split.md` 后，更新 `_design-context.md` 第2节。

**步骤4：确认技术决策**
按以下类别逐一与用户确认关键决策。优先从需求文档和用户已有约束中推断，只有影响后续设计且无法推断时才提问。

必问决策项：
| 类别 | 决策项 |
|------|--------|
| 技术选型 | 后端框架、前端框架、数据库、ORM/持久层、API风格 |
| 架构决策 | 架构形态、系统边界、外部系统对接、同步/异步、事务边界 |
| 命名规范 | 包名/模块名、API路径命名、数据库表/字段命名 |
| 安全认证 | 认证方式、权限模型、敏感数据处理 |
| 部署运维 | 服务端口、配置方式、容器化方案 |

落盘 `_technical-decisions.md` 后，更新 `_design-context.md` 第2节。

**步骤5：生成前序文档（分层并行）**

并行依赖图：
```
第1波（并行）: _module-split + _application-architecture + _technical-decisions + 01-tech-stack
第2波（串行）: 02-system-architecture（依赖第1波全部）
```

Subagent 通用派发模板：
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

写入 $DESIGN_DIR/{文档编号}。

完成后只返回:
- 文件路径
- 跨文档引用摘要（供更新 _design-context.md 第3节）
- 待确认项（不超过5条）

不要返回文档正文。
```

每次 subagent 返回后：
1. 检查文件是否已落盘且非空
2. 更新 `_design-context.md` 第3节和第4节
3. 记录待确认项
4. 若当前波次全部完成，进入下一波次

**步骤6：待确认事项确认**
- 6a. 扫描待确认项（派发subagent）：扫描前序文档中的所有「待确认」标记，返回汇总表
- 6b. 逐项确认与回写（主上下文）：展示汇总表，逐项与用户确认

| 类型 | 回写目标 | 回写动作 |
|------|---------|---------|
| 技术决策类 | `_technical-decisions.md` | 将"待确认"替换为确认值 |
| 业务事实类 | 原文档对应位置 | 将"待确认"替换为确认值 |
| 仍无法确认 | 原位置保留 | 保留"待确认"，追加原因和影响说明 |

**步骤7：生成核心与后续文档（分层并行）**

并行依赖图：
```
第3波（并行）: 03-database-design + 05-frontend-design（若需要）
第4波（串行）: 04-api-design（依赖03的表结构）
第5波（可选并行）: 06-mobile-design + 07-deployment-design + 08-security-design
```

03-database-design 专用策略（需覆盖全部实体）：
- 阶段一（表清单）：读取事实表实体清单，生成表清单
- 阶段二（分批字段设计）：按模块分批生成字段设计和 CREATE TABLE
- 阶段三（补充章节）：生成索引、枚举参数、初始化迁移、数据安全等章节

04-api-design 专用策略：
- 必须在 03-database-design 完成后执行
- 读取 03 的表结构，确保API字段与数据库字段一致
- 按服务分组生成API定义

**步骤8：校验并交付**

校验项：
| 检查项 | 说明 |
|--------|------|
| 文件完整性 | 必须文档（01-04）+ `_` 前缀文件全部存在且非空 |
| 模块一致性 | `_module-split.md` 的模块标识与 `02-system-architecture.md` 一致 |
| 决策引用 | `_technical-decisions.md` 的关键决策在架构/部署/安全文档中被引用 |
| 跨引用一致 | 03的表名 → 04的API → 05的页面路由，引用链完整 |
| 待确认清零 | 所有"待确认"项已在步骤6确认并回写 |

校验不通过时先补齐再交付。交付后更新 `$CHECK_DIR/02-design.md` 供阶段4审查使用。

#### 纪律要求

**跨文档一致性**：
- 同一系统名、模块名、角色名、表名、字段名、API路径必须完全一致
- 模块名统一来源为 `_module-split.md`
- 数据库字段必须能追溯到需求文档中的输入/输出要素
- API 请求/响应字段必须能对应数据库字段或明确标注为派生字段

**待确认项管理**：
- 未确认事实写"待确认"，不编造
- 步骤6确认的技术决策必须同步回写 `_technical-decisions.md`
- 数据库实体和 API 字段依赖已确认的决策，不可跳过步骤6直接生成 03/04

**上下文管理**：
- 文档生成通过 subagent 隔离执行，主上下文不持有文档正文
- subagent 只返回摘要（跨引用索引+待确认项），不返回正文
- 阶段间通过 `_design-context.md` 传递状态
- 并行派发：同层文档同时派发多个subagent，等待全部返回后统一更新协调文件再进入下一波次

---

### 3.2 代码框架搭建（仅脚手架，不含业务代码）

> **重要**：架构师只生成脚手架代码，为研发角色提供开发起点。**禁止生成业务实现代码**。

#### 后端脚手架内容

- Maven 多模块项目结构（父POM + 子模块目录）
- 基础配置文件（pom.xml、application.yml、bootstrap.yml）
- 公共模块（mimo-common）：统一响应封装、全局异常处理、基础实体类、JWT工具类、分页封装
- 每个微服务的 Application 主类和空目录结构（controller/service/mapper/entity/dto）
- API 网关：路由配置、认证过滤器、跨域配置
- 示例服务（仅1个，如 auth-service）：提供完整示例代码供研发角色参考模式

#### 前端脚手架内容

- Vue 3 + TypeScript + Vite 项目结构
- package.json（依赖声明）
- vite.config.ts（代理、别名、自动导入）
- 布局组件（AppLayout/Header/Sidebar/Main）
- 路由配置骨架（路由表 + 守卫）
- 状态管理骨架（Pinia stores）
- API 封装（Axios 实例、拦截器）
- 类型定义文件（.d.ts）
- 示例页面（仅登录页 + 1个列表页）供研发角色参考模式

#### 微服务额外内容

- 服务注册中心配置
- API 网关服务
- 配置中心配置
- 服务间调用客户端（FeignClient 接口定义，无实现）

#### 不属于脚手架的内容（由研发角色实现）

- 业务实体类（Entity）
- 业务数据访问层（Mapper/Repository）
- 业务服务层（Service/ServiceImpl）
- 业务控制器（Controller）
- 业务页面组件（除示例外的所有页面）
- 业务 API 接口定义（除示例外的所有接口）

#### 并行策略

```
阶段1（并行）: 父POM + 公共模块、前端项目、Docker配置
阶段2（并行）: 基础服务、业务服务、辅助服务（依赖父POM）
```

#### 框架编译验证（非正式审查，仅验证框架可编译运行）

- 后端：`mvn clean compile` + 单元测试 + 代码规范
- 前端：`npm run build` + `npm run lint` + `vue-tsc --noEmit`

#### 框架交付确认

1. **架构师自检**：按 `templates/framework-delivery-checklist.md` 验收
2. **PM确认**：用 `question` 工具与 PM 确认框架是否满足设计要求
3. **研发人员确认**：向研发人员介绍框架结构和使用方式

---

## 4. 阶段4/5审查职责（最终全量审查）

> **重要**：架构师的阶段4/5职责是**最终全量审查**（所有迭代完成后执行），不是迭代级审查。迭代级审查由研发角色在阶段3内自行执行。

### 阶段4：设计符合性审查

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 使用 `templates/design-review-checklist.md` 生成检查单
3. 逐条核对代码与设计的符合性
4. 使用 `templates/design-conformance-review.md` 生成 `$CHECK_DIR/04-review.md`
5. 展示 `ui-standards §2.3` 质量门禁展示
6. 不通过 → `ui-standards §4.2` 质量门禁失败 → 回阶段3修正
7. 轮次达上限 → `ui-standards §4.5` 轮次耗尽 → 用户决策

并行策略：
```
同时派发3个subagent：
- SubAgent 1：审查后端代码（Service层）
- SubAgent 2：审查后端代码（Controller层）
- SubAgent 3：审查前端代码
```

### 阶段5：代码质量审查

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 后端：按阿里Java手册审查（`specification/alibaba-java-manual.md`）
3. 前端：按frontend-spec.md审查（`specification/frontend-spec.md`）+ `npm run lint`
4. 使用 `templates/code-quality-review.md` 生成 `$CHECK_DIR/05-quality.md`
5. 展示 `ui-standards §2.3` 质量门禁展示
6. 有Blocker/Critical → `ui-standards §4.2` → 回阶段3修正

### 阶段6（由测试角色负责）

> 阶段6（测试与覆盖率）由 `software-delivery-tester` 技能独立负责。架构师不直接执行阶段6，但可查看测试覆盖率报告。

---

## 5. 设计符合性保障机制

> 详细内容见 `references/design-compliance.md`

### 事前预防：设计方案必须明确可验证

- 接口设计必须精确到路径、参数名、参数类型、返回值格式、状态码
- 数据库设计必须精确到表名、字段名、字段类型、约束、索引
- 目录结构必须精确到每个文件和包的职责说明
- 技术选型必须明确到具体的库名和版本号

### 事中控制：开发过程检查点

- 架构师必须向研发人员介绍框架结构和使用方式
- 研发人员必须确认理解后方可开始编码
- 研发人员遇到设计问题必须通过 `question` 工具向架构师提问
- 不得擅自调整任何设计决策

### 设计方案调整流程

1. 停止开发：不得擅自调整，立即停止当前工作
2. 提出申请：通过 `question` 工具向架构师提出调整请求
3. 说明原因：必须说明调整原因和预期效果
4. 架构师评估：架构师评估调整的影响范围
5. 决策记录：同意调整则更新设计文档，拒绝则维持原方案
6. 同步更新：如同意调整，需同步更新相关设计文档和检查单
7. 通知相关方：通知所有受影响的研发人员

---

## 6. 与研发协作流程

> 详细内容见 `references/architect-dev-flow.md`

- **架构师与研发人员直接沟通**：架构师需向研发人员介绍框架结构和使用方式，研发人员确认理解后方可开始编码
- **框架调整沟通流程**：研发人员如需调整框架结构，需通过 `question` 工具向架构师提出调整请求
- **问题升级机制**：研发人员遇到框架相关问题时，首先通过 `question` 工具向架构师提问；如架构师无法解决，可升级至 PM 协调解决
- **沟通记录**：重要沟通内容需记录在 `$CHECK_DIR/` 目录下，便于追溯和审查

---

## 7. UI模板引用

| 执行步骤 | UI模板引用 | 类型 |
|---------|-----------|------|
| 阶段0 路径确认 | `ui-standards §1.1` | question |
| 阶段0 角色选择 | `ui-standards §1.7` | question |
| 阶段0 架构类型选择 | `ui-standards §1.2` | question |
| 阶段0 微服务技术栈 | `ui-standards §1.3` | question |
| 阶段0 开发任务选择 | `ui-standards §1.6` | question |
| 每阶段开始 | `ui-standards §5.1` | 状态展示 |
| 每阶段完成 | `ui-standards §5.2` | 状态展示 |
| 流水线状态 | `ui-standards §2.1` | 状态展示 |
| 前置条件检查 | `ui-standards §2.2` | 状态展示 |
| 质量门禁 | `ui-standards §2.3` | 状态展示 |
| 架构师特殊展示 | `ui-standards §3.3` | 状态展示 |
| 前置条件不满足 | `ui-standards §4.1` | 错误格式 |
| 质量门禁失败 | `ui-standards §4.2` | 错误格式 |
| 设计文档缺失 | `ui-standards §4.3` | 错误格式 |
| 中间件配置缺失 | `ui-standards §4.4` | 错误格式 |
| 轮次耗尽 | `ui-standards §4.5` | 错误格式 |
| 子agent派发 | `ui-standards §5.3` | 状态展示 |
| 子agent返回 | `ui-standards §5.4` | 状态展示 |

---

## 8. 模板文件

| 文件 | 模板位置 | 生成角色 |
|------|---------|---------|
| 设计符合性审查报告 | `templates/design-conformance-review.md` | 架构师 |
| 代码质量审查报告 | `templates/code-quality-review.md` | 架构师 |
| 框架交付验收清单 | `templates/framework-delivery-checklist.md` | 架构师 |
| 设计审查检查单 | `templates/design-review-checklist.md` | 架构师 |
| 开发任务设计 | `plans/des-template.md` | 架构师 |
| `_design-context.md` | `design/_design-context.md`（模板） | 架构师 |
| `_module-split.md` | `design/_module-split.md`（模板） | 架构师 |
| `_technical-decisions.md` | `design/_technical-decisions.md`（模板） | 架构师 |
| `_application-architecture.md` | `design/_application-architecture.md`（模板） | 架构师 |

---

## 9. 触发条件

- 用户选择架构师角色
- "架构设计" / "代码框架" / "设计文档" / "系统架构"
- `/software-delivery-architect`
- `/software-delivery-architect --arch=monolith`
- `/software-delivery-architect --arch=microservice`


