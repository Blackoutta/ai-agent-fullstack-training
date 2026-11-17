# 阶段0环境准备 - subagent 指令（仅文件操作部分）

> 本文件是 software-delivery skill 阶段0的 subagent 执行指令。
> **重要**：subagent 只执行非交互的文件操作，交互步骤（question 调用）由主 agent 直接执行。
> 主 agent 派发 subagent 时，subagent 读取本文件获取文件操作执行流程。

---

## 任务概述

执行 software-delivery 阶段0（环境准备）的**非交互文件操作**部分：
- ~~步骤0：路径确认~~（主 agent 执行）
- ~~步骤1：角色确认~~（主 agent 执行）
- 步骤2：环境初始化（仅文件操作：创建目录、复制模板）
- 步骤3：输入收集（文件读取）
- ~~步骤4：范围确认~~（主 agent 执行，subagent 仅接收结果）
- 步骤5：任务登记（文件写入）

**输入**：主 agent 通过 prompt 传入路径配置、角色信息和 skills 父目录。
**最终输出**：结构化 JSON 结果，供主 agent 解析展示。

---

## 执行步骤

> **前置条件**：主 agent 已完成步骤0（路径确认）、步骤1（角色确认），并通过 prompt 传入以下信息：
> - `path_config`：路径配置对象（包含 deliverables, check, plans, requirements, config, design 等路径）
> - `role`：角色信息对象（包含 name, stages, core_responsibilities）
> - `cleanup_dirs`：用户选择要清理的目录列表（如有旧产物）
> - `skills_dir`：所有 skill 所在的父目录（用于定位模板源文件）

### 步骤2：环境初始化

> **前置条件**：主 agent 已通过 prompt 传入 `cleanup_dirs`（用户选择要清理的目录列表）。

#### 2.1 清理旧产物（如用户选择）

根据主 agent 传入的 `cleanup_dirs` 列表，删除对应的目录内容。

#### 2.2 创建目录结构

根据路径配置创建以下目录（如不存在）：
- `{deliverables}/`
- `{deliverables}/backend/`
- `{deliverables}/frontend/`
- `{deliverables}/sql/`
- `{deliverables}/ops/`
- `{check}/00-env/`
- `{plans}/`
- `{requirements}/`
- `{config}/`
- `{design}/`

#### 2.3 复制模板和 README 文件

从 skill 目录复制模板和 README 到项目目录：

**requirements/ 目录**（从 `$SKILLS_DIR/software-delivery-base/requirements/`）：
- README.md

**plans/ 目录**（从 `$SKILLS_DIR/software-delivery-base/plans/`）：
- README.md
- work-package-template.md
- work-package-bugfix-template.md
- work-package-completion-template.md
- task-template.md
- des-template.md

**design/ 目录**（从 `$SKILLS_DIR/software-delivery-base/design/`）：
- README.md
- _design-context.md
- _module-split.md
- _technical-decisions.md
- _application-architecture.md

**config/ 目录**（从 `$SKILLS_DIR/software-delivery-base/config/`）：
- README.md
- .gitignore
- middleware.example.yaml

**check/ 目录**（从 `$SKILLS_DIR/software-delivery-base/check/`）：
- README.md

### 步骤3：输入收集

#### 3.1 读取需求文档

读取 `{requirements}/` 目录下的所有 `.md` 文件（排除 README.md）。

#### 3.2 读取中间件配置

读取 `{config}/middleware.local.yaml`（如存在）。
- 仅提取参数名（MySQL/Redis/Kafka 等），不提取密码等敏感信息
- 如不存在，检查 `{config}/middleware.example.yaml`

#### 3.3 统计关键指标

统计以下指标（通过搜索代码文件）：
- **数据库表数量**：搜索 `CREATE TABLE` 语句
- **API 接口数量**：搜索 `@RequestMapping`/`@GetMapping`/`@PostMapping` 等注解
- **测试类数量**：搜索 `@Test` 注解或 `*Test.java`/`*.test.ts` 文件
- **测试用例数**：统计 `@Test` 方法数量或 `it(`/`test(` 调用数量

### 步骤4：范围确认（主 agent 执行，subagent 仅接收结果）

