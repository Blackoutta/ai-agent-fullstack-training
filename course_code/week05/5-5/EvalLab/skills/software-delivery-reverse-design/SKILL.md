---
name: software-delivery-reverse-design
description: 软件交付流水线 - 代码反向生成详细设计文档。从已有代码库逆向分析并生成符合标准模板的详细设计说明书（Detailed Design Document）。触发条件：用户说"反向生成详细设计"、"从代码生成设计文档"、"逆向生成设计"、"代码反向设计"、"reverse design"、"生成详细设计说明书"、"/software-delivery-reverse-design"。
---

# 软件交付流水线 - 代码反向生成详细设计

> 从已有代码库出发，逆向分析系统架构、模块结构、接口定义、数据模型、AI核心逻辑等，生成一份完整的详细设计说明书。
> 本skill是 software-delivery 流水线的配套工具，适用于已有代码但缺少设计文档的场景。

---

## 前置依赖

本技能依赖 `software-delivery-base` 技能提供的：
- UI标准模板（`references/ui-standards.md`）
- 目录结构规范与参数体系

执行前请确保目标代码库可访问。

---

## 1. 执行流程总览

```
步骤0: 环境确认 → 步骤0.5: 构建知识图谱（GitNexus + 模块发现 + Pre-scan）
                            ↓
            步骤1: 代码扫描与技术栈识别（增强：基于知识图谱）
                            ↓
            步骤2: 模块与架构分析（增强：基于 modules.json + 图谱） → 步骤3: 接口与数据模型提取（增强：基于 pre_scan）
                            ↓
            步骤4: AI核心逻辑识别（若有） → 步骤5: 生成详细设计文档（增强：8槽并行 + 评审闭环）
                            ↓
            步骤6: 校验与交付（增强：verify_docs.py 自动化校验）
```

### 增强说明

本技能集成了 `code-wiki-builder` 的知识图谱基础设施，相比传统的手动 glob/grep 扫描：
- **模块发现**：双引擎（GitNexus 图聚类 + 文件系统种子扫描），避免遗漏跨目录模块
- **源码理解**：pre_scan.py 批量提取方法体摘要，避免 N×M 轮重复读取
- **并行生成**：8 槽动态调度，完成一个立刻补下一个
- **质量保障**：review→fix→re-review 闭环 + 11 项自动校验

---

## 2. 步骤0：环境确认

### 2.1 代码库路径确认

使用 `question` 工具确认代码库根目录：

```json
{
  "questions": [
    {
      "question": "请确认要分析的代码库路径：\n\n当前工作目录：$PROJECT_ROOT",
      "header": "代码库路径",
      "options": [
        {"label": "使用当前目录", "description": "以当前工作目录作为代码库根目录"},
        {"label": "指定其他路径", "description": "手动输入代码库根目录路径"}
      ]
    }
  ]
}
```

### 2.2 输出路径确认

使用 `question` 工具确认设计文档输出路径：

```json
{
  "questions": [
    {
      "question": "请选择详细设计文档的输出路径：",
      "header": "输出路径",
      "options": [
        {"label": "当前目录（推荐）", "description": "在代码库根目录生成 详细设计说明书.md"},
        {"label": "design/ 目录", "description": "输出到 $PROJECT_ROOT/design/详细设计说明书.md"},
        {"label": "自定义路径", "description": "手动指定输出路径"}
      ]
    }
  ]
}
```

### 2.3 AI应用特征确认

使用 `question` 工具确认项目是否包含AI相关组件（决定是否在功能设计中包含AI相关逻辑说明）：

```json
{
  "questions": [
    {
      "question": "该项目是否包含AI/大模型相关功能？\n\n（如LLM接入、RAG检索、Agent智能体、Prompt工程、向量数据库等）",
      "header": "AI应用特征",
      "options": [
        {"label": "是，包含AI功能", "description": "将在涉及AI的功能设计中分析LLM接入、Prompt工程、RAG、Agent等逻辑"},
        {"label": "否，纯传统应用", "description": "聚焦传统软件功能设计"},
        {"label": "不确定", "description": "自动扫描代码判断"}
      ]
    }
  ]
}
```

---

## 3. 步骤0.5：构建知识图谱

> 本步骤复用 `code-wiki-builder` 的知识图谱基础设施，为后续步骤提供精确的模块发现和源码摘要。

### 3.1 GitNexus 知识图谱构建

