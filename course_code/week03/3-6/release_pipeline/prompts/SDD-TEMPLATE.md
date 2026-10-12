# SDD 模板（Spec-Driven Development）

> 用本模板写一份"生成契约"，把它和 `BOUNDARY-PROTOCOL.md`、`GENERATION-ORDER.md` 一起喂给 AI，
> 即可重复生成结构一致的 LangGraph 工程。**所有节都必填**；写不出来就回去想清楚再来。

---

## §0 身份卡（Identity Card）

**一句话定位**：
> 例：本系统是一个 ___，它在 ___ 触发后，按 ___ 顺序执行 ___，最终产出 ___。

**关键词清单**（5-8 个，禁止超出）：
- key1
- key2
- ...

**边界声明**：本节确定的主题不可扩展。AI 生成时不得引入清单外的关键词。

---

## §1 业务场景（Business Context）

**触发条件**：（谁/什么事件触发系统）

**主要角色**：（列出所有角色，禁止新增）
- 角色 A：职责
- 角色 B：职责

**最终产出**：（用户看到什么）

**边界声明**：本节列出的角色与产出即全部，AI 不得发明新角色或新输出形态。

---

## §2 技术栈与依赖（Stack & Dependencies）

直接给出 `requirements.txt`（或 `package.json`）的字面内容：

```
lib-a>=x.y
lib-b>=x.y
```

**允许的 Python/Node 版本**：

**边界声明**：AI 不得引入此清单之外的依赖。如确需新增，触发 BOUNDARY_VIOLATION 协议。

---

## §3 状态契约（State Schema）

直接写出完整 TypedDict / Pydantic 模型代码块：

```python
class XxxState(TypedDict):
    field_a: str
    field_b: NotRequired[int]
    field_c: Annotated[list[Item], add]   # 标注 reducer
```

**字段语义说明**（每个字段一句话）：
- field_a：
- field_b：
- field_c：

**边界声明**：**闭世界**。AI 不得增删字段、不得改类型、不得改 reducer。所有节点引用的字段必须在此存在。

---

## §4 节点清单（Node Inventory）

只给签名，不写实现。表格形式：

| # | 节点名 | 类型 | 输入字段 | 输出字段 | 副作用 |
|---|---|---|---|---|---|
| 1 | `node_a` | 普通函数 | field_a | field_b | 无 |
| 2 | `node_b` | ToolNode | messages | messages | 调用工具 X |
| 3 | `node_c` | interrupt | field_b | field_c | 暂停等待人工 |

**节点函数签名**：

```python
def node_a(state: XxxState) -> dict: ...
async def node_b(state: XxxState) -> dict: ...
```

**边界声明**：节点名、数量、签名锁死。AI 不得合并、拆分、重命名节点。

---

## §5 边与路由（Edges & Routing）

**邻接表**：

```
START -> node_a
node_a -> node_b
node_b -> node_c  (条件: route_x)
node_c -> END
```

**路由函数签名**：

```python
def route_x(state: XxxState) -> Literal["ok", "fail"]: ...
def route_y(state: XxxState) -> Literal["advance", "retry", "abort"]: ...
```

**条件映射**：

```python
{"ok": "node_b", "fail": "node_d"}
```

**循环点说明**：（哪些边形成回环，预算上限是多少）

**边界声明**：路由返回值的 Literal 集合锁死；AI 不得新增映射键。

---

## §6 工具与外部 I/O（Tools）

| 工具名 | 用途 | real 实现 | mock 行为 | 可注入故障 |
|---|---|---|---|---|
| `tool_x` | ... | shell: ... | 返回固定 JSON | `simulate_x_fail` |

**real / mock 切换机制**：配置文件路径、字段名。

**白名单约束**：（哪些工具是只读，哪些有写副作用）

**边界声明**：工具集闭包。AI 不得新增工具，不得在节点内绕开工具直接 I/O。

---

## §7 Interrupt 与 Checkpoint

**中断点清单**（编号锁死）：

| 编号 | 节点 | 触发条件 | payload 字段 | 恢复输入 schema |
|---|---|---|---|---|
| INT-1 | `approval_x` | ... | ... | `{"action": ..., "actor": ...}` |

**thread_id 规则**：（如何生成、谁负责持久化）

**Checkpointer 选型**：（SQLite / Postgres / Memory，路径配置）

**跨进程恢复约束**：（重启后哪些字段必须保留，哪些上下文需要重新装配）

**边界声明**：中断点编号与 payload 字段锁死。AI 不得新增中断或改 payload schema。

---

## §8 验收标准（Acceptance Criteria）

**每条都必须可机器验证**。pytest 风格断言：

```
AC-1: 给定 ___，当 ___，则 state["outcome"] == "___"
AC-2: ...
AC-N: ...
```

至少覆盖：
- [ ] 正常路径（happy path）
- [ ] 每条条件分支至少 1 条
- [ ] 每个循环的回退路径
- [ ] 每个 interrupt 的 approve / reject / revise
- [ ] Checkpoint 跨进程恢复
- [ ] State 字段闭包检查

**边界声明**：AI 生成的代码必须能让所有 AC 通过；不得修改 AC 来迁就实现。

---

## §9 明确不做（Out of Scope）

显式列出本系统**不做**的事，防止 AI 自由发挥：

- 不做 ___
- 不集成 ___
- 不实现 ___
- 不优化 ___

**边界声明**：**反边界**。AI 触读本节任意一条即视为 BOUNDARY_VIOLATION，必须停止生成。

---

## 附：交付物清单（Deliverables）

AI 必须按 `GENERATION-ORDER.md` 顺序产出以下文件，每文件末尾附自检清单：

```
project_root/
  state.py
  tools.py
  nodes.py
  graph.py
  checkpointer.py
  visualize.py
  app.py
  config/tools.yaml
  requirements.txt
  .env.example
  tests/test_acceptance.py
  Dockerfile
  docker-compose.yml
  README.md
```