> **注意**：步骤4的交互部分（架构类型确认、微服务技术栈选择、开发任务选择）由主 agent 直接执行。
> subagent 不执行此步骤，仅通过 prompt 接收主 agent 传入的确认结果：
> - `architecture_type`：monolith | microservice
> - `microservice_stack`：（仅微服务时）registry, gateway, config, communication
> - `task_scope`：TASK-xxx | new
>
> **scope-definition.md 由主 agent 在步骤4完成后生成**，写入 `{check}/00-env/scope-definition.md`，记录功能范围定义。subagent 不负责此文件。

### 步骤5：任务登记

#### 5.1 生成流程检查清单

写入 `{check}/00-env/pipeline-status.md`，内容格式：

```markdown
# 流水线状态

## 阶段状态
| 阶段 | 名称 | 状态 |
|------|------|------|
| 0 | 环境准备 | ✅ 已完成 |
| 1 | 需求拆分 | ⏸️ 待执行 |
| 2 | 开发任务计划 | ⏸️ 待执行 |
| 3 | 编码实现 | ⏸️ 待执行 |
| 4 | 设计符合性审查 | ⏸️ 待执行 |
| 5 | 代码质量审查 | ⏸️ 待执行 |
| 6 | 测试与覆盖率 | ⏸️ 待执行 |
| 7 | 交付汇总 | ⏸️ 待执行 |

## 当前状态
- 当前角色：{role}
- 架构类型：{architecture_type}
- 开发任务：{task_scope}
- 路径模式：{path_mode}
```

#### 5.2 写入关键指标

写入 `{check}/00-env/key-metrics.md`，内容格式：

```markdown
# 关键指标登记

| 指标 | 数量 | 统计时间 |
|------|------|---------|
| 数据库表数量 | {database_tables} | {date} |
| API 接口数量 | {api_endpoints} | {date} |
| 测试类数量 | {test_classes} | {date} |
| 测试用例数 | {test_cases} | {date} |
```

---

## 返回格式

执行完成后，返回以下 JSON 结构：

```json
{
  "status": "success",
  "path_config": {
    "mode": "default|custom_base|individual",
    "base_path": ".",
    "deliverables": "deliverables/",
    "check": "check/",
    "plans": "plans/",
    "requirements": "requirements/",
    "config": "config/",
    "design": "design/"
  },
  "role": {
    "name": "PM|架构师|后端开发|前端开发|移动端开发|数据库工程师|测试|运维",
    "stages": [0, 1, 2],
    "core_responsibilities": "需求拆分、开发任务规划"
  },
  "directories_created": ["deliverables", "deliverables/backend", "deliverables/frontend", "deliverables/sql", "deliverables/ops", "check", "plans", "requirements", "config", "design"],
  "templates_copied": ["requirements/README.md", "plans/README.md", "plans/work-package-template.md", "plans/task-template.md", "design/README.md", "design/_design-context.md", "config/README.md", "config/.gitignore", "config/middleware.example.yaml", "check/README.md"],
  "requirements_status": {
    "path": "requirements/",
    "files": ["需求文档1.md", "需求文档2.md"],
    "summary": "已读取2个需求文档"
  },
  "middleware_status": {
    "exists": true,
    "path": "config/middleware.local.yaml",
    "components": ["MySQL", "Redis"]
  },
  "key_metrics": {
    "database_tables": 15,
    "api_endpoints": 42,
    "test_classes": 28,
    "test_cases": 156
  },
  "architecture_type": "monolith|microservice",
  "microservice_stack": {
    "registry": "Nacos",
    "gateway": "Spring Cloud Gateway",
    "config": "Nacos Config",
    "communication": "OpenFeign"
  },
  "task_scope": "TASK-001|new",
  "pipeline_status_file": "check/00-env/pipeline-status.md"
}
```

**失败时返回**：
```json
{
  "status": "failed",
  "error": "错误描述",
  "step": "失败的步骤"
}
```

---

## 注意事项

1. **不执行交互步骤**：subagent 不调用 question 工具，所有交互由主 agent 完成
2. **凭据安全**：读取 middleware.local.yaml 时仅提取参数名，不提取密码等敏感信息
3. **目录存在性检查**：创建目录前先检查是否存在，避免覆盖
4. **模板复制**：从 skill 目录复制模板，不是从项目根目录
5. **错误处理**：如某步骤失败，返回 failed 状态和错误描述
