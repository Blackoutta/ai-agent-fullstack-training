# UI 标准化规范

> 本文件定义 software-delivery skill 的标准化界面规范，确保每次运行输出一致。

## 1. question 工具标准模板

> **模板逐字使用规则（强制）**：
> 1. 调用 question 工具时，`question` / `header` / 每个选项的 `label` / `description` / 选项顺序 / `multiple` 标志必须**逐字复制**本节模板，禁止改写措辞、增删选项、调整顺序、合并或拆分问题。
> 2. 唯一例外：标注为"动态"的模板（如 §1.6 开发任务选择），选项内容按实际文件列表填充，但格式结构不变。
> 3. 每次调用 question 前，先回到本文件复制对应模板原文，不得凭记忆重写。
> 4. question 调用前后的说明文字（如"步骤0：路径确认"）也应保持一致的格式，参照 §9 参考示例。

### 1.1 路径确认模板（两步式）

**第1步：路径模式选择（必答）**

```json
{
  "questions": [
    {
      "question": "请选择路径配置模式：\n\n默认路径预览（工程根目录：$PROJECT_ROOT）：\n  - 交付产物：$PROJECT_ROOT\\deliverables\\\n  - 审查报告：$PROJECT_ROOT\\check\\\n  - 工作包：  $PROJECT_ROOT\\plans\\\n  - 需求文档：$PROJECT_ROOT\\requirements\\\n  - 中间件：  $PROJECT_ROOT\\config\\\n  - 设计文档：$PROJECT_ROOT\\design\\",
      "header": "路径配置模式",
      "options": [
        {"label": "全部使用默认路径（推荐）", "description": "使用上述 6 个默认路径"},
        {"label": "自定义基础路径", "description": "指定一个基础目录，所有输出目录自动放在该目录下"},
        {"label": "逐个配置", "description": "分别确认每个目录的路径"}
      ]
    }
  ]
}
```

**第2步（仅"自定义基础路径"时触发）：输入基础路径**

```json
{
  "questions": [
    {
      "question": "请输入基础路径（所有目录将放在该路径下，也可自行输入）：\n\n路径预览：\n  - $PROJECT_ROOT\\output\\deliverables\\\n  - $PROJECT_ROOT\\output\\check\\\n  - $PROJECT_ROOT\\output\\plans\\",
      "header": "基础路径",
      "options": [
        {"label": "output/", "description": "$PROJECT_ROOT\\output\\"},
        {"label": "build/", "description": "$PROJECT_ROOT\\build\\"},
        {"label": ".delivery/", "description": "$PROJECT_ROOT\\.delivery\\"}
      ]
    }
  ]
}
```

用户选择或输入基础路径后，自动推导：
- 交付产物目录 → `<base>/deliverables/`
- 审查报告目录 → `<base>/check/`
- 工作包目录 → `<base>/plans/`
- 需求文档目录 → `<base>/requirements/`
- 中间件配置目录 → `<base>/config/`
- 设计文档目录 → `<base>/design/`

**第2步（仅"逐个配置"时触发）：逐个确认各目录**

```json
{
  "questions": [
    {
      "question": "交付产物输出目录：",
      "header": "交付产物目录",
      "options": [{"label": "deliverables/", "description": "$PROJECT_ROOT\\deliverables\\"}]
    },
    {
      "question": "审查报告输出目录：",
      "header": "审查报告目录",
      "options": [{"label": "check/", "description": "$PROJECT_ROOT\\check\\"}]
    },
    {
      "question": "工作包/开发任务计划输出目录：",
      "header": "工作包目录",
      "options": [{"label": "plans/", "description": "$PROJECT_ROOT\\plans\\"}]
    },
    {
      "question": "需求文档输入目录：",
      "header": "需求文档目录",
      "options": [{"label": "requirements/", "description": "$PROJECT_ROOT\\requirements\\"}]
    },
    {
      "question": "中间件配置输入目录：",
      "header": "中间件配置目录",
      "options": [{"label": "config/", "description": "$PROJECT_ROOT\\config\\"}]
    },
    {
      "question": "系统级设计文档目录：",
      "header": "设计文档目录",
      "options": [{"label": "design/", "description": "$PROJECT_ROOT\\design\\"}]
    }
  ]
}
```

### 1.2 架构类型选择模板

```json
{
  "questions": [
    {
      "question": "请选择架构类型：",
      "header": "架构类型",
      "options": [
        {"label": "单体架构（推荐）", "description": "所有模块在同一项目中，适合中小型项目"},
        {"label": "微服务架构", "description": "多服务独立部署，适合大型项目和团队"}
      ]
    }
  ]
}
```

### 1.3 微服务技术栈选择模板

**一键选择模式（推荐）**：

