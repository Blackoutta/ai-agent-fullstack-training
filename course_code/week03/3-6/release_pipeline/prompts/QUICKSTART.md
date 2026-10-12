# QUICKSTART：5 分钟极简版

> 不想填 10 节完整 SDD？只填下列 4 节也能让 AI 跑出可用工程。
> 适合：原型验证、教学演示、个人项目。
> **代价**：边界更宽松，AI 可能在未声明处自由发挥；正式交付请回到完整模板。

---

## 必填 4 节

### §0 一句话定位

> 本系统是一个 ___，触发后按 ___ 顺序执行，产出 ___。

### §3 State 最小集

```python
class XxxState(TypedDict):
    # 至少 5 个字段，含 1 个 NotRequired + 1 个 Annotated[..., add]
```

### §4 节点最小集

至少 5 个节点，必须包含：
- 1 个 ToolNode
- 1 个 interrupt 节点
- 1 个条件路由的源头节点
- 1 个 finalize 节点

### §9 明确不做（至少 3 条）

- 不做 ___
- 不集成 ___
- 不实现 ___

---

## 喂给 AI 的最小提示词

```
请按 SDD 规范生成一个 LangGraph 工程。

【SDD】
§0 一句话定位：<填>
§3 State：<填>
§4 节点：<填>
§9 不做：<填>

【协议】
- 遵守 BOUNDARY-PROTOCOL.md 的 5 条规则
- 按 GENERATION-ORDER.md 的 14 阶段顺序生成
- 每文件后附自检清单，等我确认再继续

未声明的节（§1/§2/§5/§6/§7/§8）请按"最小合理默认"填充，
并在每个默认决定处标注 [DEFAULT]，便于我事后修订。
```

---

## 默认值约定

AI 在未声明节按以下默认填充：

| 节 | 默认 |
|---|---|
| §1 角色 | 单角色 "operator" |
| §2 依赖 | langgraph + langchain-core + langgraph-checkpoint-sqlite + pydantic + typer |
| §5 边 | START → 节点顺序 → END，至少 1 个条件分支 + 1 个回环 |
| §6 工具 | 全 mock；config/tools.yaml 控制开关 |
| §7 Checkpoint | AsyncSqliteSaver；thread_id = ticket_id |
| §8 AC | 至少 5 条，覆盖 happy path / reject / rollback / 字段闭包 / 报告落盘 |

---

## 何时升级到完整 SDD

出现以下任一信号时，停止用 QUICKSTART，回到 `SDD-TEMPLATE.md`：

- 节点数 > 8
- 出现 2 个以上 interrupt 点
- 需要多人协作生成（不同人负责不同节点）
- 工程要进入生产或教学交付
- AI 多次触发 BOUNDARY_VIOLATION
