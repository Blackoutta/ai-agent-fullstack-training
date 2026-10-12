# 提示词 P3：把内联检查升级为 ToolNode 并行

把下面整段复制给 AI。它会读 `demos/02_routing/`，在 `demos/03_toolnode/` 下生成新格。

---

```
任务：在 demos/02_routing/ 的基础上，新建 demos/03_toolnode/，
把"4 项前置检查"从内联函数升级为 LangGraph 的 ToolNode 并行调度。

【本步骤业务目标】
构建、单测、安全扫描、依赖审计这 4 项检查互不依赖。
本步骤要让它们在图上"并行执行"，由 ToolNode 负责调度。

【State 在 02 基础上新增字段】
messages: NotRequired[Annotated[list[AnyMessage], add_messages]]   # ToolNode 通道
checks:   NotRequired[list[CheckResult]]                            # 解析后的结构化结果

CheckResult TypedDict：
class CheckResult(TypedDict):
    name: str        # build / unit_test / security_scan / dep_audit
    passed: bool
    summary: str

【新增文件 tools.py：4 个 @tool 函数（mock 实现，返回 JSON 字符串）】
build_service(service, version)   → {"tool":"build","passed":true,"summary":...}
run_unit_tests(service)           → {"tool":"unit_test",...}
security_scan(diff)               → {"tool":"security_scan",...}
dependency_audit(service)         → {"tool":"dep_audit",...}

【节点变化】
intake 不再内联跑检查，改为返回一条 AIMessage，里面带 4 个 tool_calls
（id 分别为 call_build / call_unit / call_scan / call_audit）

新增节点：
  tool_checks  = ToolNode(CHECK_TOOLS)  # 用 langgraph.prebuilt.ToolNode
  collect_checks(state): 解析 messages 里的 4 条 ToolMessage，转成
                         checks 列表 + 计算 checks_passed

【边变化】
原：START → intake → classify_change → ...
新：START → intake → tool_checks → collect_checks → classify_change → ...

【验收 AC】
AC-1: 跑完后 state["checks"] 长度为 4，4 个 name 齐全
AC-2: state["checks_passed"] == 4
AC-3: 路由分支与 02 一致（短 diff=L, 长 diff=M, auth 关键字=H）
AC-4: state["messages"] 末尾至少包含 4 条 ToolMessage

【明确不做】
- 不引入 interrupt、Command（下一步）
- 不引入 SQLite Checkpointer（下一步）
- 不引入循环（再下一步）
- 不调真实大模型，4 个工具就是 4 个 mock 函数

【风格】@tool 装饰器、JSON 字符串返回；
intake 函数返回 {"messages":[AIMessage(...)]}；
collect_checks 必须 isinstance(msg, ToolMessage) 过滤，不要遍历所有 messages。
```

---

## 拿到生成结果后做什么

```bash
cd release_pipeline/demos/03_toolnode
python app.py
python -m pytest tests/ -v
```