```json
{
  "questions": [
    {
      "question": "请选择微服务技术栈配置方式：",
      "header": "技术栈配置方式",
      "options": [
        {"label": "Spring Cloud Tencent（推荐）", "description": "腾讯开源一站式微服务方案，基于 PolarisMesh 北极星，内置服务注册/发现、配置中心、限流、熔断、路由、负载均衡，开箱即用"},
        {"label": "Spring Cloud Alibaba", "description": "阿里开源方案：Nacos + Spring Cloud Gateway + Nacos Config + OpenFeign"},
        {"label": "逐个选择", "description": "分别选择注册中心、网关、配置中心、服务间通信"}
      ]
    }
  ]
}
```

**Spring Cloud Tencent 技术栈详情**（用户选择时自动应用）：

> **版本兼容性（重要）**：Spring Cloud Tencent `2.0.0.0-2021.0.9` 对应 Spring Boot 2.x（JDK 8/11）。如需 Spring Boot 3.x，需使用 `2.0.0.0-2022.0.x` 系列版本。选择后**必须询问用户确认 JDK 和 Spring Boot 版本**。

| 组件 | 技术选型 | 说明 |
|------|---------|------|
| 核心框架 | Spring Cloud Tencent | 基于 PolarisMesh 北极星，一站式微服务解决方案 |
| JDK 版本 | JDK 8/11 | 由 Spring Cloud Tencent 版本决定，需与用户确认 |
| 服务注册与发现 | PolarisMesh（北极星） | 腾讯开源的服务发现与治理平台 |
| 配置中心 | PolarisMesh（北极星） | 统一配置管理，支持动态刷新 |
| 服务限流 | 内置限流 | 支持匀速排队限流 |
| 服务熔断 | 内置熔断 | 故障自动熔断 |
| 服务路由 | 内置路由 | 元数据路由、就近路由、规则路由 |
| 负载均衡 | 内置负载均衡 | 多种负载均衡策略 |
| 服务间通信 | RestTemplate / OpenFeign | 声明式 HTTP 客户端 |
| 监控上报 | 内置监控 | 支持 Prometheus 等监控系统 |

**Maven 依赖配置**：

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.tencent.cloud</groupId>
            <artifactId>spring-cloud-tencent-dependencies</artifactId>
            <version>2.0.0.0-2021.0.9</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>com.tencent.cloud</groupId>
        <artifactId>spring-cloud-starter-tencent-all</artifactId>
    </dependency>
    <!-- 需要通过 OpenFeign 调用下游服务时添加 -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-openfeign</artifactId>
    </dependency>
</dependencies>
```

**application.yml 配置**：

```yaml
spring:
  application:
    name: your-service-name
  config:
    import: "optional:polaris"  # Spring Boot 2.4+ 配置导入方式
  cloud:
    polaris:
      address: grpc://127.0.0.1:8091  # PolarisMesh 默认地址，需与用户确认
      namespace: default
```

> **PolarisMesh 地址**：默认为 `grpc://127.0.0.1:8091`（本地开发环境）。选择微服务架构后**必须询问用户确认 PolarisMesh 地址**（本地/腾讯云托管）。

**逐个选择模式**（用户选择"逐个选择"时显示）：

**逐个选择模式**（用户选择"逐个选择"时显示）：

```json
{
  "questions": [
    {
      "question": "请选择服务注册中心：",
      "header": "服务注册中心",
      "options": [
        {"label": "Nacos（推荐）", "description": "阿里巴巴开源，支持服务注册/发现、配置管理"},
        {"label": "Eureka", "description": "Netflix 开源，Spring Cloud 原生支持"},
        {"label": "Consul", "description": "HashiCorp 开源，支持多数据中心"},
        {"label": "ZooKeeper", "description": "Apache 开源，强一致性"}
      ]
    },
    {
      "question": "请选择 API 网关：",
      "header": "API 网关",
      "options": [
        {"label": "Spring Cloud Gateway（推荐）", "description": "Spring 官方推荐，响应式编程模型"},
        {"label": "Zuul", "description": "Netflix 开源，已停止维护"},
        {"label": "Kong", "description": "基于 Nginx，高性能"}
      ]
    },
    {
      "question": "请选择配置中心：",
      "header": "配置中心",
      "options": [
        {"label": "Nacos Config（推荐）", "description": "与注册中心统一，降低复杂度"},
        {"label": "Spring Cloud Config", "description": "Spring 官方方案"},
        {"label": "Apollo", "description": "携程开源，功能完善"}
      ]
    },
    {
      "question": "请选择服务间通信方式：",
      "header": "服务间通信",
      "options": [
        {"label": "OpenFeign（推荐）", "description": "声明式 HTTP 客户端，简单易用"},
        {"label": "RestTemplate", "description": "传统方式，灵活但繁琐"},
        {"label": "gRPC", "description": "高性能，适合内部服务调用"},
        {"label": "消息队列", "description": "异步解耦，适合事件驱动"}
      ]
    }
  ]
}
```

### 1.4 清理确认模板

