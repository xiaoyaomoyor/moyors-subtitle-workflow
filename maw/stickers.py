"""表情包目录配置读取（转写 CLI 与便携编辑器共用）。

转写 CLI 只需要「默认表情包目录」这一个配置项，历史上它定义在 ``edit.py``
里，于是 ``from edit import get_default_sticker_dir`` 会把整个编辑器生成器
（含 ``maw.reapeaks`` 的 Rust 波形内核）拖进每个转写入口。托管 Runtime 里只要
缺这个内核，转写就会在加载模型之前崩掉，所以这两个助手必须是叶子模块：只依赖
标准库和 ``maw.app_paths``。
"""

from __future__ import annotations

import os
from pathlib import Path

from maw.app_paths import default_env_path


def apply_msw_env_aliases(env: dict[str, str] | None = None) -> None:
    """MSW_* 环境变量别名：读到 ``MSW_X`` 时补写 ``MAW_X``（代码读取侧不变）。

    项目品牌由 MAW 改为 MSW 后，环境变量以 ``MSW_*`` 为正式写法；为了不破坏
    既有 ``.env`` 与脚本，代码内部仍按 ``MAW_*`` 读取，这里在进程入口把
    ``MSW_*`` 的值同步到 ``MAW_*``（仅在后者未显式设置时），两种写法的用户
    配置都能工作。
    """
    targets = [os.environ] if env is None else [env]
    for scope in targets:
        for key in [k for k in list(scope) if k.startswith("MSW_")]:
            legacy_key = "MAW_" + key[len("MSW_"):]
            if legacy_key not in scope or not str(scope[legacy_key]).strip():
                scope[legacy_key] = scope[key]


def load_env(path: Path | None = None) -> dict[str, str]:
    """读取 MSW .env 文件，返回 key=value 字典。

    零依赖实现（不引入 python-dotenv）。仅做简单 KEY=VALUE 解析，
    忽略空行和 # 注释行。调用方若需系统环境变量优先，请用 os.getenv 覆盖。
    文件不存在时返回空字典。``MSW_*`` 键会自动补写同名 ``MAW_*`` 别名。
    """
    env_path = Path(path) if path is not None else default_env_path()
    if not env_path.exists():
        return {}
    result: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        result[k.strip()] = v.strip()
    apply_msw_env_aliases(result)
    return result


def get_default_sticker_dir() -> str | None:
    """获取默认表情包目录。

    优先级：系统环境变量 STICKER_DIR > .env 文件里的 STICKER_DIR。
    未配置时返回 None。
    """
    env = load_env()
    return os.getenv("STICKER_DIR") or env.get("STICKER_DIR") or None


__all__ = ["get_default_sticker_dir", "load_env"]
