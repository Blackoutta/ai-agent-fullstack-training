# 前端交付验证

## 范围

仅在 `codebaseEval/frontend` 创建/修改文件，后端、设计、需求文档均未编辑。依据 `design/architecture.md` 与 `requirements/platform.md` 的已确认本地单体与同源 API 契约实现。

## 实测结果

- 安装：`npm install --registry=https://registry.npmjs.org` 完成，精确版本与锁文件已落盘。
- 类型：`npm run check` 通过，TypeScript strict、未使用项和 unchecked index 检查开启。
- 测试：`npm run test` 通过，4 个测试文件、28 个测试全部通过。
- 构建：`npm run build` 通过，`dist/index.html` 与 CSS/JS 产物生成。
- 安全：`npm audit --registry=https://registry.npmjs.org` 返回 0 漏洞。初始镜像审计端点不可用，改用官方端点；已修复初始 Vue/Vite/Vitest 及 glob 依赖公告。
- 行数：所有 `.vue` 页面/组件 <300 行，最大 `BenchmarkView.vue` 120 行。

## 设计与代码自检

- 八个导航区域均实现，整页导航测试验证当前页面名称与导航标记。
- API 路径/方法/JSON 参数集中在 `src/api/index.ts`；DTO 集中在 `src/types/index.ts`。
- Benchmark CRUD/导入导出、策略编辑、实验启动/取消、进度、运行详情、Judge/人工评审、聚类样本和回归报告均接真实 API 封装。
- 提交数据使用快照，避免后续表单清空/编辑影响已提交对象。
- 运行详情加载有异步版本防护，防止快速切换运行时展示旧证据。
- 比较条件改变立即清除旧报告，离线/无配对结果不能产生采用结论。
- 成本未知不显示为零成本；空数据不显示虚构成功率。
- 无 `v-html`，模型答案转义测试通过，证据中的思维链与敏感字段递归过滤测试通过。
- 离线 Judge 禁用；人工语义评审不在前端改写总体 outcome，而展示服务端结果。
- 操作失败保留输入与可见错误，后台健康轮询不会抹掉操作错误。
- 原生表单标签、错误反馈、弹窗焦点/Escape/恢复、状态文字、响应式布局与减少动画已实现。

## 测试分组

- `tests/api.spec.ts`：8 项，请求契约、错误、路径编码、下载与对象 URL 回收。
- `tests/workflows.spec.ts`：6 项，任务/策略编辑、无效导入、实验预算/启动/取消、离线回归。
- `tests/evidence.spec.ts`：9 项，转义、过滤、时间轴、人工评审、错误反馈、弹窗、共享状态。
- `tests/app.spec.ts`：5 项，八页导航、空态、服务未连接、错误持久性、损坏链接恢复。

## 未验证项

执行时后端目录未提供可运行 API，因此未进行真实后端/模型联调。未执行浏览器截图或 E2E、全量覆盖率统计。源码快照隔离、后端脱敏/权限、真实 Judge 费用、人工评分门禁与服务端回归匹配需要后端验收；组件 fixture 不是生产数据或模型成绩。
