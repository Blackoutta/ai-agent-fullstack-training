# 软件交付流水线 - 详细阶段说明

> 本文件包含各阶段的详细步骤、UI模板引用、质量门禁规则。
> 主agent通过subagent读取本文件，减少主上下文token消耗。

---

## 阶段0：环境准备（主 agent 执行交互 + subagent 执行文件操作）

> **执行规则**：阶段0的交互步骤（question 调用）由主 agent 直接执行，文件操作（目录创建、模板复制、输入读取）可委托 subagent。主 agent 读取 `references/ui-standards.md` 获取 question 模板。

### 主 agent 执行步骤（交互）

> **路径发现策略**：
> - 若上下文已有路径信息（阶段0已完成、断点续做、用户指定），直接使用，跳过步骤0。
> - 若路径未知，主 agent 必须先用 `read` 工具读取工程根目录探测已有目录结构，再进入步骤0确认。

1. **步骤0：路径确认**（仅路径未知时执行）
   - 主 agent 用 `read` 工具读取工程根目录（来自环境信息中的 Working directory），探测已有目录
   - 调用 `question` 工具，使用 `ui-standards §1.1` 路径确认模板
   - 模板中的 `$PROJECT_ROOT` 替换为实际工程根目录路径
   - 逐字复制模板，禁止改写

2. **步骤1：角色确认**
   - 主 agent 调用 `question` 工具，使用 `ui-standards §1.7` 角色选择模板
   - 逐字复制模板，禁止改写

3. **步骤2：环境初始化**（交互部分）
   - 如检测到旧产物，主 agent 调用 `question` 工具 `ui-standards §1.4` 清理确认模板
   - 如用户选择清理 design/，主 agent 调用 `question` 工具 `ui-standards §1.5` 敏感目录清理确认模板

   > 步骤3（输入收集）由 subagent 执行，见下方 subagent 部分。

4. **步骤4：范围确认**（交互部分）
   - 主 agent 调用 `question` 工具 `ui-standards §1.2` 架构类型确认
   - 如选择微服务，主 agent 调用 `question` 工具 `ui-standards §1.3` 微服务技术栈
   - 主 agent 调用 `question` 工具 `ui-standards §1.6` 开发任务选择

### subagent 执行步骤（文件操作）

> 主 agent 派发 subagent 执行以下非交互步骤，subagent 读取 `references/env-init-subagent.md` 获取详细指令。

1. **步骤2：环境初始化**（文件操作部分）
   - 创建目录结构
   - 复制模板文件

2. **步骤3：输入收集**
   - 读取输入文档（requirements/）
   - 读取中间件配置（config/）
   - 统计关键指标

3. **步骤5：任务登记**
   - 输出流程检查清单
   - 初始化流水线状态文件

### 主 agent 最终处理

1. 接收 subagent JSON 结果（或直接获取文件操作结果）
2. 生成 `$CHECK_DIR/00-env/scope-definition.md`（主 agent 根据步骤4的范围确认结果写入）
3. 展示 `ui-standards §2.1` 阶段进度展示
4. 展示 `ui-standards §2.4` 关键指标登记（数据来自 subagent 返回的 key_metrics）
5. 展示 `ui-standards §2.5` 流程检查清单（数据来源：路径=步骤0，角色=步骤1，目录=步骤2 subagent，输入=步骤3 subagent，架构=步骤4，任务=步骤4，指标=步骤3 subagent）
6. 进入后续阶段

---

## 阶段1：需求拆分（PM）

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 读取需求文档（用subagent）
3. 拆分功能为工作包 `$PLANS_DIR/WP-*.md`
4. 输出需求理解摘要 `$CHECK_DIR/01-requirements.md`
5. 生成需求追溯矩阵 `$CHECK_DIR/01-traceability-matrix.md`
   - 使用 `templates/requirements-traceability-matrix.md` 模板
   - 初始列：需求ID → WP编号 → TASK编号（其他列待后续阶段补全）
6. 提取控制规则 `$CHECK_DIR/01-rules-extracted.md`
   - 按 `references/requirements-rule-extraction.md` 方法论执行
   - 输出规则清单，关联到需求ID
7. 展示 `ui-standards §5.2` 阶段完成提示

---

## 阶段2：开发任务计划（PM+架构师）

### PM - 开发任务计划制定

使用 `question` 工具 `ui-standards §1.11` 开发任务计划模式选择模板：

**选项1：AI推荐一键执行（推荐）**
1. AI自动生成全部开发任务计划
2. 展示推荐方案（`ui-standards §1.11` AI推荐方案展示格式）
3. PM确认后一键落盘

**选项2：AI推荐部分执行**
1. AI自动生成全部开发任务计划
2. PM选择要执行的（`ui-standards §1.11` 选择确认模板）
3. 仅落盘选中的TASK-*.md

