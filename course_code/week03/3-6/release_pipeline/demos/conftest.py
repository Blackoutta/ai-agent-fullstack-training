"""demos/ 测试启动引导：把 release_pipeline/ 根目录加进 sys.path，
让每个 step 工程能复用顶层的 tools.py 与 config/tools.yaml。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
