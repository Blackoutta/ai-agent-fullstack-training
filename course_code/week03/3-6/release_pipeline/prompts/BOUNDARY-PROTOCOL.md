# 边界维持协议（BOUNDARY-PROTOCOL）

> 本文件与 SDD 一同喂给 AI。它定义了 AI 在生成过程中**必须遵守的 5 条硬约束**，
> 以及违反时的处理方式。**不接受"灵活变通"**。

---

## 规则 1：闭世界假设（Closed-World）

SDD 中列出的一切即全部。AI **不得**：

- 新增 §3 之外的 State 字段
- 新增 §4 之外的节点
- 新增 §5 之外的边或路由分支
- 新增 §6 之外的工具
- 新增 §7 之外的 interrupt 点
- 引入 §2 之外的依赖

**判定方式**：每生成一个文件，对照 SDD 自检；任意一项越界即触发规则 3。

---

## 规则 2：签名锁定（Signature Lock）

下列内容必须**逐字符照搬**，不得改写：

- §3 中 TypedDict / Pydantic 模型的字段名与类型注解
- §4 中节点函数的名称、参数列表、返回类型
- §5 中路由函数的 `Literal[...]` 返回值集合
- §7 中 interrupt 的 payload 字段名与编号（INT-1, INT-2A, ...）

**允许的改动**：函数体实现、import 顺序、注释、类型别名拆分。

---

## 规则 3：违规协议（Violation Protocol）

当 AI 认为 SDD 存在矛盾、缺漏或不可实现时，**必须立即停止生成**并输出：

```
⚠️ BOUNDARY_VIOLATION
section: §X.Y
issue: <一句话描述矛盾点>
evidence: <SDD 中冲突的两段原文>
proposed_change: <最小修订建议>
impact: <若按建议修订会影响哪些其他节>
```

**禁止行为**：
- 边生成边改 SDD
- 用"我假设你的意思是…"绕过
- 在代码注释里偷偷加字段
- 把违规内容放进 `# TODO` 留待后续

用户裁决前不得继续。

---

## 规则 4：生成顺序锁（Generation Order Lock）

按 `GENERATION-ORDER.md` 规定的顺序逐文件产出。每文件输出后**必须**附自检清单：

```
✅ Self-check for <文件名>
- [ ] §3 State 字段引用全部存在
- [ ] §4 节点名/签名未改动
- [ ] §5 路由 Literal 集合一致
- [ ] §6 工具未越界
- [ ] §2 依赖未新增
- [ ] §9 Out of Scope 未触犯
- [ ] 无 BOUNDARY_VIOLATION 待裁决
```

用户回复"OK"或"continue"才生成下一文件。回复"redo <文件名>"则**只重做该文件**，
其余已确认文件保持不变（详见 GENERATION-ORDER §3）。

---

## 规则 5：验收前置（Acceptance-First）

§8 Acceptance Criteria 是**生成完成后的唯一通过标准**。AI 在生成过程中应：

- 每写完一个文件，自问"这能让哪些 AC 通过？"
- 不允许通过修改 AC 来"让测试通过"
- 不允许在测试代码中加 `@pytest.mark.skip` 绕过失败 AC
- 如某条 AC 与 SDD 其他节冲突，触发规则 3

---

## 元边界：本协议的适用范围

- ✅ 适用于：LangGraph 单图工程（StateGraph + 节点 + 边 + interrupt + checkpointer）
- ❌ 不适用于：多 Agent 协作图、LangChain Agent Executor、CrewAI、AutoGen
- ❌ 不替代：架构设计文档、API 规范、数据模型 ER 图

SDD 是**生成契约**，不是**架构说明书**。
