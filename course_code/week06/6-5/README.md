# Agent 发布演示

需要 Python 3.9+。真实调用需要已经能正常使用模型的 Pi CLI。先在终端运行 `pi --version`，再用 Pi 确认模型连接可用。

A 和 B 使用同一个模型。Skill A 输出纯文本 READY，Skill B 输出 JSON。稳定组和试点组代表后端已分配的两组请求。本演示用命令参数模拟这个分组。

```bash
python3 release.py rollback
python3 release.py run stable
python3 release.py check b
python3 release.py status
python3 release.py publish
python3 release.py run pilot
python3 release.py run stable
python3 release.py rollback
python3 release.py run pilot
```

预期结果依次是路由 A/A、A 的 READY、B 的 JSON、路由 A/A、路由 A/B、试点 B 的 JSON、稳定 A 的 READY、路由 A/A、试点 A 的 READY。真实调用完成后，程序按版本验收响应格式，成功显示 PASS。

发布前先执行 check b，它绕过线上分组直接验证候选版。publish 和 rollback 仅写本地路由文件。给 check 或 run 加上 --offline，可先排练路径和版本选择，此时程序输出所选 Skill，跳过模型调用与输出验收。

Pi CLI 参数参考 [官方文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md)。
