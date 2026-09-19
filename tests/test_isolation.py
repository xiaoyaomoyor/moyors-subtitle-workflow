# T0 兜底：`unittest discover -s tests` 以 tests/ 为顶层目录加载各测试模块，
# 不会导入 tests 包 → tests/__init__.py 的会话隔离在 discover 模式下不生效。
# unittest 在收集阶段先导入全部匹配模块再执行，本模块的导入时副作用因此
# 早于任何测试运行，为两种加载模式（包限定 / discover 顶层）统一补上
# MSW_APP_DATA_ROOT 隔离覆写（幂等：已有覆写则尊重，不重复建根）。
from __future__ import annotations

import os
import tempfile
from pathlib import Path

_OVERRIDE_NAMES = ("MSW_APP_DATA_ROOT", "MAW_APP_DATA_ROOT")


def _ensure_isolated_app_data_root() -> Path:
    for name in _OVERRIDE_NAMES:
        if os.environ.get(name, "").strip():
            return Path(os.environ[name]).expanduser().resolve(strict=False)
    root = Path(tempfile.mkdtemp(prefix="msw-test-appdata-"))
    os.environ["MSW_APP_DATA_ROOT"] = str(root)
    return root


TEST_APP_DATA_ROOT: Path = _ensure_isolated_app_data_root()