```json
{
  "questions": [
    {
      "question": "检测到旧产物，请选择要清理的目录：",
      "header": "清理旧产物",
      "options": [
        {"label": "backend/", "description": "后端代码目录"},
        {"label": "frontend/", "description": "前端代码目录"},
        {"label": "sql/", "description": "数据库脚本目录"},
        {"label": "ops/", "description": "运维配置目录"},
        {"label": "check/", "description": "审查报告目录"},
        {"label": "plans/", "description": "工作包/开发任务计划目录"},
        {"label": "跳过清理", "description": "保留所有旧产物"}
      ],
      "multiple": true
    }
  ]
}
```

### 1.5 敏感目录清理二次确认模板

```json
{
  "questions": [
    {
      "question": "⚠️ 清理 design/ 目录将删除用户提供的设计文档，清理后需重新提供。确认清理？",
      "header": "敏感目录清理确认",
      "options": [
        {"label": "确认清理", "description": "删除 design/ 目录下的文件"},
        {"label": "跳过", "description": "保留 design/ 目录"}
      ]
    }
  ]
}
```

### 1.6 开发任务选择模板

```json
{
  "questions": [
    {
      "question": "请选择开发任务编号：",
      "header": "开发任务选择",
      "options": [
        {"label": "TASK-001", "description": "核心功能开发任务"},
        {"label": "TASK-002", "description": "功能增强开发任务"},
        {"label": "新建开发任务", "description": "创建新的开发任务计划"}
      ]
    }
  ]
}
```

### 1.7 角色选择模板

```json
{
  "questions": [
    {
      "question": "请选择执行角色：",
      "header": "角色选择",
      "options": [
        {"label": "PM", "description": "负责需求拆分和开发任务规划"},
        {"label": "架构师", "description": "主导设计和审查"},
        {"label": "后端开发", "description": "实现后端业务代码"},
        {"label": "前端开发", "description": "实现前端页面和组件"},
        {"label": "移动端开发", "description": "实现移动端应用"},
        {"label": "数据库工程师", "description": "设计和优化数据库"},
        {"label": "测试", "description": "编写集成测试、执行测试"},
        {"label": "运维", "description": "生成CI/CD、容器化、监控配置"}
      ]
    }
  ]
}
```

### 1.8 交付确认模板

```json
{
  "questions": [
    {
      "question": "交付清单确认：",
      "header": "交付确认",
      "options": [
        {"label": "确认交付", "description": "所有门禁通过，交付完成"},
        {"label": "查看遗留项", "description": "查看未通过的门禁和遗留问题"},
        {"label": "取消", "description": "暂不交付"}
      ]
    }
  ]
}
```

### 1.9 质量门禁放行确认模板

```json
{
  "questions": [
    {
      "question": "⚠️ 软门禁未达标，是否确认放行？",
      "header": "门禁放行确认",
      "options": [
        {"label": "确认放行", "description": "接受遗留风险，标记为遗留项"},
        {"label": "继续修正", "description": "回阶段3修正后重审"},
        {"label": "取消", "description": "暂不处理"}
      ]
    }
  ]
}
```

### 1.10 断点续做选择模板

```json
{
  "questions": [
    {
      "question": "检测到未完成的流水线，是否继续？",
      "header": "断点续做",
      "options": [
        {"label": "从断点继续", "description": "从上次中断的阶段继续执行"},
        {"label": "重新开始", "description": "清除旧状态，从阶段0重新开始"}
      ]
    }
  ]
}
```

### 1.11 开发任务计划模式选择模板

```json
{
  "questions": [
    {
      "question": "请选择开发任务计划制定方式：",
      "header": "开发任务计划模式",
      "options": [
        {"label": "AI推荐一键执行（推荐）", "description": "AI根据工作包自动生成全部开发任务计划，确认后一键落盘"},
        {"label": "AI推荐部分执行", "description": "AI生成推荐方案，您选择要执行的部分"},
        {"label": "手动输入", "description": "您在终端手动描述开发任务计划内容，AI格式化后落盘"}
      ]
    }
  ]
}
```

**AI推荐方案展示格式**（模式B/C使用）：

```
📋 AI推荐开发任务计划
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
任务编号  任务名称              工作包                预估工时  优先级
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK-001  系统基础设施          WP-008, WP-009        6天      高
TASK-002  任务管理核心          WP-004, WP-002, WP-003 9天      高
TASK-003  报表与驾驶舱          WP-005, WP-006, WP-001 8天      中
TASK-004  系统管理与辅助功能    WP-010, WP-011, WP-012, WP-007 7天 中
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总计：4个任务，30天工时
```

**模式C选择确认模板**：

```json
{
  "questions": [
    {
      "question": "请选择要执行的开发任务计划（可多选）：",
      "header": "开发任务计划选择",
      "options": [
        {"label": "TASK-001 系统基础设施", "description": "WP-008, WP-009 | 6天 | 高优先级"},
        {"label": "TASK-002 任务管理核心", "description": "WP-004, WP-002, WP-003 | 9天 | 高优先级"},
        {"label": "TASK-003 报表与驾驶舱", "description": "WP-005, WP-006, WP-001 | 8天 | 中优先级"},
        {"label": "TASK-004 系统管理与辅助功能", "description": "WP-010, WP-011, WP-012, WP-007 | 7天 | 中优先级"}
      ],
      "multiple": true
    }
  ]
}
```

