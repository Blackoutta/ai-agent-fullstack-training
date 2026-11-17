# 阿里巴巴 Java 开发手册（摘要）— 代码质量审查依据

> 本文件是《阿里巴巴Java开发手册（泰山版/黄山版）》的精简摘要，用作本 skill
> 阶段 5「代码质量审查」的判定依据。审查时按各维度逐条核对，违反项按等级记录。

## 违反等级定义

| 等级 | 含义 | 处理 |
|------|------|------|
| Blocker | 阻断性，会导致严重缺陷/安全问题 | 必须修正 |
| Critical | 严重，影响稳定性/正确性 | 必须修正 |
| Major | 较严重，影响可维护性 | 尽量修正并记录 |
| Minor | 轻微，影响规范性 | 记录 |

---

## 一、编程规约

### 1.1 命名规约
- N1【Major】代码命名不能以下划线或美元符号开始/结束。
- N2【Major】类名使用 UpperCamelCase；DO/BO/DTO/VO/AO/PO/UID 等后缀需符合语义。
- N3【Major】方法名、变量名使用 lowerCamelCase。
- N4【Critical】常量全大写，下划线分隔；力求语义完整，不嫌长。
- N5【Major】抽象类用 `Abstract` 或 `Base` 开头；异常类用 `Exception` 结尾；测试类以被测类名+`Test` 结尾。
- N6【Blocker】包名全小写、点分隔；杜绝不规范的缩写。
- N7【Critical】接口实现类区分：Service 实现 `xxxServiceImpl`，避免 `I` 前缀接口名。

### 1.2 常量定义
- C1【Blocker】不允许魔法值（未定义常量）直接出现在代码中。
- C2【Major】long 赋值使用大写 `L`，不用小写 `l`。
- C3【Major】不要使用一个常量类维护所有常量，按功能维度分类。

### 1.3 代码格式
- F1【Minor】大括号：左括号不换行，右括号单独成行（if/else/for 等内容为空可 `{} `）。
- F2【Minor】if/for/while/switch/do 必须使用大括号，即便单语句。
- F3【Minor】四空格缩进，禁止 Tab；运算符两侧空格。
- F4【Minor】单行字符不超过 120，超长换行；方法参数过多换行对齐。
- F5【Minor】方法间空一行；类内方法顺序：公有→保护→私有→Getter/Setter。

### 1.4 OOP 规约
- O1【Critical】避免通过类的对象引用访问静态变量/方法，用类名访问。
- O2【Blocker】`equals` 方法：常量或确定有值的对象在前，避免 NPE。
- O3【Critical】所有包装类对象间值比较使用 `equals`，不用 `==`。
- O4【Critical】构造方法禁止业务逻辑；`POJO` 类属性必须使用包装数据类型；RPC/输入参数使用包装类型，局部变量可用基本类型。
- O5【Major】`POJO` 类不设默认值，必须写 `toString` 方法。
- O6【Critical】`final` 可提高响应：能加则加（类/方法/变量）。
- O7【Major】慎用可变参数；循环体避免拼接字符串用 StringBuilder。
- O8【Blocker】`Object` 的 `equals` 易抛空指针，应使用 `Objects.equals(a,b)`。

### 1.5 集合处理
- S1【Blocker】`ArrayList` 的 `subList` 不可强转 `ArrayList`；修改原集合会致 `subList` 异常。
- S2【Blocker】使用 `Map` 的 `keySet`/`values`/`entrySet` 遍历时禁止修改；用 `entrySet` 遍历更高效。
- S3【Critical】`Collections` 返回的集合不可修改；`subList` 返回的视图修改会同步影响原集合。
- S4【Blocker】使用集合转数组 `T[]` 必须传入定长数组（`new T[list.size()]`）。
- S5【Blocker】数组转集合 `Arrays.asList` 返回不可修改且不能含基本类型数组；使用 `new ArrayList<>(Arrays.asList(...))`。
- S6【Critical】`foreach` 里禁止 `add`/`remove` 元素，用 `Iterator`。
- S7【Critical】泛型通配符 `<? extends T>` 用于读取、`<? super T>` 用于写入（PECS）。
- S8【Major】判空集合用 `isEmpty()`，不用 `size()==0`。

### 1.6 并发处理
- T1【Blocker】线程资源由线程池提供，禁止显式 `new Thread`。
- T2【Blocker】`SimpleDateFormat` 线程不安全，用 `DateTimeFormatter` 或 `ThreadLocal`。
- T3【Critical】`HashMap` 多线程下死循环，用 `ConcurrentHashMap`。
- T4【Blocker】`ThreadLocal` 使用后必须 `remove`，防内存泄漏。
- T5【Critical】`wait`/`notify`/`notifyAll` 必须在同步块中。
- T6【Major】高并发场景减少锁粒度；能用无锁数据结构/原子类则不用锁。
- T7【Major】对多线程环境使用的可变对象，创建后立即发布或加 final。

