"""Choose Windows runtime paths usable by dependencies with narrow file APIs."""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import hashlib
import os
from pathlib import Path
import sys
import tempfile

from maw.runtimes import winsecurity


FALLBACK_ROOT_ENV = "MSW_RUNTIME_ASCII_ROOT"
FALLBACK_PREFIX = "MSW-runtimes-"


class AsciiRootUnavailable(OSError):
    """The shared Windows runtime location cannot be selected or trusted."""


def _short_path(path: Path) -> Path:
    short = ctypes.WinDLL("kernel32", use_last_error=True).GetShortPathNameW
    short.argtypes = (wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD)
    short.restype = wintypes.DWORD
    size = short(str(path), None, 0)
    if not size:
        raise ctypes.WinError(ctypes.get_last_error())
    buffer = ctypes.create_unicode_buffer(size)
    length = short(str(path), buffer, size)
    if not 0 < length < size:
        raise OSError("无法取得运行环境目录短路径")
    return Path(buffer.value)


def ascii_alias(path: Path) -> Path:
    if sys.platform != "win32" or str(path).isascii():
        return path
    # A new install can reuse an existing ancestor's alias if the rest of the
    # path is ASCII. The Windows API also succeeds when it returns a long name.
    for ancestor in (path, *path.parents):
        if not ancestor.is_dir():
            continue
        try:
            alias = _short_path(ancestor)
            candidate = alias / path.relative_to(ancestor)
            if str(candidate).isascii() and alias.samefile(ancestor):
                return candidate
        except OSError:
            continue
        break
    return path


def _fallback_root(dir_name: str) -> Path:
    override = os.environ.get(FALLBACK_ROOT_ENV, os.environ.get("MAW_RUNTIME_ASCII_ROOT", "")).strip()
    base = override or os.environ.get("PROGRAMDATA", "").strip()
    if not base:
        raise AsciiRootUnavailable(f"找不到 Windows 公共目录。请设置 {FALLBACK_ROOT_ENV} 为个人 ASCII 目录。")
    # Preserve all directory components for the reparse-point check.
    parent = Path(os.path.abspath(Path(base).expanduser()))
    if not str(parent).isascii():
        raise AsciiRootUnavailable(f"公共运行环境目录需为 ASCII 路径。请检查 {FALLBACK_ROOT_ENV}。")
    try:
        sid = winsecurity.current_user_sid()
    except OSError as error:
        raise AsciiRootUnavailable("无法确认当前 Windows 用户。请在运行环境设置中指定个人 ASCII 目录。") from error
    account = hashlib.sha256(sid.encode("ascii")).hexdigest()[:16]
    return parent / (FALLBACK_PREFIX + account) / dir_name


def _validate_fallback(root: Path, *, create: bool = False) -> None:
    try:
        winsecurity.private_runtime_root(root, create=create)
        if create:
            # Test write access using a new name so repairs cannot touch an
            # existing file or another install's probe.
            with tempfile.TemporaryFile(dir=root):
                pass
    except OSError as error:
        raise AsciiRootUnavailable(
            f"无法安全使用公共运行环境目录：{root}。请检查目录权限，或设置 {FALLBACK_ROOT_ENV} 为个人 ASCII 目录。"
        ) from error


def resolve_root(path: Path, *, dir_name: str, default: bool = False) -> Path:
    if sys.platform != "win32":
        return path
    preferred = ascii_alias(path)
    needs_fallback = default and not str(preferred).isascii()
    if not needs_fallback and not preferred.parent.name.casefold().startswith(FALLBACK_PREFIX.casefold()):
        return preferred
    # Paths returned in status payloads may be passed back explicitly. Check a
    # previously selected fallback before any canonicalization or worker start.
    try:
        fallback = _fallback_root(dir_name)
    except AsciiRootUnavailable:
        if needs_fallback:
            raise
        return preferred
    if preferred == fallback or needs_fallback:
        _validate_fallback(fallback)
        return fallback
    return preferred


def prepare_install_root(root: Path, *, dir_name: str) -> None:
    if sys.platform != "win32" or not root.parent.name.casefold().startswith(FALLBACK_PREFIX.casefold()):
        return
    try:
        fallback = _fallback_root(dir_name)
    except AsciiRootUnavailable:
        return
    if root == fallback:
        _validate_fallback(root, create=True)


def verify_hint(root: Path) -> str:
    if sys.platform == "win32" and not str(root).isascii():
        return " 运行环境路径含非 ASCII 字符。请在「设置 → 运行环境」中选择纯 ASCII 目录后重试。"
    return ""
