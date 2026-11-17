---
name: software-delivery-pm
description: 软件交付流水线 - PM角色。负责需求拆分（阶段1）和开发任务计划制定（阶段2）。触发条件：用户选择PM角色、说"需求拆分"、"开发任务计划"、"工作包"、"TASK规划"、"/software-delivery-pm"。
---

# 软件交付流水线 - PM角色

> PM负责需求拆分和开发任务规划，执行阶段0→阶段1→阶段2。

---

## 前置依赖

本技能依赖 `software-delivery-base` 技能提供的：
- 阶段0环境准备流程
- UI标准模板（`references/ui-standards.md`）
- 质量门禁规则
- 模板文件（`plans/work-package-template.md`、`plans/task-template.md` 等）

执行前请确保阶段0已完成（路径确认、角色确认、目录初始化、输入收集）。

---

## 阶段0特殊处理（PM直接触发）

当通过 `/software-delivery-pm` 直接触发时，**跳过步骤1角色确认**，因为角色已确定为PM。

执行流程调整为：
1. **步骤0：路径确认** - 使用 `ui-standards §1.1` 模板
2. **步骤1：角色确认** - ⏭️ **跳过**（角色已确定为PM）
3. **步骤2：环境初始化** - 检测旧产物，必要时清理；**复制模板文件**（详见下方）
4. **步骤3：输入收集** - 读取需求文档、中间件配置
5. **步骤4：范围确认** - PM角色跳过架构类型确认（由架构师负责）
6. **步骤5：任务登记** - 输出流程检查清单

#### 步骤2详细说明：环境初始化

**2.0 检测旧产物**（在创建目录之前执行）：
- 检查 `{deliverables}/`、`{check}/`、`{plans}/` 目录是否存在且有实际内容（排除仅含 README.md 或模板文件的情况）
- 如果存在旧产物 → 使用 `ui-standards §1.4` 清理确认模板，用户确认后执行清理
- 如果不存在旧产物 → 跳过清理，直接执行 2.1

**2.1 创建目录结构**（如不存在）：
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

**2.2 复制模板和 README 文件**（从 `software-delivery-base` skill 目录）：

> **变量说明**：
> - `$SKILLS_DIR`：所有 skill 所在的父目录（由运行环境决定，如 MiMoCode 为 `.mimocode/skills/`，Claude Code 为 `.claude/skills/`）
> - `$SKILL_DIR`：当前 skill 的根目录（即 `$SKILLS_DIR/software-delivery-pm`）

| 目标目录 | 源目录 | 文件列表 |
|---------|--------|----------|
| `requirements/` | `$SKILLS_DIR/software-delivery-base/requirements/` | README.md |
| `plans/` | `$SKILLS_DIR/software-delivery-base/plans/` | README.md, work-package-template.md, work-package-bugfix-template.md, work-package-completion-template.md, task-template.md, des-template.md |
| `design/` | `$SKILLS_DIR/software-delivery-base/design/` | README.md, _design-context.md, _module-split.md, _technical-decisions.md, _application-architecture.md |
| `config/` | `$SKILLS_DIR/software-delivery-base/config/` | README.md, .gitignore, middleware.example.yaml |
| `check/` | `$SKILLS_DIR/software-delivery-base/check/` | README.md |