**选项3：手动输入（两步式）**
1. PM输入迭代任务列表（任务编号+名称）
2. AI展示可用WP列表，PM为每个TASK勾选（`ui-standards §1.12`）
3. **排除规则**：已选WP从后续选项中移除
4. 生成 TASK-*.md → PM确认落盘

### 架构师

1. 检查 `$DESIGN_DIR` 状态
2. 生成开发任务设计 `$PLANS_DIR/DES-*.md`
3. 生成 `$CHECK_DIR/02-design.md`

---

## 阶段3：编码实现（按角色）

### 架构师

1. **系统级设计文档生成**（`$DESIGN_DIR` 仅含模板时）
   - 按 `architect-design-generation-flow.md` 执行
   - 必须生成：`_design-context.md`, `_module-split.md`, `_technical-decisions.md`, `01-tech-stack.md`, `02-system-architecture.md`, `03-database-design.md`, `04-api-design.md`
   - 微服务时还需：`_application-architecture.md`
   - 完成后必须回到阶段2补全DES-*.md

2. **代码框架搭建**（必须包含后端+前端）
   - 后端：父POM + 公共模块 + 微服务骨架 + schema.sql
   - 前端：
     - 基础配置：package.json + vite.config.ts + tsconfig.json + index.html
     - 入口文件：src/main.ts + src/App.vue
     - 路由配置：src/router/index.ts（含所有业务路由骨架）
     - 状态管理：src/stores/index.ts + src/stores/user.ts（用户状态）
     - API封装：src/utils/request.ts（Axios封装）+ src/api/目录结构
     - 布局组件：src/layout/index.vue（侧边栏+顶部导航+内容区）
     - 登录页：src/views/login/index.vue
     - 类型声明：src/env.d.ts + src/vite-env.d.ts

3. **框架编译验证**（非正式审查，仅验证框架可编译运行）
   - 后端：`mvn clean compile` + 单元测试 + 代码规范
   - 前端：`npm run build` + `npm run lint` + `vue-tsc --noEmit`

### 后端开发
依据：`DES-*-api.md` + `DES-*-db.md`
1. pom.xml配置 → 2. application.yml → 3. schema.sql → 4. 业务代码 → 5. **展示交互式选项（§1.15）**

### 前端开发
依据：`DES-*-frontend.md` + `DES-*-api.md`
1. 构建配置（vite.config.ts/tsconfig.json/package.json）→ 2. 页面/组件/router/store → 3. **展示交互式选项（§1.15）**

### 移动端开发
依据：`DES-*-mobile.md` + `DES-*-api.md`
1. 页面/组件/导航 → 2. 构建配置 → 3. **展示交互式选项（§1.15）**
> 注：具体技术栈由设计文档指定（Flutter/React Native/原生等）

### 迭代级审查（强制）

> **核心原则**：每个TASK的后端/前端代码完成后，使用 `ui-standards §1.15` 模板展示交互式选项，让用户选择下一步操作。这是阶段4/5的**轻量级前置检查**，在阶段3内执行。阶段4/5是所有迭代完成后的**全量最终审查**，两者不重复。

**完整迭代流程**：
```
后端/前端编码 → 展示交互式选项（§1.15） → 根据选择执行对应操作
```

**检查时机**：
- 后端开发完成TASK后
- 前端开发完成TASK后

**交互式选项（使用 §1.15 模板）**：

编码完成后，展示以下选项供用户选择：

| 选项 | 执行动作 | 完成后处理 |
|------|----------|-----------|
| 编写单元测试 | 执行单元测试 → 自动执行设计符合性审查 → 自动执行代码质量审查 | 移除「编写单元测试」「设计符合性审查」「代码质量审查」选项 |
| 设计符合性审查 | 执行设计符合性审查 → 自动执行代码质量审查 | 移除「编写单元测试」「设计符合性审查」「代码质量审查」选项 |
| 代码质量审查 | 仅执行代码质量审查 | 移除「编写单元测试」「设计符合性审查」「代码质量审查」选项 |
| 继续下一个TASK | **允许跳过审查**，直接进入下一个TASK | 进入下一个TASK |
| 进入最终审查 | **允许跳过审查**，直接进入阶段6+7 | 进入最终审查 |
| 暂停流水线 | 保存当前状态 | 流水线暂停 |

**单元测试**（可选，由研发人员决定）：
- 用户选择「编写单元测试」选项后执行
- 后端：JUnit 5 + Mockito，测试文件位置 `src/test/java/com/xiaomi/mimo/{service}/`
- 前端：Vitest + Vue Test Utils，测试文件位置 `src/__tests__/` 或 `tests/`
- 如果用户选择编写但文件不存在 → 提示补充
- 执行完成后自动执行设计符合性审查和代码质量审查

**设计符合性检查内容**（阶段4迭代版）：
- 后端：代码结构、实体类、API接口、服务层是否与设计文档一致
- 前端：页面路由、组件结构、API调用、状态管理是否与设计文档一致
- 输出：`$CHECK_DIR/04-review-task-{编号}-{backend|frontend}.md`

