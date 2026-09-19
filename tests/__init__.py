# T0（第三轮审查 §2.3）：测试会话隔离——所有未显式注入路径的持久数据
# （工程登记、最近记录默认位、封面缓存、日志默认位）统一落入本次运行的临时根，
# 杜绝测试写进真实用户目录。子进程（编辑器 Server 等）经 os.environ 继承。
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


# 在任何 maw 模块读取默认路径前就位（default_app_data_root 每次调用时读环境）。
TEST_APP_DATA_ROOT: Path = _ensure_isolated_app_data_root()