### 1.12 工作包勾选模板（手动输入模式专用）（动态）

> 为每个TASK调用一次，PM从WP列表中勾选该TASK包含的工作包。
> **动态**：WP选项需根据 `$PLANS_DIR/WP-*.md` 的实际文件列表填充，下方为示例值。

```json
{
  "questions": [
    {
      "question": "请为 {TASK编号} {TASK名称} 选择包含的工作包（可多选）：",
      "header": "工作包勾选",
      "options": [
        {"label": "WP-001 驾驶舱仪表盘", "description": "7个统计图表 + 快捷任务入口 | 高优先级"},
        {"label": "WP-002 任务管理-核心", "description": "任务创建发布、任务处理流转 | 高优先级"},
        {"label": "WP-003 任务管理-确认与催办", "description": "任务确认完结、催办强制完成 | 高优先级"},
        {"label": "WP-004 模板维护", "description": "模板CRUD、附件上传、协同编辑 | 中优先级"},
        {"label": "WP-005 统计报表", "description": "任务统计报表、科室及时率报表 | 中优先级"},
        {"label": "WP-006 考核指标报表", "description": "开发考核、需求主管考核指标 | 中优先级"},
        {"label": "WP-007 RPA邮件解析", "description": "RPA邮件解析转任务草稿 | 中优先级"},
        {"label": "WP-008 系统管理-组织用户", "description": "组织架构管理、用户管理 | 高优先级"},
        {"label": "WP-009 系统管理-权限参数", "description": "角色权限、部门设置、参数管理 | 高优先级"},
        {"label": "WP-010 日志审计", "description": "登录和关键操作记录 | 中优先级"},
        {"label": "WP-011 批处理调度", "description": "批处理任务管理 | 中优先级"},
        {"label": "WP-012 通知与代理", "description": "通知管理、常规代理配置 | 中优先级"}
      ],
      "multiple": true
    }
  ]
}
```

**使用规则**：
1. PM输入N个TASK，则调用N次此模板
2. 已被分配的WP仍可在其他TASK中被选（支持一个WP拆分到多个TASK）
3. 未被任何TASK选中的WP标记为"未分配"，提醒PM确认
4. 所有TASK勾选完成后，展示汇总表让PM最终确认

### 1.13 单元测试选择模板（动态）

> **动态**：`{TASK编号}` 和 `{角色}` 根据实际进度填充。

```json
{
  "questions": [
    {
      "question": "TASK-{编号} {角色}业务代码已完成。是否需要编写单元测试？",
      "header": "单元测试选择",
      "options": [
        {"label": "是，编写单元测试", "description": "编写单元测试后再进行设计符合性检查"},
        {"label": "否，跳过单元测试", "description": "直接进行设计符合性检查"}
      ]
    }
  ]
}
```

### 1.14 迭代完成角色切换模板（动态）

> **动态**：`{TASK编号}` 和 `{下一TASK编号}` 根据实际进度填充。

**后端完成后的切换询问**：

```json
{
  "questions": [
    {
      "question": "TASK-{编号} 后端已完成，设计符合性检查和代码质量检查均已通过。请选择下一步：",
      "header": "迭代完成下一步",
      "options": [
        {"label": "切换到前端开发（推荐）", "description": "实现 TASK-{编号} 的前端页面和组件"},
        {"label": "继续下一个TASK后端", "description": "实现 TASK-{下一编号} 的后端代码"},
        {"label": "进入最终审查", "description": "进入阶段6测试覆盖率+阶段7交付"},
        {"label": "暂停", "description": "暂停流水线，稍后继续"}
      ]
    }
  ]
}
```

**前端完成后的切换询问**：

```json
{
  "questions": [
    {
      "question": "TASK-{编号} 前端已完成，设计符合性检查和代码质量检查均已通过。请选择下一步：",
      "header": "迭代完成下一步",
      "options": [
        {"label": "切换到后端开发（推荐）", "description": "实现 TASK-{下一编号} 的后端代码"},
        {"label": "继续下一个TASK前端", "description": "实现 TASK-{下一编号} 的前端页面"},
        {"label": "进入最终审查", "description": "进入阶段6测试覆盖率+阶段7交付"},
        {"label": "暂停", "description": "暂停流水线，稍后继续"}
      ]
    }
  ]
}
```

### 1.15 TASK完成后下一步选择模板（动态）

> **动态**：`{TASK编号}`、`{后端/前端}`、`{下一TASK编号}` 根据实际进度填充。
> **选项动态排除规则**：根据用户选择，排除已完成的选项（详见下方说明）。