**代码质量检查内容**（阶段5迭代版）：
- 后端：编译检查 + 阿里Java手册违规检查（Blocker/Critical）
- 前端：TypeScript检查 + ESLint检查 + 组件规范检查
- 输出：`$CHECK_DIR/05-quality-task-{编号}-{backend|frontend}.md`

**检查结果处理**：
- 设计不符合 → 列出不符合项，提示修正
- 有 Blocker/Critical → 列出问题，提示修正
- 检查完成 → 再次展示交互式选项（排除已完成的选项）

**报告关系说明**：
- 迭代级审查报告：`04-review-task-{编号}-{backend|frontend}.md` 和 `05-quality-task-{编号}-{backend|frontend}.md`（逐TASK详细报告）
- 阶段4/5报告：`04-review.md` 和 `05-quality.md`（全量汇总报告，合并所有迭代级报告+最终检查）

---

## 阶段4：设计符合性审查

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 使用 `templates/design-review-checklist.md` 生成检查单
3. 逐条核对代码与设计的符合性
4. 使用 `templates/design-conformance-review.md` 生成 `$CHECK_DIR/04-review.md`
5. 展示 `ui-standards §2.3` 质量门禁展示
6. 不通过 → `ui-standards §4.2` 质量门禁失败 → 回阶段3修正
7. 轮次达上限 → `ui-standards §4.5` 轮次耗尽 → 用户决策

---

## 阶段5：代码质量审查

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 后端：按阿里Java手册审查
3. 前端：按frontend-spec.md审查 + `npm run lint`
4. 使用 `templates/code-quality-review.md` 生成 `$CHECK_DIR/05-quality.md`
5. 展示 `ui-standards §2.3` 质量门禁展示
6. 有Blocker/Critical → `ui-standards §4.2` → 回阶段3修正

---

## 阶段6：测试与覆盖率

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 单元测试：后端 `mvn clean verify`；前端 `npm run coverage`
   - 如果迭代级审查中用户选择跳过单元测试，阶段6仅执行构建验证，不检查覆盖率
3. 使用 `templates/test-coverage-report.md` 生成 `$CHECK_DIR/06-coverage.md`
4. 软门禁不达标 → `ui-standards §1.9` 质量门禁放行确认
5. 构建验证：后端 `mvn clean verify`；前端 `npm run build`

---

## 阶段7：交付汇总

1. 展示 `ui-standards §5.1` 阶段开始提示
2. 使用 `templates/delivery-summary.md` 生成 `$CHECK_DIR/07-delivery.md`
3. **运维职责**：确认CI/CD配置、容器化配置、监控配置已就绪
4. 使用 `question` 工具 `ui-standards §1.8` 交付确认模板

---

## UI模板引用速查

| 执行步骤 | UI模板引用 | 类型 |
|---------|-----------|------|
| 阶段0 路径确认 | `ui-standards §1.1` | question |
| 阶段0 角色选择 | `ui-standards §1.7` | question |
| 阶段0 清理确认 | `ui-standards §1.4` | question |
| 阶段0 敏感目录清理 | `ui-standards §1.5` | question |
| 阶段0 架构类型选择 | `ui-standards §1.2` | question |
| 阶段0 微服务技术栈 | `ui-standards §1.3` | question |
| 阶段0 开发任务选择 | `ui-standards §1.6` | question |
| 阶段2 开发任务计划模式 | `ui-standards §1.11` | question |
| 阶段2 工作包勾选 | `ui-standards §1.12` | question |
| 阶段6 软门禁放行 | `ui-standards §1.9` | question |
| 阶段7 交付确认 | `ui-standards §1.8` | question |
| 断点续做 | `ui-standards §1.10` | question |
| 每阶段开始 | `ui-standards §5.1` | 状态展示 |
| 每阶段完成 | `ui-standards §5.2` | 状态展示 |
| 流水线状态 | `ui-standards §2.1` | 状态展示 |
| 前置条件检查 | `ui-standards §2.2` | 状态展示 |
| 质量门禁 | `ui-standards §2.3` | 状态展示 |
| 关键指标 | `ui-standards §2.4` | 状态展示 |
| 流程检查清单 | `ui-standards §2.5` | 状态展示 |
| 角色确认展示 | `ui-standards §3.1` | 状态展示 |
| 角色切换 | `ui-standards §3.2` | 状态展示 |
| 架构师特殊展示 | `ui-standards §3.3` | 状态展示 |
| 前置条件不满足 | `ui-standards §4.1` | 错误格式 |
| 质量门禁失败 | `ui-standards §4.2` | 错误格式 |
| 设计文档缺失 | `ui-standards §4.3` | 错误格式 |
| 中间件配置缺失 | `ui-standards §4.4` | 错误格式 |
| 轮次耗尽 | `ui-standards §4.5` | 错误格式 |
| 子agent派发 | `ui-standards §5.3` | 状态展示 |
| 子agent返回 | `ui-standards §5.4` | 状态展示 |
