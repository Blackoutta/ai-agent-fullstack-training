# 前端开发规范（摘要）— 前端代码质量审查依据

> 本文件是前端代码质量审查（阶段 5）的判定依据，适用于默认技术栈
> Vue 3 + TypeScript + Vite + Element Plus。违反项按等级记录。

## 违反等级定义

| 等级 | 含义 | 处理 |
|------|------|------|
| Blocker | 阻断性，会导致严重缺陷/安全问题 | 必须修正 |
| Critical | 严重，影响稳定性/正确性 | 必须修正 |
| Major | 较严重，影响可维护性 | 尽量修正并记录 |
| Minor | 轻微，影响规范性 | 记录 |

---

## 一、工程与构建

- P1【Blocker】`package.json` 必须锁定依赖版本，禁止使用 `*`/`latest`。
- P2【Critical】`vite.config.ts` 中 `base`、代理（dev server proxy）、构建产物目录须明确配置。
- P3【Critical】`tsconfig.json` 开启 `strict: true`，禁止 `any` 泛滥（见类型规约）。
- P4【Major】环境变量通过 `.env.development` / `.env.production` 管理，禁止硬编码接口地址。

## 二、命名规约

- N1【Major】组件文件名与组件名使用 PascalCase（如 `UserList.vue`）。
- N2【Major】普通变量/函数使用 camelCase；常量全大写下划线分隔。
- N3【Critical】组件 name 必须唯一且语义化，避免与 HTML 原生元素/Element Plus 组件冲突。
- N4【Major】`views/` 下页面按业务模块分目录；`components/` 按功能聚合。

## 三、组件结构

- V1【Critical】统一使用 `<script setup lang="ts">` 组合式 API，禁止混用 Options API。
- V2【Major】单文件组件顺序：`<template>` → `<script setup>` → `<style>`。
- V3【Major】`<style>` 须加 `scoped`（全局样式集中管理）。
- V4【Critical】Props 须用 TypeScript 接口定义类型并设 `required`/默认值；Emits 须声明类型。
- V5【Major】组件职责单一；超过 300 行的组件须拆分。
- V6【Major】禁止在模板中写复杂表达式/直接调用有副作用的方法，抽到 computed/方法。

## 四、TypeScript 类型规约

- T1【Blocker】禁止滥用 `any`；确需时用 `unknown` 并收窄类型，或加注释说明。
- T2【Critical】接口请求/响应须定义 DTO 类型，禁止后端返回直接 `as any` 使用。
- T3【Critical】公共类型集中放 `types/`，按模块组织。
- T4【Major】避免使用 `@ts-ignore`；确需时改用 `@ts-expect-error` 并注明原因。

## 五、状态管理（Pinia）

- S1【Critical】跨组件共享状态使用 Pinia store；组件局部状态用 `ref`/`reactive`。
- S2【Major】store 按业务模块拆分；action 中处理异步，getter 计算派生。
- S3【Major】禁止直接修改 store 外部状态，通过 action 修改。

## 六、路由（Vue Router）

- R1【Critical】路由须懒加载（`() => import(...)`），按模块划分路由配置。
- R2【Critical】须配置路由守卫：鉴权、权限校验、404 兜底。
- R3【Major】路由 meta 须声明 title、所需权限等元信息。

## 七、接口封装（axios）

- A1【Blocker】统一在 `api/` 封装请求，禁止在组件内直接 `axios` 调用。
- A2【Critical】请求/响应拦截器统一处理：token 注入、错误码映射、loading、超时重试。
- A3【Critical】接口路径/入参/出参必须与后端接口设计**严格对齐**。
- A4【Major】接口函数须标注入参与返回的 TypeScript 类型。

## 八、安全

- SE1【Blocker】禁止使用 `v-html` 渲染不可信内容，防 XSS。
- SE2【Critical】表单须做前端校验（必填、格式、长度）；敏感字段不明文展示。
- SE3【Critical】token 等凭证存放与过期处理须安全（避免 localStorage 长期明文存敏感信息）。
- SE4【Major】分页参数须有上限，防大结果集；列表须做空状态与错误兜底。

## 九、可访问性与体验

- U1【Major】交互元素须有可聚焦状态与键盘可达性。
- U2【Minor】文案统一；中英文之间空格；错误提示语义明确。
- U3【Minor】图片须有 `alt`；图标按钮须有 `title`/`aria-label`。

## 十、ESLint

- EL1【Critical】`npm run lint` 须零 error；warning 须控制在合理范围并记录。
- EL2【Major】启用 Vue + TS 推荐规则集；禁止为通过 lint 而随意 disable 规则。
