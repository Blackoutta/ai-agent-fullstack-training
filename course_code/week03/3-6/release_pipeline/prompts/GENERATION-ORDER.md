# 生成顺序与单文件重做协议（GENERATION-ORDER）

> 本文件规定 AI 产出工程文件的**强制顺序**与**单文件重做**机制。
> 顺序不可调换：后续文件依赖前面文件的类型与签名。

---

## §1 强制生成顺序

| 阶段 | 文件 | 依赖 | 验收点 |
|---|---|---|---|
| 1 | `requirements.txt` | §2 | 依赖清单字面匹配 SDD |
| 2 | `.env.example` | §7 | 包含 CHECKPOINT_DB / TOOLS_CONFIG 等键 |
| 3 | `config/tools.yaml` | §6 | 每个工具都有 mode 字段；mock_faults 节存在 |
| 4 | `state.py` | §3 | TypedDict 字段与 SDD 逐字符一致 |
| 5 | `tools.py` | §6 | @tool 装饰器；real/mock 分支；故障注入点 |
| 6 | `nodes.py` | §3 §4 | 节点函数签名锁死；不在节点内直接 I/O |
| 7 | `graph.py` | §4 §5 | StateGraph 装配；路由 Literal 集合一致 |
| 8 | `checkpointer.py` | §7 | AsyncSqliteSaver；async contextmanager |
| 9 | `visualize.py` | — | draw_mermaid + draw_mermaid_png |
| 10 | `app.py` | 全部 | CLI: submit / status / approve / tail / visualize / demo |
| 11 | `tests/test_acceptance.py` | §8 | 每条 AC 对应一个测试函数 |
| 12 | `Dockerfile` | §2 | 多阶段或单阶段；EXPOSE 端口；CMD 指向 app |
| 13 | `docker-compose.yml` | — | volumes 挂载 data/reports/config |
| 14 | `README.md` | 全部 | 安装、5 个演示场景、SDD 复用指引 |

**每文件输出后必须附自检清单**（见 BOUNDARY-PROTOCOL 规则 4）。
用户回复 `OK` / `continue` 才进入下一文件。

---

## §2 阶段间硬约束

- **阶段 4 完成前不得写阶段 6**：nodes.py 引用 State 字段，必须等 state.py 确认。
- **阶段 6 完成前不得写阶段 7**：graph.py 注册节点函数，必须等 nodes.py 签名确认。
- **阶段 11 必须最后写测试**：测试是 AC 的代码化，需要前面所有文件已就绪。
- **阶段 12-13 可与 11 并行**：容器化与测试无依赖。

---

## §3 单文件重做协议

用户可在任意时刻发出：

```
redo <文件名> [原因]
```

AI 行为：

1. **只重新生成该文件**，其余已确认文件**保持不变**
2. 重做时仍受 BOUNDARY-PROTOCOL 全部 5 条规则约束
3. 若重做导致下游文件签名不兼容，**触发 BOUNDARY_VIOLATION**，列出受影响的文件，
   等待用户决定是否级联重做
4. 重做完成后输出新的自检清单，等待用户确认

**禁止行为**：
- 借重做之机修改其他文件
- 借重做之机引入新依赖
- 把"重做"理解为"重写整个工程"

---

## §4 跨阶段回滚

若用户在阶段 N 发现阶段 M (M < N) 的设计有误：

```
rollback to <阶段 M 文件名>
```

AI 行为：
1. 列出 M+1 到 N 之间所有已生成文件
2. 标记为"待重新生成"
3. 等用户确认后才从阶段 M 开始重做

**不允许**：跳过中间阶段直接改后面的文件。

---

## §5 终止条件

满足以下任一即视为生成完成：

- 所有 14 个阶段已产出且自检通过
- 用户显式输入 `finish`
- `pytest tests/test_acceptance.py` 全部通过

终止时 AI 输出：

```
✅ GENERATION COMPLETE
files: <清单>
acceptance: <通过/失败统计>
boundary_violations: <历史违规与裁决记录>
```