角色确认后直接展示：
```
**👤 角色确认**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：PM
执行阶段：阶段0 → 阶段1 → 阶段2
核心职责：需求拆分、开发任务规划
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 执行阶段

### 步骤3.5：需求文档确认（交互式）

阶段0完成后、进入阶段1前，**必须**使用 `ui-standards §1.16` 需求文档确认模板进行交互式确认：

1. 扫描 `$REQUIREMENTS_DIR/` 目录，统计 `.md` 文件（排除 README.md）
2. 根据扫描结果，选择对应的 §1.16 模板展示
3. 用户选择「重新扫描」→ 重新执行步骤1，循环展示
4. 用户选择「继续」→ 进入阶段1
5. 用户选择「跳过」→ 暂停流水线，提示用户稍后放入文档后重新执行

### 阶段1：需求拆分

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 读取需求文档（用subagent）
   - 读取 `$REQUIREMENTS_DIR/` 下的所有 `.md` 文件（排除 README.md）
3. 拆分功能为工作包 `$PLANS_DIR/WP-*.md`
   - 使用 `plans/work-package-template.md` 模板（feature模式）
   - 使用 `plans/work-package-bugfix-template.md` 模板（bugfix模式）
   - 使用 `plans/work-package-completion-template.md` 模板（completion模式）
4. 输出需求理解摘要 `$CHECK_DIR/01-requirements.md`
5. 展示 `ui-standards §5.2` 阶段完成提示

#### 并行策略

| 步骤 | 执行方式 | 说明 |
|------|----------|------|
| 读取需求文档 | subagent | 文件读取 |
| 拆分工作包 | subagent | 可并行生成多个WP文件 |
| 生成需求摘要 | subagent | 依赖拆分结果 |

并行示例：
```
同时派发N个subagent生成WP文件：
- SubAgent 1：生成WP-001 ~ WP-005
- SubAgent 2：生成WP-006 ~ WP-010
- SubAgent 3：生成WP-011 ~ WP-015
```

---

### 阶段2：开发任务计划制定

使用 `question` 工具 `ui-standards §1.11` 开发任务计划模式选择模板：

#### 选项1：AI推荐一键执行（推荐）

1. AI自动生成全部开发任务计划
2. 展示推荐方案（`ui-standards §1.11` AI推荐方案展示格式）
3. PM确认后一键落盘

#### 选项2：AI推荐部分执行

1. AI自动生成全部开发任务计划
2. PM选择要执行的（`ui-standards §1.11` 选择确认模板）
3. 仅落盘选中的TASK-*.md

#### 选项3：手动输入（两步式）

1. PM输入迭代任务列表（任务编号+名称）
2. AI展示可用WP列表，PM为每个TASK勾选（`ui-standards §1.12`）
3. **排除规则**：已选WP从后续选项中移除
4. 生成 TASK-*.md → PM确认落盘

#### 并行策略

| 步骤 | 执行方式 | 说明 |
|------|----------|------|
| PM制定开发任务 | subagent | 可并行生成多个TASK文件 |

并行示例：
```
同时派发2个subagent：
- SubAgent 1：生成TASK-001, TASK-002
- SubAgent 2：生成TASK-003, TASK-004
```

---

## 阶段2完成后：角色切换点选

阶段2完成后，**必须**使用 `ui-standards §1.16` 角色切换点选模板自动弹出角色切换界面：

1. 更新 `$CHECK_DIR/00-env/pipeline-status.md`，将阶段2状态改为 `✅ 已完成`
2. 展示 `ui-standards §5.2` 阶段完成提示
3. 展示 `ui-standards §2.1` 流水线状态
4. **自动弹出** `ui-standards §1.16` 角色切换点选模板（PM专用版本）
5. 用户选择角色后，加载对应技能继续流水线

**PM专用选项过滤规则**（强制）：
- PM自身不显示
- **仅显示架构师选项**（PM完成后必须由架构师确认架构类型、生成设计文档后，其他研发角色才能开始编码）
- 其他研发角色（后端开发、前端开发、移动端开发、数据库工程师、测试、运维）**全部隐藏**
- 保留"暂停流水线"选项

**原因**：架构师必须先完成阶段3（设计文档+代码框架），其他研发角色才能开始编码。这是流水线的硬性前置条件。

---

## 阶段3/4/5/6（PM可查看）

> 阶段3由研发角色执行，阶段4/5由架构师主导，阶段6由测试角色主导。PM可查看各阶段审查结果但不直接参与。

---

## Bug修复与功能补全

### Bug修复（--type=bugfix）

- 跳过阶段1全部内容和阶段2的PM部分
- 阶段0步骤3特殊处理：若无bug描述，用 `question` 工具引导用户描述bug信息（现象、复现步骤、影响范围）

### 功能补全（--type=completion）

- 跳过阶段1全部内容和阶段2的PM部分
- 阶段0步骤3特殊处理：若无功能描述，用 `question` 工具引导用户描述缺失功能

---

## UI模板引用

| 执行步骤 | UI模板引用 | 类型 |
|---------|-----------|------|
| 阶段0 路径确认 | `ui-standards §1.1` | question |
| 阶段0 清理确认 | `ui-standards §1.4` | question |
| 阶段0 敏感目录清理 | `ui-standards §1.5` | question |
| 需求文档确认 | `ui-standards §1.16` | question（动态，可循环） |
| 阶段2 开发任务计划模式 | `ui-standards §1.11` | question |
| 阶段2 工作包勾选 | `ui-standards §1.12` | question |
| 角色切换点选 | `ui-standards §1.16` | question（阶段2完成后自动弹出） |
| 每阶段开始 | `ui-standards §5.1` | 状态展示 |
| 每阶段完成 | `ui-standards §5.2` | 状态展示 |
| 断点续做 | `ui-standards §1.10` | question |
| 流水线状态 | `ui-standards §2.1` | 状态展示 |
| 关键指标 | `ui-standards §2.4` | 状态展示 |
| 流程检查清单 | `ui-standards §2.5` | 状态展示 |

---

## 模板文件

| 类型 | 必须使用的模板 | 生成角色 |
|------|--------------|---------|
| 功能开发工作包 | `plans/work-package-template.md` | PM |
| Bug修复工作包 | `plans/work-package-bugfix-template.md` | PM |
| 功能补全工作包 | `plans/work-package-completion-template.md` | PM |
| 开发任务计划 | `plans/task-template.md` | PM |

---

## 触发条件

- 用户选择PM角色
- "需求拆分" / "工作包" / "开发任务计划" / "TASK规划"
- `/software-delivery-pm`


