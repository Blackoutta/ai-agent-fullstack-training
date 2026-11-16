"""入口脚本自动读取 config/local.env，新终端不必先 source。

优先级：已经在环境里的变量优先，文件只补空缺，不会覆盖手工 export 的值。
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT/'config/local.env'


def load_env(path=DEFAULT):
    path = Path(path)
    if not path.exists():
        return None
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('\'"'))
    return path
