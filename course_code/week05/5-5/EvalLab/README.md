npm run cli                          # 直接进 pi 交互界面
npm run cli -- -p "把登录逻辑写成说明文档"   # pi 的非交互模式
npm run cli -- --dir /path/to/repo    # 指定工作仓库
npm run cli -- agent "..."            # 原有子命令不受影响
npm run cli -- tasks                  # 同理

- spawn 时带`--no-extensions --extension src/pi/coding-agent-extension.ts` ，关掉`~/.pi` 的扩展自动发现，只挂本项目治理扩展
- `stdio: "inherit"` ，退出码透传给当前进程