### 1.7 控制语句
- G1【Major】`switch` 必须有 `default`；`case` 必须有 `break`/`return`（除非刻意穿透并注释）。
- G2【Critical】`if`/`else`/`for`/`while` 必须大括号。
- G3【Major】表达异常分支少用 `if-else`，可用卫语句提前 return。
- G4【Major】避免取反逻辑运算符，优先正向表达。

### 1.8 注释规约
- CM1【Major】类、公有方法必须写注释（用途、参数、返回、异常）。
- CM2【Minor】注释与代码同步更新；废弃代码注释掉不如删除。
- CM3【Minor】半抽象的方法用 `// 说明` 注释；TODO 标注 `//TODO 姓名 内容 日期`。

---

## 二、异常与日志

### 2.1 异常处理
- E1【Blocker】禁止捕获 `Exception` 大类吞异常；必须捕获具体异常。
- E2【Blocker】`finally` 块禁止 `return`；禁止 `finally` 中抛异常覆盖 try 异常。
- E3【Critical】不要用异常做流程控制；try 范围尽量小。
- E4【Critical】捕获后必须处理（日志或重新抛出），禁止空 catch。
- E5【Major】`RuntimeException` 不应被 catch 后忽略；方法返回可为 null 时调用方需判空。
- E6【Major】定义业务异常继承 `RuntimeException`，提供带 message+cause 构造方法。

### 2.2 日志规约
- L1【Critical】使用 SLF4J（`LoggerFactory`），不直接使用日志实现。
- L2【Critical】日志使用占位符 `{}`，禁止字符串拼接。
- L3【Critical】`debug`/`info` 前先判 `isDebugEnabled` 仅当参数涉及方法调用/拼接开销。
- L4【Blocker】异常日志必须打印完整堆栈：`log.error("msg", e)`，不要 `log.error(e.getMessage())`。
- L5【Major】生产环境禁止直接打印大对象（如全量 DTO/集合），避免日志膨胀。

---

## 三、MySQL 数据库规约

### 3.1 建表规约
- DB1【Blocker】表名、字段名小写，下划线分隔；禁用数据库保留字。
- DB2【Blocker】主键统一命名为 `id`，类型 `bigint unsigned`，自增或雪花。
- DB3【Critical】`char` 定长用 `char`，变长用 `varchar`；`varchar` 长度不超过 5000。
- DB4【Critical】表必须有三字段：`gmt_create`、`gmt_modified`、`is_deleted`（或业务等价）。
- DB5【Critical】字段必须加注释 `COMMENT`；表必须加表注释。
- DB6【Major】`decimal` 禁用 `float`/`double` 存金额；字符串字段按需定长。
- DB7【Major】单表行数预估超 500 万或容量 2GB 需分库分表规划。
- DB8【Major】索引命名：主键 `pk_`、唯一 `uk_`、普通 `idx_`。

### 3.2 ORM 规约
- OR1【Blocker】`count(*)` 与 `count(列)` 语义不同，禁用 `count(列)` 替代全表计数。
- OR2【Critical】`in` 操作控制集合大小（建议 ≤ 1000）。
- OR3【Critical】禁止 `select *`，明确列名。
- OR4【Major】更新操作使用 `update ... where` 必须带条件，防全表更新。
- OR5【Major】`@Transactional` 不要应用在 private 方法上、不要在 try 中吞异常致回滚失效。
- OR6【Major】iBatis/MyBatis 的 `queryForList` 结果判空；`<sql>` 片段表名/列名用 `${}` 外其余用 `#{}`。

---

## 四、工程规约与安全

- EN1【Critical】应用分层：Controller/Web → Service/Manager → DAO/Mapper → DB。
- EN2【Major】`Manager` 层：通用业务、缓存、第三方封装；`Service`：业务编排。
- EN3【Critical】禁止在代码中硬编码密码、密钥、连接串、默认密码明文；使用配置/密钥管理。硬编码默认密码（如初始化密码）同样视为 Critical。
- EN4【Critical】用户输入必须校验与转义，防 SQL 注入与 XSS。
- EN5【Critical】分页参数必须有上限（如 pageSize ≤ 100），防大结果集攻击。
- EN6【Major】对外接口必须有幂等/限流考虑；返回统一错误码与结构。
