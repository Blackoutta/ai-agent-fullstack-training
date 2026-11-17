# 测试数据管理 (Test Data Management)

> 由测试角色在阶段6开始前规划，执行过程中维护。

- 规划时间：__________

## 测试数据策略

### 数据分层

| 层级 | 用途 | 数据来源 | 隔离策略 |
|------|------|---------|---------|
| 单元测试 | Mock数据 | 代码内构造 | 每次测试独立 |
| 集成测试 | 近真实数据 | SQL脚本/工厂 | 每个测试类独立 |
| E2E测试 | 真实场景数据 | 初始化脚本 | 每轮测试独立 |

### 数据构造方式

| 方式 | 适用场景 | 工具 |
|------|---------|------|
| Builder模式 | 复杂对象 | 自定义Builder类 |
| Factory模式 | 批量数据 | Factory类 |
| SQL初始化 | 数据库固定数据 | init.sql / Flyway |
| Faker库 | 随机数据 | Java Faker / Faker.js |

## 初始数据脚本

### 后端测试数据
```sql
-- 用户数据
INSERT INTO sys_user (id, username, password, ...) VALUES (...);
-- 业务数据
INSERT INTO biz_xxx (...) VALUES (...);
```

### 前端测试数据
```typescript
// fixtures/users.ts
export const mockUser = { id: 1, name: 'Test User', ... };
```

## 数据清理策略

| 测试层级 | 清理时机 | 清理方式 |
|---------|---------|---------|
| 单元测试 | 每个测试方法后 | Mockito mock（无需清理） |
| 集成测试 | 每个测试类后 | @Transactional回滚 / 数据库截断 |
| E2E测试 | 每轮测试后 | 清理脚本 / 数据库重置 |

## 注意事项
- 测试数据不得包含真实用户信息
- 测试数据应覆盖边界值（空值、最大值、特殊字符）
- 敏感字段（密码、token）使用固定测试值