```json
{
  "questions": [
    {
      "question": "TASK-{编号} {后端/前端}业务代码已完成。请选择下一步：",
      "header": "TASK完成下一步",
      "options": [
        {"label": "编写单元测试（推荐）", "description": "为各Service层编写单元测试，目标覆盖率≥80%"},
        {"label": "设计符合性审查", "description": "检查代码与设计文档的一致性"},
        {"label": "代码质量审查", "description": "按阿里巴巴Java手册规范审查"},
        {"label": "继续下一个TASK", "description": "跳过审查，直接进入 TASK-{下一编号} 开发"},
        {"label": "进入最终审查", "description": "所有TASK已完成，进入阶段6测试覆盖率+阶段7交付"},
        {"label": "暂停流水线", "description": "暂停当前进度，稍后继续"}
      ]
    }
  ]
}
```

**选项执行逻辑**：

| 选项 | 执行动作 | 完成后展示 |
|------|----------|-----------|
| 编写单元测试 | 执行单元测试 → 自动执行设计符合性审查 → 自动执行代码质量审查 | 排除「编写单元测试」「设计符合性审查」「代码质量审查」 |
| 设计符合性审查 | 执行设计符合性审查 → 自动执行代码质量审查 | 排除「编写单元测试」「设计符合性审查」「代码质量审查」 |
| 代码质量审查 | 仅执行代码质量审查 | 排除「编写单元测试」「设计符合性审查」「代码质量审查」 |
| 继续下一个TASK | **允许跳过审查**，直接进入下一个TASK | 进入下一个TASK |
| 进入最终审查 | **允许跳过审查**，直接进入阶段6+7 | 进入最终审查 |
| 暂停流水线 | 保存当前状态 | 流水线暂停 |

**选项动态排除规则**：
- 选择「编写单元测试」后 → 移除「编写单元测试」选项
- 选择「设计符合性审查」后 → 移除「设计符合性审查」和「编写单元测试」选项
- 选择「代码质量审查」后 → 移除「代码质量审查」「设计符合性审查」「编写单元测试」选项
- 所有审查完成后 → 仅保留「继续下一个TASK」「进入最终审查」「暂停流水线」

## 2. 状态展示统一格式

> **版式逐字使用规则（强制）**：
> 1. 分隔线固定为 40 个 `━` 字符（U+2501 全角横线），不多不少。
> 2. 状态展示必须严格套用本节框线格式（`━━━` 分隔线、固定 emoji 集合 ✅⏳⏸️⏭️❌⚠️、列顺序、缩进），仅替换变量值（角色名、开发任务编号、数字、状态、文件名），不得重新设计版式、更换符号、调整列或增删行结构。
> 3. 每次输出状态展示前，必须重新读取本文件对应小节，不得凭记忆输出。

### 2.1 阶段进度展示

> **角色过滤规则（强制）**：流水线状态**只显示当前角色需要执行的阶段**，不显示其他角色的阶段。根据以下映射表确定显示哪些阶段：

| 角色 | 显示阶段 |
|------|---------|
| PM | 0, 1, 2 |
| 架构师 | 0, 2, 3, 4, 5, 6 |
| 后端开发 | 0, 3, 4, 5, 6 |
| 前端开发 | 0, 3, 4, 5, 6 |
| 移动端开发 | 0, 3, 4, 5, 6 |
| 数据库工程师 | 0, 3, 4, 5 |
| 测试 | 0, 6 |
| 运维 | 0, 3, 4, 5, 7 |

**PM 角色示例**：

```
📋 流水线状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
阶段0 - 环境准备       ✅ 已完成
阶段1 - 需求拆分       ⏳ 进行中
阶段2 - 开发任务计划    ⏸️ 待执行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：PM
架构类型：待确认
```

**后端开发角色示例**：

```
📋 流水线状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
阶段0 - 环境准备       ✅ 已完成
阶段3 - 编码实现       ⏳ 进行中
阶段4 - 设计符合性审查  ⏸️ 待执行
阶段5 - 代码质量审查    ⏸️ 待执行
阶段6 - 测试与覆盖率    ⏸️ 待执行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：后端开发
当前开发任务：TASK-001
架构类型：单体架构
```

**运维角色示例**：

```
📋 流水线状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
阶段0 - 环境准备       ✅ 已完成
阶段3 - 编码实现       ⏸️ 待执行
阶段4 - 设计符合性审查  ⏸️ 待执行
阶段5 - 代码质量审查    ⏸️ 待执行
阶段7 - 交付汇总       ⏸️ 待执行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：运维
架构类型：单体架构
```

**状态标记说明**：
- ✅ 已完成
- ⏳ 进行中
- ⏸️ 待执行
- ⏭️ 已跳过（bugfix/completion 模式）
- ❌ 失败
- ⚠️ 有遗留项

### 2.2 前置条件检查展示

