"""Atomic local output with short temporary names and actionable save errors."""

from __future__ import annotations

import errno
import os
import shutil
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from pathlib import Path


class FileSaveError(OSError):
    """Keep the OS cause while exposing a useful message to Launcher/editor UIs."""

    category = "file_write"

    def __init__(self, target: Path, cause: OSError, *, operation: str = "保存文件") -> None:
        self.target = target.absolute()
        self.diagnostic = f"{type(cause).__name__}: {cause}"
        windows = sys.platform == "win32"

        def path_length(value: str) -> int:
            return len(value.encode("utf-16-le", errors="surrogatepass")) // 2 if windows else len(value)

        # replace() reports the short temporary file as filename and the final
        # destination as filename2. Both paths matter for MAX_PATH failures.
        paths = [str(value) for value in (self.target, cause.filename, cause.filename2) if value]
        failed_path = max(paths, key=path_length)
        length = path_length(failed_path)
        winerror = getattr(cause, "winerror", None)
        long_path = cause.errno == errno.ENAMETOOLONG or winerror == 206 or (
            windows and length >= 260 and not failed_path.startswith("\\\\?\\")
            and cause.errno in {errno.ENOENT, errno.EINVAL}
        )
        if long_path:
            reason = (
                f"文件名或路径过长（失败路径 {length} 个字符），超出当前系统可访问的范围。"
                "请缩短媒体或输出文件名，或使用层级更浅的媒体／输出目录。"
            )
        elif winerror in {32, 33}:
            reason = "文件被其他程序占用。请关闭正在使用该文件的程序后重试。"
        elif cause.errno in {errno.ENOSPC, errno.EDQUOT} or winerror == 112:
            reason = "磁盘可用空间不足或已达到配额。请释放空间或改用其他输出磁盘。"
        elif cause.errno in {errno.EACCES, errno.EPERM, errno.EROFS}:
            reason = "没有写入权限、磁盘只读或文件被占用。请解除占用，或选择有写入权限的输出目录。"
        elif cause.errno in {errno.ENOTDIR, errno.EISDIR, errno.EEXIST}:
            reason = "输出路径存在文件与文件夹冲突。请检查同名文件／文件夹，或更换输出位置。"
        elif cause.errno == errno.ENOENT:
            reason = "找不到所需文件或目录。请检查来源文件、输出目录及磁盘／网络盘是否仍可用。"
        else:
            reason = f"无法写入输出文件，请检查输出位置和磁盘状态。系统错误：{cause.strerror or cause}"
        self.message = f"{operation}失败：{reason}\n目标：{self.target}"
        super().__init__(cause.errno, self.message, str(self.target))

    def __str__(self) -> str:
        return self.message


def ensure_output_directory(directory: Path) -> None:
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise FileSaveError(directory, error, operation="创建输出目录") from error


@contextmanager
def atomic_output_path(target: Path) -> Iterator[Path]:
    """Replace only after a complete write; temporary files stay on the same disk.

    Do not include the destination name in the temporary name: adding a random
    suffix to a valid long filename can exceed Windows MAX_PATH or NAME_MAX.
    """
    pending: Path | None = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(prefix=".msw-", suffix=".tmp", dir=target.parent)
        pending = Path(name)
        os.close(descriptor)
        yield pending
        os.replace(pending, target)
    except OSError as error:
        raise FileSaveError(target, error) from error
    finally:
        if pending is not None:
            # Cleanup must not hide the original save failure or touch target.
            with suppress(OSError):
                pending.unlink(missing_ok=True)


def atomic_write_text(
    target: Path, text: str, *, encoding: str = "utf-8", sync: bool = False,
) -> None:
    with atomic_output_path(target) as pending:
        with pending.open("w", encoding=encoding, newline="\n") as handle:
            handle.write(text)
            if sync:
                handle.flush()
                os.fsync(handle.fileno())


def atomic_copy(source: Path, target: Path) -> None:
    with atomic_output_path(target) as pending:
        shutil.copyfile(source, pending)
