# Bug修复与功能补全流程

> Bug修复和功能补全流程跳过阶段1全部内容和阶段2的PM部分，但**架构师仍需执行阶段2的$DESIGN_DIR状态检查**，且**阶段0必须完整执行**。

## Bug 修复模式（--type=bugfix）

### 执行流程

阶段0 → 阶段3 → 阶段4 → 阶段5 → 阶段6

### 跳过范围

- 跳过阶段1（需求拆分）全部内容
- 跳过阶段2的PM部分（开发任务计划）
- **架构师仍需执行阶段2的$DESIGN_DIR状态检查**

### 前置要求

- 已有Bug修复工作包（`$PLANS_DIR/WP-*-fix-*.md`）
- 或用户通过`--scope`直接提供bug描述
- 若均无，阶段0步骤4会用`question`工具引导用户描述bug信息

### 阶段0步骤3特殊处理

处理功能范围参数时：
- 若指定 `--scope`：解析 bug 描述，记录到 `$CHECK_DIR/00-env/scope-definition.md`
- 若未指定 `--scope`：检查 `$PLANS_DIR/WP-*-fix-*.md` 是否存在
  - 存在：记录工作包列表
  - 不存在：用 `question` 工具引导用户描述bug信息（现象、复现步骤、影响范围）

### 阶段3编码修复

**架构师职责**（若 `$DESIGN_DIR` 为空）：
1. 按 `references/architect-design-generation-flow.md` 生成系统级设计文档
2. 搭建代码框架
3. Bug修复不生成开发任务设计文档（`$PLANS_DIR/DES-*.md`）

**研发角色职责**：
1. 读取Bug修复工作包，了解bug信息、复现步骤、根因分析、修复方案
2. 定位问题代码
3. 实施修复
4. 补充测试用例
5. 按 `templates/spec-coding.md` 自检清单逐项确认

**异常处理**：
- Bug无法复现 → 用 `question` 工具向PM报告
- 修复引入新bug → 暂停修复，用 `question` 工具向架构师报告
- 架构师未执行 → 用 `question` 工具提醒用户先执行架构师角色

### 审查依据

以现有设计文档（`$DESIGN_DIR`）为依据，不依赖开发任务设计文档。

---

## 功能补全模式（--type=completion）

### 执行流程

阶段0 → 阶段3 → 阶段4 → 阶段5 → 阶段6

### 跳过范围

与Bug修复模式相同。

### 前置要求

- 已有功能补全工作包（`$PLANS_DIR/WP-*-complete-*.md`）
- 或用户通过`--scope`直接描述缺失功能
- 若均无，阶段0步骤3会用`question`工具引导用户描述缺失功能

### 阶段0步骤3特殊处理

处理功能范围参数时：
- 若指定 `--scope`：解析功能列表，记录到 `$CHECK_DIR/00-env/scope-definition.md`
- 若未指定 `--scope`：检查 `$PLANS_DIR/WP-*-complete-*.md` 是否存在
  - 存在：记录工作包列表
  - 不存在：用 `question` 工具引导用户描述缺失功能

### 阶段3编码补全

**架构师职责**（若 `$DESIGN_DIR` 为空）：
1. 按 `references/architect-design-generation-flow.md` 生成系统级设计文档
2. 搭建代码框架
3. 功能补全不生成开发任务设计文档（`$PLANS_DIR/DES-*.md`）
4. 补全的功能需与现有设计文档保持一致

**研发角色职责**：
1. 读取功能补全工作包，了解缺失功能、现有实现分析、补全方案
2. 分析现有实现
3. 实施补全
4. 补充测试用例
5. 按 `templates/spec-coding.md` 自检清单逐项确认

**异常处理**：
- 补全功能与现有设计冲突 → 暂停开发，用 `question` 工具向架构师报告
- 架构师未执行 → 用 `question` 工具提醒用户先执行架构师角色

### 审查依据

以需求文档（`$REQUIREMENTS_DIR/`）和设计文档（`$DESIGN_DIR`）为依据，验证补全功能是否完整实现。
