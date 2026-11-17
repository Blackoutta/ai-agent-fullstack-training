# specification 目录 — 开发规范文档（输入）

将开发规范文档放在本目录。skill 启动后会读取本目录下所有文档（README 除外）作为编码与质量审查依据。

## 已内置规范

- `alibaba-java-manual.md`：阿里巴巴 Java 开发手册（摘要），用作阶段 5 后端代码质量审查依据。
- `frontend-spec.md`：前端开发规范（Vue 3 + TS + Element Plus），用作阶段 5 前端代码质量审查依据。

## 可补充内容

可在本目录追加项目自定义规范，例如：

- 项目命名约定（包名、模块前缀）。
- 统一返回结构、错误码规范。
- 代码风格配置（checkstyle / spotless）。
- Git 提交规范、分支策略。

> 注意：自定义规范不应与 `alibaba-java-manual.md` 冲突；如有冲突以项目规范为准并在审查报告中注明。