> **Windows 兼容性**：PowerShell 默认执行策略可能阻止 npm 脚本。在 Windows 上必须使用 `cmd /c` 包装所有 gitnexus 命令。

```bash
# Windows (PowerShell) — 必须用 cmd /c 包装
cmd /c "gitnexus analyze --skills --skip-git"

# Linux/macOS
gitnexus analyze --skills --skip-git
```

- 如果 `.gitnexus/meta.json` 已存在且 `indexedAt` 是近期时间，可跳过
- 输出：`.gitnexus/` 目录（知识图谱数据库）

**gitnexus 未安装时的降级路径**：
- 跳过 3.1 和 3.2 的图谱查询部分，仅使用文件系统种子扫描
- 直接执行 `python discover_modules.py <项目> --no-seed -m 1 -p 0.5`（仅种子模式）

### 3.2 自动模块发现

> **仓库名（`-r` 参数）**：必须与 `gitnexus analyze` 使用的目录名一致（即代码库根目录的 basename），而非项目名称。例如路径 `<项目根目录>\deliverables\backend` 对应 `-r backend`。

```bash
# Windows
cmd /c "python <code-wiki-builder>/scripts/discover_modules.py <项目> -r <目录basename> -m 2 -p 0.7"

# Linux/macOS
python <code-wiki-builder>/scripts/discover_modules.py <项目> -r <目录basename> -m 2 -p 0.7
```

**参数说明**：
- `-m N`：最小社区数（单体项目用 2-3，微服务用 1）
- `-p 0.X`：合并阈值（0.7 适合大多数项目）
- 输出：`<项目>/docs/modules.json`

**modules.json 结构**：
```json
{
  "modules": [
    {
      "name": "模块名",
      "key": "ModuleKey",
      "community_count": 18,
      "entry_points": ["Method:.../Controller.java:Controller.method#0"],
      "files": [".../Controller.java", ".../Service.java"],
      "has_api": true,
      "has_data": true,
      "is_frontend": false
    }
  ],
  "total_communities": 98,
  "total_modules": 18
}
```

### 3.3 批量源码摘要提取（Pre-scan）

> **注意**：pre_scan 会逐个调用 `gitnexus context` 查询每个 Controller，大项目可能耗时较长（>5分钟）。如果超时，已输出的部分数据仍然可用。

```bash
# Windows
cmd /c "python <code-wiki-builder>/scripts/pre_scan.py <项目> ALL --all -o <项目>/docs/.pre_scan.json"

# Linux/macOS
python <code-wiki-builder>/scripts/pre_scan.py <项目> ALL --all -o <项目>/docs/.pre_scan.json
```

**输出内容**：
- 后端模块：每个 Controller 的方法签名、HTTP 路径、控制流摘要（条件分支/Service调用/异常抛出/返回值）
- 前端模块：组件名、hooks、事件处理器、API 调用、JSX 子组件结构
- Go 模块：func 签名和关键函数体摘要

**STUB 检测**：
- `STUB_CLASS`：类体非空行 < 5（仅 import/注解/大括号）→ 标记为桩类
- `TRIVIAL_METHODS`：所有方法体 ≤ 3 行 → 标记为桩方法
- `PARTIAL_TRIVIAL`：部分方法体 ≤ 3 行 → 标记受影响方法

**用途**：后续步骤的 gen Agent 将 pre_scan 作为快速定位索引，但**必须读源码验证**后才能写文档。pre_scan 不是可信来源。

---

## 4. 步骤1：代码扫描与技术栈识别

### 4.1 项目结构扫描

使用 `glob` 和 `read` 工具扫描以下内容：

1. **构建配置文件**：识别技术栈
   - Java: `pom.xml`, `build.gradle`
   - Python: `pyproject.toml`, `requirements.txt`, `setup.py`
   - Node.js: `package.json`
   - Go: `go.mod`
   - 前端: `vite.config.*`, `webpack.config.*`, `angular.json`, `next.config.*`

2. **框架特征文件**：识别框架
   - Spring Boot: `application.yml`, `application.properties`
   - FastAPI/Flask/Django: `main.py`, `app.py`, `manage.py`
   - Vue/React/Angular: 对应配置文件

3. **目录结构**：识别架构模式
   - `src/main/java/**/controller|service|mapper|entity` → 分层架构
   - `src/main/java/**/module-*` → 模块化架构
   - `packages/`, `apps/`, `services/` → 微服务/monorepo
   - `src/` 下按 feature/domain 划分 → DDD/Clean Architecture

