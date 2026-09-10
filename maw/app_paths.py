"""Shared paths for MSW user data and frozen-application configuration.

The source tree, frozen package, and the small helper processes all need to
agree on where user-owned data lives.  Keep this module dependency-free so it
can be imported by every entry point without pulling in GUI or runtime code.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Final


APP_DATA_DIRECTORY_NAME: Final = "MSW"
LEGACY_APP_DATA_DIRECTORY_NAME: Final = "MAW"
EMOJI_FONT_FILE_NAME: Final = "NotoColorEmoji.ttf"
SERVER_SETTINGS_FILE_NAME: Final = "server-editor-settings.json"
SOURCE_ROOT: Final = Path(__file__).resolve().parents[1]
ENV_PATH_OVERRIDE_VARIABLE: Final = "MAW_ENV_FILE"


def _migrate_legacy_app_data(root: Path) -> None:
    """把旧 ``MAW`` 数据目录一次性拷贝为 ``MSW``（项目改名的平滑迁移）。

    仅在 ``MSW`` 目录尚不存在而旧 ``MAW`` 目录存在时执行；拷贝失败静默跳过，
    旧目录保留不删，用户可手动回退。主题、服务器设置、日志等用户数据
    全部随之保留。
    """
    legacy = root.parent / LEGACY_APP_DATA_DIRECTORY_NAME
    try:
        if root.exists() or not legacy.is_dir():
            return
        import shutil
        shutil.copytree(legacy, root)
    except OSError:
        pass


def default_app_data_root() -> Path:
    """Return the writable MSW user-data root for the current platform.

    ``MSW_APP_DATA_ROOT`` (preferred) and the legacy ``MAW_APP_DATA_ROOT`` are
    process-level overrides for tests and portable deployments.  They are
    resolved so callers can use them as a stable path even when the override
    contains a relative component.
    """
    override = (os.environ.get("MSW_APP_DATA_ROOT") or os.environ.get("MAW_APP_DATA_ROOT", "")).strip()
    if override:
        return Path(override).expanduser().resolve(strict=False)
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    root = base / APP_DATA_DIRECTORY_NAME
    if not getattr(sys, "frozen", False):
        _migrate_legacy_app_data(root)
    return root


def application_directory() -> Path:
    """Return the directory containing the frozen executable.

    Source runs intentionally use ``SOURCE_ROOT`` for configuration.  The
    executable directory only matters after PyInstaller has set ``sys.frozen``
    and is then taken from ``sys.executable`` rather than ``_MEIPASS``.
    """
    if getattr(sys, "frozen", False):
        executable = str(getattr(sys, "executable", "") or "").strip()
        if executable:
            return Path(executable).expanduser().resolve(strict=False).parent
    return SOURCE_ROOT


def default_env_path() -> Path:
    """Return the default ``.env`` path for source and frozen executions.

    Development always keeps using the repository root ``.env``.  A frozen
    application first honors a file beside its executable, which is useful for
    portable releases, and otherwise uses the shared MSW user-data directory.
    """
    override = os.environ.get("MSW_ENV_FILE", os.environ.get(ENV_PATH_OVERRIDE_VARIABLE, "")).strip()
    if override:
        return Path(override).expanduser().resolve(strict=False)
    if not getattr(sys, "frozen", False):
        return SOURCE_ROOT / ".env"
    adjacent = application_directory() / ".env"
    if adjacent.is_file():
        return adjacent
    return (default_app_data_root() / ".env").resolve(strict=False)


def default_log_directory() -> Path:
    """Return the shared directory for ordinary and startup diagnostics."""
    return default_app_data_root() / "logs"


def default_emoji_font_path() -> Path:
    """Return the shared cache path for the Linux Noto Color Emoji font."""
    return default_app_data_root() / EMOJI_FONT_FILE_NAME


def default_server_settings_path() -> Path:
    """Return the shared server-editor settings path."""
    return default_app_data_root() / SERVER_SETTINGS_FILE_NAME


def legacy_server_settings_path() -> Path:
    """Return the pre-1.5 server-editor settings path for read-only fallback."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return base / "Moy" / "moys-asr-workflow" / SERVER_SETTINGS_FILE_NAME
