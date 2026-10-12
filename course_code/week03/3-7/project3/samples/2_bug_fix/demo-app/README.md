# bug-fix-demo

3.7 v2 任务二（测试生成与修复）的样本仓库。

- `src/auth/session-policy.ts` 里有一个真实缺陷：过期判断按「日」做字符串比较
  （`expiresAt.slice(0, 10) < now.slice(0, 10)`），同一天内的过期不会被判为已过期。
- `tests/session-boundary.test.ts` 的 3 个用例按「秒级时刻」要求行为，因此失败。
- 预期：修复前 `node --test` 结果 7 tests / 4 pass / 3 fail；修复后 7 pass。

运行：

```bash
npm test            # 需要本机 node >= 22.19；node_modules 是指向 ../../../harness_agent/node_modules 的软链
```