```
✅ 前置条件检查通过
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ 架构类型已确认：单体架构
✓ 设计文档已生成：design/ 目录（7个文件）
✓ 代码框架已搭建：backend/, frontend/
✓ 中间件配置已读取：config/middleware.local.yaml
✓ 关键指标已登记：check/00-env/key-metrics.md
✓ 功能范围已定义：check/00-env/scope-definition.md
✓ 开发任务范围已确定：TASK-001
✓ 任务已登记：T1, T2, T3, T4
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**检查项状态**：
- ✓ 通过
- ❌ 不通过
- ⏭️ 不适用

### 2.3 质量门禁展示

```
📊 质量门禁状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
门禁类型          阈值      实际      状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
设计符合性       100%      100%      ✅ 通过
代码规范         0 B/C     0 B/C     ✅ 通过
行覆盖率         ≥80%      85%       ✅ 通过
分支覆盖率       ≥70%      72%       ✅ 通过
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
综合结论：✅ 全部通过
```

**门禁状态**：
- ✅ 通过
- ❌ 未通过
- ⚠️ 用户确认放行

### 2.4 关键指标登记展示

```
📈 关键指标登记
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
指标            数量      统计时间
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
数据库表数量    15        2026-07-21
API 接口数量    42        2026-07-21
测试类数量      28        2026-07-21
测试用例数      156       2026-07-21
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2.5 流程检查清单展示

```
✅ 流程检查清单
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
检查项                    状态      说明
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
输出路径已确认            ✅        6个路径已确认
旧产物已清理              ⏭️        用户选择跳过
目录已初始化              ✅        5个目录已初始化
输入文档已读取            ✅        4个文档已读取
中间件配置已读取          ✅        middleware.local.yaml
关键指标已登记            ✅        4项指标已登记
功能范围已定义            ✅        3个功能点
架构类型已确认            ✅        单体架构
任务已登记                ✅        4个任务
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
结论：✅ 所有必须项通过，可进入下一阶段
```

---

## 3. 角色切换界面规范

### 3.1 角色确认展示

```
👤 角色确认
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：后端开发
执行阶段：阶段0 → 阶段3 → 阶段4 → 阶段5 → 阶段6
负责工作包：
  - WP-001-用户登录.md
  - WP-002-任务CRUD.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3.2 角色切换提示

```
🔄 角色切换
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
从：后端开发
到：前端开发

即将执行：
  - 阶段3：前端页面/组件开发
  - 阶段4：设计符合性审查
  - 阶段5：代码质量审查
  - 阶段6：测试与覆盖率
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3.3 架构师角色特殊展示

```
🏗️ 架构师角色确认
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

## 4. 错误处理界面规范

### 4.1 前置条件不满足

```
❌ 前置条件不满足
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
缺少条件：架构类型未确认
当前状态：$CHECK_DIR/00-env/architecture-decision.md 不存在

建议操作：
  1. 请先执行架构师角色
  2. 完成阶段0步骤4（架构类型确认）
  3. 确认后再执行当前角色

相关文件：
  - check/00-env/architecture-decision.md（待生成）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4.2 质量门禁失败

```
⚠️ 质量门禁未通过
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
未通过门禁：代码规范
问题数量：2 个 Blocker, 1 个 Critical

问题明细：
  [Blocker] Q-001: 硬编码密码 - UserService.java:45
  [Blocker] Q-002: SQL注入风险 - OrderMapper.java:78
  [Critical] Q-003: 未处理异常 - PaymentService.java:123

建议操作：
  1. 回阶段3修正上述问题
  2. 修正后重审阶段4+5
  3. 当前轮次：第 2 轮（最大 3 轮）

修正后请重新执行：/software-delivery --role=后端开发 --task=1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4.3 设计文档缺失

```
❌ 设计文档缺失
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
缺少文件：design/ 目录下无实际设计文档
当前状态：仅有模板文件（_ 前缀）和 README.md

建议操作：
  1. 请先执行架构师角色
  2. 完成阶段2/3（设计文档生成）
  3. 确保 design/ 目录包含以下文件：
     - 01-tech-stack.md
     - 02-system-architecture.md
     - 03-database-design.md
     - 04-api-design.md

或提供用户设计文档到 design/ 目录后重新执行。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4.4 中间件配置缺失

```
⚠️ 中间件配置缺失
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
缺少文件：config/middleware.local.yaml 和 middleware.example.yaml

建议操作：
  1. 复制 middleware.example.yaml 为 middleware.local.yaml
  2. 填入实际的数据库、Redis 等连接信息
  3. 重新执行当前角色

配置文件位置：config/middleware.example.yaml
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4.5 轮次耗尽

```
⚠️ 重试轮次耗尽
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
阶段：阶段5 - 代码质量审查
当前轮次：第 3 轮（已达上限）
剩余问题：1 个 Critical

请决策：
  1. 继续修正（重置轮次计数）
  2. 接受遗留（标记为风险项）

若选择接受遗留，将在交付汇总中记录为"已知遗留项"。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 5. 输出报告标准格式

### 5.1 阶段开始提示

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 阶段 X：阶段名称
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
执行角色：XXX
执行步骤：步骤1 → 步骤2 → 步骤3
预计产物：文件列表
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5.2 阶段完成提示

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 阶段 X 完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
完成时间：YYYY-MM-DD HH:MM:SS
产物清单：
  - 文件1（大小）
  - 文件2（大小）
  - 文件3（大小）

下一步：阶段 X+1 - 阶段名称
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5.3 子 agent 派发提示

