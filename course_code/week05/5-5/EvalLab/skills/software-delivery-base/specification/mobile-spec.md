# 移动端开发规范（摘要）— 移动端代码质量审查依据

> 适用于 Flutter / React Native / 原生（Android/iOS）等技术栈。
> 违反项按 Blocker/Critical/Major/Minor 四级记录。

## 一、工程规范
- M-P1【Critical】构建配置文件完整，可正常编译
- M-P2【Critical】依赖版本锁定，无已知高危漏洞
- M-P3【Major】环境配置（dev/staging/prod）分离

## 二、命名规约
- M-N1【Major】文件名与类名使用 PascalCase
- M-N2【Major】变量/函数使用 camelCase
- M-N3【Critical】包/模块命名语义化，避免与系统组件冲突

## 三、组件/页面结构
- M-V1【Critical】页面/组件职责单一
- M-V2【Major】组件层级合理，避免过深嵌套
- M-V3【Major】列表使用懒加载/虚拟列表（大数据量场景）

## 四、状态管理
- M-S1【Critical】跨页面共享状态使用状态管理库（Provider/Bloc/Riverpod/Redux）
- M-S2【Major】状态变更可追溯

## 五、网络请求
- M-A1【Blocker】统一网络请求封装，禁止在UI层直接发起网络请求
- M-A2【Critical】接口路径/入参/出参与后端API严格对齐
- M-A3【Critical】请求超时、重试、错误处理统一
- M-A4【Major】请求/响应数据模型使用强类型

## 六、安全
- M-SE1【Blocker】禁止在代码中硬编码密钥/证书
- M-SE2【Critical】敏感数据使用安全存储（Keychain/Keystore），不明文存储
- M-SE3【Critical】用户输入做校验和转义

## 七、性能
- M-PF1【Major】图片按需加载/压缩，避免内存溢出
- M-PF2【Major】避免在主线程执行耗时操作
- M-PF3【Major】列表滚动流畅度（FPS≥55）

## 八、Lint/静态分析
- M-L1【Critical】Lint检查零error
- M-L2【Major】启用平台推荐的静态分析规则集