4. **AI特征文件**：识别AI组件
   - `langchain`, `llamaindex`, `dify` 相关依赖
   - `*.prompt`, `prompt_template.*` 文件
   - `embedding`, `vector`, `rag`, `agent` 相关代码
   - 向量数据库客户端（milvus, pinecone, qdrant, chromadb）

### 4.2 知识图谱数据读取（增强）

读取步骤0.5生成的数据，获取自动化分析结果：

1. **读取 `modules.json`**：获取自动发现的模块清单
   - 模块总数、分类（后端/前端/Go 各多少）
   - 每个模块的 entry_points（入口 Controller/方法）
   - 每个模块的 has_api、has_data 标记
   - community_count（模块在知识图谱中的聚类规模）

2. **读取 `.pre_scan.json`**：获取源码摘要
   - 每个 Controller 的方法签名、HTTP 路径、控制流摘要
   - STUB_CLASS / TRIVIAL_METHODS 标记
   - Entity 字段信息

3. **GitNexus 图谱查询**（可选）：
   - `gitnexus query "核心业务概念"` — 查找相关执行流
   - `gitnexus context "ServiceName"` — 获取类的调用者/被调用者

### 4.3 技术栈识别输出

将识别结果记录为内部事实表，包含：
- 编程语言与版本
- 核心框架与版本
- 数据库（关系型 + 向量型）
- 缓存与消息队列
- AI框架与模型
- 部署方式（Dockerfile, docker-compose, k8s manifests）

---

## 5. 步骤2：模块与架构分析

### 5.1 模块识别（增强：基于知识图谱）

使用步骤0.5自动发现的 `modules.json` 替代手动 grep import：

1. **读取 modules.json**：获取自动发现的模块列表
   - 每个模块的 name、key、community_count
   - entry_points（入口 Controller/方法）
   - files（关联的源码文件）
   - has_api、has_data 标记

2. **模块分类**：
   - 后端模块：`is_frontend=false`
   - 前端模块：`is_frontend=true`
   - Go 模块：files 中包含 `.go` 文件

3. **模块间依赖分析**（增强）：
   - 使用 GitNexus `query` 工具分析模块间调用关系
   - 从 modules.json 的 entry_points 推断模块间 API 依赖
   - 从 pre_scan.json 的 Service 调用链推断内部依赖

### 5.2 架构图生成（增强：基于知识图谱）

基于知识图谱生成架构图，而非手动分析：
- 使用 modules.json 的 community_count 作为模块权重
- 使用 entry_points 作为模块间连接关系
- 使用 Mermaid 语法生成系统架构图、模块依赖图、分层架构图

---

## 6. 步骤3：接口与数据模型提取

### 6.1 API接口提取（增强：基于 pre_scan）

从步骤0.5的 `.pre_scan.json` 直接读取已提取的接口信息：

1. **从 pre_scan 读取**：
   - 每个 Controller 的方法签名、HTTP 方法、路径
   - 请求参数（Path/Query/Body）
   - 控制流摘要（条件分支、Service 调用、异常处理）
   - STUB_CLASS / TRIVIAL_METHODS 标记

2. **端点真实性校验**（新增）：
   - 使用 `verify_docs.py` 的端点双向校验逻辑
   - 文档列出但源码中不存在的端点 → 虚构端点
   - 源码中存在但文档未列出的端点 → 遗漏端点
   - 类体 < 5 行非空内容的 Controller → STUB 警告

3. **补充扫描**（若 pre_scan 不完整）：
   - Java: `@RequestMapping`, `@GetMapping`, `@PostMapping`, `@RestController`
   - Python: `@app.get`, `@app.post`, `@router`, `APIRouter`
   - Node.js: `router.get`, `router.post`, `@Controller`, `@Get`, `@Post`
   - Go: `gin.GET`, `gin.POST`, `http.HandleFunc`

4. **接口分组**：按模块/Controller分组，生成接口清单

### 6.2 数据模型提取（增强：基于 pre_scan）

从步骤0.5的 `.pre_scan.json` 读取已提取的 Entity 信息：

1. **从 pre_scan 读取**：
   - Entity 类名、字段名、字段类型
   - 关联关系（外键、OneToMany、ManyToOne）
   - 表名（@Table 注解或命名约定）

