# 触发方式示例

## 基础用法

```
/software-delivery                                    # 弹出角色选择菜单
/software-delivery --role=后端开发                     # 选角色，弹开发任务选择
/software-delivery --role=后端开发 --task=1            # 角色+开发任务一步到位
```

## 按角色开发

```
/software-delivery --role=后端开发 --task=1
/software-delivery --role=前端开发 --task=1
/software-delivery --role=移动端开发 --task=1
/software-delivery --role=数据库工程师 --task=1
/software-delivery --role=运维 --task=1
```

## 按模式开发

```
# Bug 修复模式
/software-delivery --role=后端开发 --task=1 --type=bugfix

# 功能补全模式
/software-delivery --role=后端开发 --task=1 --type=completion
```

## 架构师专用

```
/software-delivery --role=架构师 --arch=monolith
/software-delivery --role=架构师 --arch=microservice
/software-delivery --role=架构师 --task=1 --arch=monolith --scope="用户登录,用户注册"
```

## 手动指定功能范围

```
/software-delivery --task=1 --scope="用户登录,用户注册,权限管理"
/software-delivery --role=后端开发 --task=1 --scope="用户登录,用户注册"
```

## 自定义输出目录

```
# 绝对路径
/software-delivery --deliver-dir=$PROJECT_ROOT/output --check-dir=$PROJECT_ROOT/reports

# 相对路径
/software-delivery --deliver-dir=./dist --check-dir=./review

# 组合使用
/software-delivery --role=后端开发 --task=1 --deliver-dir=$PROJECT_ROOT/output/backend --check-dir=$PROJECT_ROOT/output/check

# 指定所有路径参数
/software-delivery --deliver-dir=$PROJECT_ROOT/output/deliverables --check-dir=$PROJECT_ROOT/output/check --plans-dir=$PROJECT_ROOT/output/plans --requirements-dir=$PROJECT_ROOT/input/requirements --config-dir=$PROJECT_ROOT/input/config
```

> **交互式路径确认**：无论是否通过参数指定路径，skill 启动后都会在阶段 0 用 `question` 工具向用户展示最终输出路径供确认。