```
🤖 派发子 agent
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
任务：生成 01-tech-stack.md
超时：120 秒
读取文件：
  - design/_design-context.md
  - design/_module-split.md
  - design/_technical-decisions.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5.4 子 agent 返回提示

```
✅ 子 agent 完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
任务：生成 01-tech-stack.md
结果：成功
产物：design/01-tech-stack.md（12.5 KB）
待确认项：2 项
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 5.5 文本输出格式规范

AI 在调用工具前后的文本输出应遵循以下格式：

1. **步骤引导**：使用 `**步骤N：步骤名称**` 格式，后跟说明文字
2. **状态展示标题**：使用 `**emoji 标题**` 格式（如 `**👤 角色确认**`、`**📋 流水线状态**`）
3. **列表展示**：使用 `- item` 格式，缩进一致
4. **重点标注**：使用 `**粗体**` 标注关键信息（如路径、角色名、阶段名）
5. **段落间距**：状态展示框前后各空一行（框线行本身不额外空行）
6. **目录/路径列表**：使用 `` `路径` `` 格式标注路径，后跟 `→` 箭头和说明

**示例**：

```
已确认使用默认路径：
- `$PROJECT_ROOT\deliverables\` → 交付产物输出目录
- `$PROJECT_ROOT\check\` → 审查报告输出目录
- `$PROJECT_ROOT\plans\` → 工作包/开发任务计划输出目录

**步骤1：角色确认**
```

---

## 6. 输出模板强制使用规则

### 6.1 审查报告模板

| 阶段 | 必须使用的模板 | 生成角色 |
|------|--------------|---------|
| 阶段4 | `templates/design-conformance-review.md` | 架构师（主审） |
| 阶段5 | `templates/code-quality-review.md` | 架构师（主审） |
| 阶段6 | `templates/test-coverage-report.md` | 架构师（汇总） |
| 阶段7 | `templates/delivery-summary.md` | 运维角色（汇总） |

### 6.2 工作包模板

| 类型 | 必须使用的模板 | 生成角色 |
|------|--------------|---------|
| 功能开发 | `plans/work-package-template.md` | PM |
| Bug修复 | `plans/work-package-bugfix-template.md` | PM |
| 功能补全 | `plans/work-package-completion-template.md` | PM |
| 开发任务计划 | `plans/task-template.md` | PM |
| 开发任务设计 | `plans/des-template.md` | 架构师 |

### 6.3 设计文档模板

| 文件 | 模板位置 | 生成角色 |
|------|---------|---------|
| `_design-context.md` | `design/_design-context.md`（模板） | 架构师 |
| `_module-split.md` | `design/_module-split.md`（模板） | 架构师 |
| `_technical-decisions.md` | `design/_technical-decisions.md`（模板） | 架构师 |
| `_application-architecture.md` | `design/_application-architecture.md`（模板） | 架构师 |

### 6.4 变量替换规则

所有模板中的变量必须替换为实际路径：

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `$PROJECT_ROOT` | 工程根目录绝对路径 | `$PROJECT_ROOT` |
| `$DELIVER_DIR` | 交付产物输出目录 | `$PROJECT_ROOT/deliverables` |
| `$CHECK_DIR` | 审查报告输出目录 | `$PROJECT_ROOT/check` |
| `$PLANS_DIR` | 工作包/开发任务计划输出目录 | `$PROJECT_ROOT/plans` |
| `$REQUIREMENTS_DIR` | 需求文档输入目录 | `$PROJECT_ROOT/requirements` |
| `$CONFIG_DIR` | 中间件配置输入目录 | `$PROJECT_ROOT/config` |
| `$DESIGN_DIR` | 系统级设计文档目录 | `$PROJECT_ROOT/design` |

**替换规则**：
1. 写入文件前，将所有变量替换为实际绝对路径
2. 变量使用 `$VAR_NAME` 格式（如 `$DELIVER_DIR`），与模板中的实际写法一致
3. 如果变量未定义，使用默认值并提示用户确认
4. `$PROJECT_ROOT` 在 question 模板中用于显示完整路径，agent 调用前必须替换

---

## 7. 渐进式披露标准化

### 7.1 加载时机明确化

| 层级 | 内容 | 加载时机 | Token预算 |
|------|------|---------|----------|
| 第1层 | 元数据（name + description） | 始终加载 | ~300 |
| 第2层 | SKILL.md 正文 | 用户显式调用 `/software-delivery` | ~2000 |
| 第3层 | references/ 目录 | 执行到对应阶段时 | 按需 |

### 7.2 加载顺序标准化

当多个文件同时需要时，按以下优先级加载：

1. **当前阶段的 reference 文件**
   - 阶段3：`dev-operation-guide.md`、`architect-responsibilities.md`
   - 阶段4/5/6：`design-compliance.md`
   - 架构师且 $DESIGN_DIR 为空：`architect-design-generation-flow.md`