2. **补充扫描**（若 pre_scan 不完整）：
   - 扫描 Entity/Model 类定义
   - 扫描 DDL/SQL migration 文件（`*.sql`, Flyway/Liquibase）
   - 扫描 ORM 配置（MyBatis XML, JPA annotations, SQLAlchemy models）
   - 提取表结构：字段名、类型、主键/外键、索引

3. **向量数据库**（若存在）：
   - 扫描 Collection/Index 创建代码
   - 提取向量维度、索引类型、距离度量

4. **缓存设计**：
   - 扫描 Redis key 模式
   - 识别缓存策略（TTL、淘汰策略）

---

## 7. 步骤4：AI核心逻辑识别（若有）

> 仅在步骤0确认项目包含AI功能时执行本步骤。

### 7.1 LLM接入分析

- 扫描 LLM 客户端初始化代码（OpenAI, Anthropic, 通义千问等）
- 提取模型配置（Temperature, Max Tokens, Stop Words）
- 识别模型路由策略（多模型切换逻辑）
- 分析容错与重试机制

### 7.2 Prompt工程分析

- 扫描 Prompt 模板文件和代码中的 prompt 字符串
- 分析系统提示词、用户提示词结构
- 识别动态注入机制（变量替换、上下文拼接）
- 识别 Prompt 管理方式（硬编码/数据库/平台管理）

### 7.3 RAG流程分析

- 扫描文档加载器（PDF, Word, Markdown 解析）
- 识别文本分割策略（chunk_size, chunk_overlap）
- 分析 Embedding 模型选型
- 识别检索策略（向量检索、混合检索、重排序）
- 分析上下文组装逻辑

### 7.4 Agent机制分析

- 识别 Agent 类型（ReAct, Functions, Plan-and-Execute）
- 扫描工具定义（Tool/Function 定义）
- 分析工具调用链路
- 识别记忆与会话管理机制

---

## 8. 步骤5：生成详细设计文档（增强：8槽并行 + 评审闭环）

### 8.1 预分析（启动 gen 前必须执行）

读取 modules.json 和 .pre_scan.json，统计并报告：

1. 模块总数、分类（后端/前端/Go 各多少）
2. 前端模块重叠检测：两个模块共享 ≥70% file 列表时建议合并
3. 后端共享 Controller 检测：files 列表高度重叠时标注「只处理主 Controller」
4. 生成功能清单表格（序号、类型、系统模块、业务功能名称、业务功能概述、对应的代码文件）

### 8.2 文档生成策略（增强：并行调度）

采用 code-wiki-builder 的 **8 槽并行调度模型**：

```
队列排序 → Gen(8槽并行) → 全完成 → Review(8槽并行) → 有 _review.md?
    ↑                                                              ↓(yes)
    └──────────── fix完成，删_review.md ←── Fix Agent ←───────────┘
                                                     ↓(no review issues)
                                              步骤6: verify + 汇总
```

**并发控制**：
- 保持 N 个 gen Agent 槽位常满，完成一个立刻补下一个
- 按 community_count 降序排列功能队列（大模块先启，避免拖尾）
- gen Agent 不设 max_turns，完成后自行退出

### 8.3 gen Agent 生命周期

每个 gen Agent 处理**一个功能/模块**，但输出为章节内容而非独立文件：

```
Agent(name: "gen-<模块key>")
  输入: modules.json 中该模块信息 + pre_scan.json 中该模块摘要 + 详细设计模板
  输出: 该模块的详细设计章节内容（Markdown 字符串）

  生命周期:
    1. 读取 pre_scan 获取方法体摘要
    2. 读取源码验证 Controller 类体和 Entity 字段（pre_scan 不是可信来源）
    3. 按详细设计模板生成：功能说明、功能流程图、设计说明、数据库操作
    4. 返回章节内容给编排器（不直接写文件）
    5. 编排器收集所有章节后，按模块顺序拼装为一份完整的详细设计说明书
    6. 写入 <输出路径>/详细设计说明书.md（单一文件）
```

**重要**：最终产物是**一份完整的详细设计说明书**，不是多个独立文档。并行生成的是章节内容，最终由编排器汇总为单一文件。

### 8.4 评审闭环（新增）

gen 全部完成后，进入评审阶段：

**Phase 2a：全量评审（≤8 reviewer 并行）**
- reviewer 检查：流程图与源码一致性、类方法描述准确性、DB操作完整性、file:行号 溯源
- 有问题写 `_review.md`，无问题直接通过

