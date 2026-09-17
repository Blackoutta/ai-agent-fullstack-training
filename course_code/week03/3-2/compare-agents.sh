#!/usr/bin/env bash
# 用同一条提示词依次运行 Codebase Agent 与 Planning Agent，
# 并把两次运行过程与结果分别写入 codebase.md 和 planning.md。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEBASE_DIR="$ROOT_DIR/codebase_agent_demo"
PLANNING_DIR="$ROOT_DIR/planning_agent_demo"

PROMPT="请修复登录模块的会话过期边界问题：先定位登录和会话相关代码，复现失败测试，分析根因，只修改必要源码，然后运行目标测试、边界测试和回归测试，最后把根因、改动和验证结果写入 artifacts/login-fix.md。"

if [[ $# -gt 0 ]]; then
  PROMPT="$*"
fi

FENCE="\`\`\`"

printf "%s\n" "=================================================="
printf "%s\n" "统一提示词"
printf "%s\n" "$PROMPT"
printf "%s\n\n" "=================================================="

run_agent() {
  local title="$1"
  local workdir="$2"
  local outfile="$3"
  local extra_env="${4:-}"
  local started finished status

  started="$(date "+%Y-%m-%d %H:%M:%S")"

  {
    printf "# %s\n\n" "$title"
    printf -- "- 提示词：%s\n" "$PROMPT"
    printf -- "- 工作目录：%s\n" "$workdir"
    printf -- "- 开始时间：%s\n\n" "$started"
    printf "## 运行过程\n\n"
    printf "%s\ntext\n" "$FENCE"
  } > "$outfile"

  printf "%s\n" "#################### $title ####################"
  printf "开始时间：%s\n\n" "$started"

  ( cd "$workdir" && env $extra_env npm start -- "$PROMPT" ) 2>&1 | tee -a "$outfile"
  status=${PIPESTATUS[0]}

  finished="$(date "+%Y-%m-%d %H:%M:%S")"

  {
    printf "%s\n\n" "$FENCE"
    printf -- "- 结束时间：%s\n" "$finished"
    printf -- "- 退出码：%s\n" "$status"
  } >> "$outfile"

  printf "\n%s 结束时间：%s（退出码 %s）\n" "$title" "$finished" "$status"
  printf "结果已写入：%s\n\n" "$outfile"
}

run_agent "Codebase Agent 运行记录" "$CODEBASE_DIR" "$ROOT_DIR/codebase.md" "CODEBASE_MODE=repair"
run_agent "Planning Agent 运行记录" "$PLANNING_DIR" "$ROOT_DIR/planning.md"

printf "%s\n" "=================================================="
printf "%s\n" "两个 Agent 已执行完成"
printf "对比文件：%s\n" "$ROOT_DIR/codebase.md"
printf "对比文件：%s\n" "$ROOT_DIR/planning.md"
printf "%s\n" "=================================================="