2. **当前角色的 reference 文件**
   - 架构师：`architect-responsibilities.md`、`architect-design-generation-flow.md`
   - 研发角色：`dev-operation-guide.md`
   - PM：无额外 reference

3. **通用 reference 文件**
   - `trigger-examples.md`：用户询问触发方式时
   - `bugfix-completion-flow.md`：用户询问 bugfix/completion 流程时
   - `architect-dev-flow.md`：用户询问协作流程时

### 7.3 加载失败处理

如果 reference 文件加载失败：
1. 记录失败原因
2. 使用 SKILL.md 中的简化版本继续执行
3. 在审查报告中标注"reference 文件加载失败，使用简化流程"

---

## 8. 界面一致性验证清单

每次输出前，检查以下项目：

### 8.1 question 工具检查

- [ ] 已与 references/ui-standards.md 中对应模板逐字比对，措辞与选项完全一致
- [ ] 使用了标准模板中的格式
- [ ] 问题描述清晰明确
- [ ] 选项覆盖所有可能情况
- [ ] 包含"其他"或"自定义"选项（如需要）
- [ ] header 字段简洁（≤30字符）

### 8.2 状态展示检查

- [ ] 使用了统一的状态标记（✅ ⏳ ⏸️ ⏭️ ❌ ⚠️）
- [ ] 包含完整的阶段列表
- [ ] 显示当前角色和开发任务信息
- [ ] 对齐格式正确

### 8.3 错误处理检查

- [ ] 错误描述清晰
- [ ] 包含当前状态信息
- [ ] 提供明确的建议操作
- [ ] 列出相关文件路径

### 8.4 输出报告检查

- [ ] 使用了对应的模板文件
- [ ] 变量已替换为实际路径
- [ ] 格式符合规范
- [ ] 包含必要的元信息（时间、轮次、角色）

---

## 9. 输出一致性参考示例

> 以下为阶段0的标准输出示例，所有运行应严格参照此格式。每次执行时，必须重新读取本节内容，不得凭记忆输出。

### 9.1 阶段0完整流程示例

**阶段开始输出**：

```
项目目录当前为空（仅有工具配置目录），无已有流水线状态。开始执行 **阶段0：环境准备**。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 阶段 0：环境准备
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
执行角色：待确认
执行步骤：路径确认 → 角色确认 → 目录初始化 → 输入收集 → 范围确认 → 任务登记
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**步骤0：路径确认**
```

（然后调用 question §1.1 模板）

**步骤1 输出**（用户选择路径后）：

```
已确认使用默认路径：
- `$PROJECT_ROOT\deliverables\` → 交付产物输出目录
- `$PROJECT_ROOT\check\` → 审查报告输出目录
- `$PROJECT_ROOT\plans\` → 工作包/开发任务计划输出目录
- `$PROJECT_ROOT\requirements\` → 需求文档输入目录
- `$PROJECT_ROOT\config\` → 中间件配置输入目录
- `$PROJECT_ROOT\design\` → 系统级设计文档目录

**步骤1：角色确认**
```

（然后调用 question §1.7 模板）

**角色确认后输出**：

```
**👤 角色确认**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：PM
执行阶段：阶段0 → 阶段1 → 阶段2
核心职责：需求拆分、开发任务规划
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**📋 流水线状态**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
阶段0 - 环境准备       ⏳ 进行中
阶段1 - 需求拆分       ⏸️ 待执行
阶段2 - 开发任务计划    ⏸️ 待执行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
当前角色：PM
架构类型：待确认
```

> 注意：PM 角色只显示阶段0/1/2，不显示阶段3-7（那些不属于 PM 的职责范围）。

**步骤2 输出**：

```
**步骤2：环境初始化**
```

**步骤3 输出**（子 agent 派发）：

```
派发子 agent 读取输入文档。
```

（子 agent 返回后）

```
输入文档状态已确认：
- `requirements/`：空目录，仅有 README
- `plans/`：仅有模板文件
- `design/`：仅有 `_` 前缀模板文件
- `config/`：有 `middleware.example.yaml`，无 `middleware.local.yaml`

记录输入状态并登记关键指标。
```

**关键指标输出**：

```
📈 关键指标登记
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
指标            数量      统计时间
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
数据库表数量    0         2026-07-21
API 接口数量    0         2026-07-21
测试类数量      0         2026-07-21
测试用例数      0         2026-07-21
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 9.2 文本格式规则总结

| 元素 | 格式 | 示例 |
|------|------|------|
| 步骤标题 | `**步骤N：步骤名称**` | `**步骤0：路径确认**` |
| 状态展示标题 | `**emoji 标题**` | `**👤 角色确认**` |
| 列表项 | `- item` | `- $PROJECT_ROOT\deliverables\ → 交付产物输出目录` |
| 路径/文件名 | `` `path` `` | `` `$PROJECT_ROOT\check\` `` |
| 重点标注 | `**粗体**` | `**阶段0：环境准备**` |
| 分隔线 | 40个 `━` | `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` |
| 箭头说明 | `→` | `$PROJECT_ROOT\deliverables\ → 交付产物输出目录` |
