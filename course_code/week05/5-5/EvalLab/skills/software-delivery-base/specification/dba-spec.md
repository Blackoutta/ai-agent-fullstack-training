# 数据库开发规范（摘要）— DBA代码质量审查依据

> 本文件作为阶段5 SQL/数据库代码质量审查的判定依据。
> 基于 alibaba-java-manual.md §三 MySQL规约扩展，增加DBA专属规范。

## 一、建表规范（增强）
- D1【Blocker】所有字段必须有 NOT NULL 约束（除特殊场景）
- D2【Blocker】主键统一 bigint unsigned 自增或雪花，禁止UUID做主键
- D3【Critical】必须包含 gmt_create、gmt_modified、is_deleted 三字段
- D4【Critical】单表字段数不超过40个，超过需垂直拆分
- D5【Major】字段命名：小写+下划线，禁用保留字
- D6【Major】VARCHAR 长度按实际需要设定，禁止使用 VARCHAR(MAX)

## 二、索引规范
- I1【Blocker】单表索引数不超过5个
- I2【Critical】联合索引字段顺序遵循最左匹配原则
- I3【Critical】区分度低的字段不单独建索引（如is_deleted）
- I4【Major】索引命名：主键pk_、唯一uk_、普通idx_
- I5【Major】避免在大字段（TEXT/BLOB）上建索引

## 三、SQL编写规范
- Q1【Blocker】禁止 SELECT *，必须明确列名
- Q2【Blocker】禁止不含 WHERE 的 UPDATE/DELETE
- Q3【Critical】IN 操作集合大小 ≤ 1000
- Q4【Critical】JOIN 查询不超过3张表
- Q5【Critical】分页查询使用延迟关联或书签方式（深分页）
- Q6【Major】批量插入使用 VALUES 多行插入，单批 ≤ 1000 条

## 四、事务规范
- T1【Blocker】事务尽量短，禁止事务中包含RPC/HTTP调用
- T2【Critical】@Transactional 注解标注在 Service 层 public 方法上
- T3【Critical】事务中异常必须抛出，不能 catch 吞掉

## 五、变更规范
- C1【Blocker】DDL变更必须在测试环境验证后才能上生产
- C2【Critical】禁止直接修改线上数据（必须通过审批流程）
- C3【Critical】大表变更（>100万行）必须使用 pt-osc / gh-ost
- C4【Major】ALTER TABLE 加字段尽量放在业务低峰期