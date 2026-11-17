# 架构师详细职责

> 本文档是 SKILL.md 的详细说明，执行时请以 SKILL.md 为准。

## 1. 架构类型确认（阶段 0 步骤 4：范围确认）

### 确认流程

1. 用 `question` 工具询问用户选择架构类型：
   - `monolith`：单体应用架构
   - `microservice`：微服务架构
2. 将选择记录到 `$CHECK_DIR/00-env/architecture-decision.md`
3. 后续设计文档和代码框架基于此选择生成

### 调整权限

架构师可根据项目实际情况建议调整架构类型，但**必须用 `question` 工具询问用户确认**，不得自行决定。

### 微服务技术栈选择

选择微服务架构时，**必须**用 `question` 工具询问用户选择技术栈：

**必选组件**：
- 服务注册中心：Eureka / Consul / Nacos / ZooKeeper
- API 网关：Spring Cloud Gateway / Zuul / Kong
- 配置中心：Spring Cloud Config / Nacos Config / Apollo
- 服务间通信：OpenFeign / RestTemplate / gRPC / 消息队列

**可选组件**：
- 熔断降级：Sentinel / Hystrix / Resilience4j
- 链路追踪：Sleuth + Zipkin / SkyWalking / Jaeger
- 负载均衡：Spring Cloud LoadBalancer / Ribbon
- 分布式事务：Seata / 本地消息表 / TCC

## 2. 阶段 2 职责

1. 读取 `$CHECK_DIR/00-env/architecture-decision.md` 确认架构类型
2. 检查 `$DESIGN_DIR` 目录内容：
   - 有实际设计文档 → 生成开发任务设计到 `$PLANS_DIR/DES-*.md`
   - 无实际设计文档 → 记录状态，推迟到阶段 3
3. **阶段2仅读取 `$DESIGN_DIR`，不得修改**

## 3. 阶段 3 职责

### 设计文档生成（`$DESIGN_DIR` 无文件时）

按 `references/architect-design-generation-flow.md` 的8步流程执行。

必须生成：
- `_design-context.md`：上下文协调文件
- `_module-split.md`：功能模块拆分清单
- `_technical-decisions.md`：技术决策清单
- `01-tech-stack.md`：技术栈选型
- `02-system-architecture.md`：系统架构设计
- `03-database-design.md`：数据库设计
- `04-api-design.md`：接口设计

可选生成：`05-frontend-design.md`、`06-mobile-design.md`、`07-deployment-design.md`、`08-security-design.md`

### 代码框架搭建（仅脚手架，不含业务代码）

> **重要**：架构师只生成脚手架代码，为研发角色提供开发起点。**禁止生成业务实现代码**（如完整的 Service/Mapper/Controller 实现）。业务代码由研发角色在阶段3按 DES-*.md 编码实现。

**后端脚手架内容**：
- Maven 多模块项目结构（父POM + 子模块目录）
- 基础配置文件（pom.xml、application.yml、bootstrap.yml）
- 公共模块（mimo-common）：统一响应封装、全局异常处理、基础实体类、JWT工具类、分页封装
- 每个微服务的 Application 主类和空目录结构（controller/service/mapper/entity/dto）
- API 网关：路由配置、认证过滤器、跨域配置
- 示例服务（仅1个，如 auth-service）：提供完整示例代码供研发角色参考模式

**前端脚手架内容**：
- Vue 3 + TypeScript + Vite 项目结构
- package.json（依赖声明）
- vite.config.ts（代理、别名、自动导入）
- 布局组件（AppLayout/Header/Sidebar/Main）
- 路由配置骨架（路由表 + 守卫）
- 状态管理骨架（Pinia stores）
- API 封装（Axios 实例、拦截器）
- 类型定义文件（.d.ts）
- 示例页面（仅登录页 + 1个列表页）供研发角色参考模式

**微服务额外内容**：
- 服务注册中心配置
- API 网关服务
- 配置中心配置
- 服务间调用客户端（FeignClient 接口定义，无实现）

**不属于脚手架的内容**（由研发角色实现）：
- 业务实体类（Entity）
- 业务数据访问层（Mapper/Repository）
- 业务服务层（Service/ServiceImpl）
- 业务控制器（Controller）
- 业务页面组件（除示例外的所有页面）
- 业务 API 接口定义（除示例外的所有接口）

### 框架交付确认

1. **架构师自检**：按 `templates/framework-delivery-checklist.md` 验收
2. **PM确认**：用 `question` 工具与 PM 确认框架是否满足设计要求
3. **研发人员确认**：向研发人员介绍框架结构和使用方式

## 4. 阶段 4/5/6 审查职责

> **重要**：架构师的阶段4/5职责是**最终全量审查**（所有迭代完成后执行），不是迭代级审查。迭代级审查由研发角色在阶段3内自行执行。

- **阶段 4**：主导设计符合性审查（全量汇总，合并所有迭代级审查报告）
- **阶段 5**：主导代码质量审查（全量汇总，合并所有迭代级审查报告）
- **阶段 6**：汇总测试覆盖率报告