**Phase 2b：修复**
- fix Agent 读 `_review.md` → 按条修复 → 删除 `_review.md`

**Phase 2c：复评**
- 重复直到全部模块无 `_review.md`，或单模块超 3 轮标记 failed

### 8.5 无声完成检测与恢复

定期扫描（每 2-3 分钟）：
- 有 `_done` 文件 → 该模块完成
- 有 `.md` 文件但无 `_done` → 检查文档完整性，必要时重启 gen
- 无任何产出且超过 15 分钟 → 重启 gen

### 8.6 文档模板

严格按照 `references/detailed-design-template.md` 模板生成，文档结构为：

**顶层结构**：
1. **功能详细设计** — 文档标题与说明
2. **业务功能清单** — 汇总表格（序号、类型[新增/优化]、系统模块、业务功能名称、业务功能概述、对应的代码文件）

**每个功能的详细设计（按类型选择）**：

#### 【新增】功能模板（适用于新增的业务功能）
- **功能说明** — 从业务与客户角度简要说明
- **功能流程图** — 使用流程图/泳道图/时序图表示系统逻辑处理流程
- **设计说明**
  - 设计思路 — 描述功能流程图与代码设计关联关系
  - 类和方法、函数、数据处理任务等 — 使用伪代码或详细文字描述
  - 关联系统 — 列示关联系统
- **界面设计** — 界面设计说明（可省略）
- **安全设计** — 涉及敏感数据、身份鉴别、加密等的安全设计（可省略）
- **异常处理** — 网络异常、数据库异常、接口异常、文件异常、程序异常等处理机制
- **数据库操作** — 数据库表操作清单

#### 【优化】功能模板（适用于现有功能的优化改造）
- **修改说明** — 对修改内容简要说明
- **功能流程图** — 在原流程图上标注修改部分
- **设计说明** — 描述优化设计思路与代码设计关联关系
- **界面设计** — 界面修改说明（可省略）
- **安全设计** — 安全设计修改说明（可省略）
- **异常处理** — 异常处理修改说明
- **数据库操作** — 数据库操作修改清单

### 8.7 生成规则

1. **数据来源标注**：每个功能的"对应的代码文件"列必须标注实际文件路径（类名、方法名），带 `file:行号` 溯源
2. **流程图规范**：根据场景选择流程图、泳道图或时序图，使用 Mermaid 语法
3. **类和方法格式**：
   - 新增功能：标注"新增：XXX类（用途：XXX）"，列出每个方法的入参、入参校验、业务处理逻辑、出参
   - 优化功能：标注"修改：XXX类（用途：XXX）"，列出每个方法的入参修改、入参校验修改、业务处理逻辑修改、出参修改
4. **SQL规范**：对于涉及数据库操作的逻辑，明确操作（增删改查）的表名、字段、条件
5. **数据库操作表格**：每个功能必须包含数据库操作表格，列出涉及的表、操作类型、关联字段
6. **代码引用**：关键实现引用代码片段（不超过20行），标注文件路径
7. **Mermaid participant 规范**：使用源码真实名称（类名/方法名），禁止泛化名（Client/API/Frontend/Backend）

---

## 9. 步骤6：校验与交付（增强：自动化校验）

### 9.1 自动化校验（新增）

复用 `code-wiki-builder` 的 `verify_docs.py` 校验框架，适配详细设计模板：

```bash
python <code-wiki-builder>/scripts/verify_docs.py <项目> --gate
```

**校验项**：
1. **文件存在性**：详细设计说明书.md 是否存在
2. **内容大小**：≥ 500B，防空文档
3. **章节完整性**：是否包含所有已识别模块的章节
3. **章节结构**：是否包含功能说明、功能流程图、设计说明、数据库操作等必要章节
4. **Mermaid 图**：participant 是否使用源码真实名称（禁止泛化名）
5. **file:行号 溯源**：关键描述是否标注了源码位置
6. **数据库操作表**：每个功能是否包含数据库操作表格

**校验不通过时**：
- 读取 `.verify_issues.json` 获取问题清单
- 按模块分组，每个有问题的模块启动一个 fix Agent
- fix Agent 读问题列表 → 逐条修复 → 重新校验
- 重复直到 PASS（或 3 轮后标记失败，写入已知问题）

### 9.2 完整性校验（保留原有检查清单）

检查文档是否覆盖：
- [ ] 业务功能清单已填写完整（所有识别的功能均已列入）
- [ ] 每个功能均包含对应的详细设计章节（新增/优化模板）
- [ ] 每个功能的"对应的代码文件"列已标注实际类名、方法名
- [ ] 每个功能均包含功能流程图（Mermaid格式）
- [ ] 每个功能的设计说明包含设计思路 + 类和方法描述 + 关联系统
- [ ] 每个功能均包含数据库操作表格
- [ ] 涉及安全敏感的功能已填写安全设计
- [ ] 涉及异常场景的功能已填写异常处理

### 9.3 一致性校验

- 文档中的技术栈与实际依赖一致
- 接口定义与代码实现一致
- 数据库字段与实体类定义一致
- 模块划分与代码目录结构一致

### 9.4 交付

1. 输出最终文档（单一文件：详细设计说明书.md）到确认的路径
2. 文档应包含：
   - 系统概述（技术栈、架构图）
   - 业务功能清单（汇总表格）
   - 各模块详细设计章节（按模块顺序排列）
   - 数据库设计汇总
   - 知识图谱统计
3. 生成摘要报告，包含：
   - 知识图谱统计（节点数、边数、聚类数）
   - 自动发现的模块数量
   - 扫描的文件数量
   - 识别的接口数量
   - 识别的数据表数量
   - 识别的功能数量（新增/优化分别统计）
   - 校验通过率

---

## 10. 与流水线集成

本skill可作为 software-delivery 流水线的补充工具使用：

- **场景1：补全设计文档** — 项目已有代码但缺少详细设计文档，使用本skill生成
- **场景2：代码审查前置** — 在阶段4/5审查前，使用本skill生成设计文档作为审查基准
- **场景3：遗留系统改造** — 在启动新迭代前，先用本skill理解现有系统

### 与架构师角色的协作

生成的详细设计文档可作为架构师角色（`software-delivery-architect`）的输入：
- 架构师可基于反向生成的文档进行审查和修正
- 修正后的文档可放入 `$DESIGN_DIR` 作为后续开发的基准

---

## 11. 注意事项

1. **代码质量依赖**：反向生成的设计文档质量取决于代码质量，代码混乱则文档也会反映这一点
2. **隐式逻辑**：代码中的隐式业务逻辑（如魔法数字、条件分支背后的业务含义）可能无法完全提取，需人工补充
3. **动态行为**：运行时行为（如并发处理、缓存命中策略的实际效果）需结合运行时信息分析
4. **文档与代码同步**：建议在代码变更后定期重新生成，保持文档与代码一致
5. **pre_scan 可信度**：pre_scan 不是可信来源——它不做端点真实性校验、不扫描 Entity 完整字段、不做类体判空。gen Agent 必须读源码验证后才能写文档
6. **知识图谱构建耗时**：首次运行 `gitnexus analyze` 可能需要 30-120 秒（取决于代码库大小），后续运行会使用缓存
7. **模块发现参数调优**：`-m`（最小社区数）和 `-p`（合并阈值）需要根据项目特点调整。单体项目用 `-m 2 -p 0.7`，微服务项目用 `-m 1 -p 0.5`
8. **并行生成资源**：8 槽并行需要足够的系统资源。弱模型/内网环境可降到 6 槽
9. **Windows 环境**：PowerShell 默认执行策略会阻止 npm/npx 命令。所有 gitnexus 和 npm 相关命令必须通过 `cmd /c` 包装执行。Python 脚本也建议用 `cmd /c python ...` 调用以避免编码问题
10. **gitnexus 依赖**：知识图谱构建依赖 gitnexus CLI。如未安装，先执行 `npm install -g gitnexus`。若无法安装，可使用 `--no-seed` 模式仅依赖文件系统种子扫描
11. **仓库名（-r 参数）**：必须与 gitnexus analyze 使用的目录 basename 一致，而非项目 artifactId。例如 `<项目路径>\backend` 对应 `-r backend`
12. **pre_scan 超时**：大项目（>100个 Controller）的 pre_scan 可能超过 5 分钟超时限制。已输出的部分数据（.pre_scan.json）仍然可用，只需补充读取未覆盖模块的源码
13. **单一文档输出**：最终产物是一份完整的详细设计说明书（单一 .md 文件），不是每个模块一个文件。并行生成的各模块章节由编排器汇总为单一文档。
