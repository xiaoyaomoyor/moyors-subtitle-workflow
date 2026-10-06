from __future__ import annotations

import errno
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from maw.file_io import FileSaveError, atomic_copy, atomic_write_text, ensure_output_directory
from maw.postprocess_io import _atomic_write
from maw.project_io import write_mosp


class FileIoTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def long_target(self) -> Path:
        padding = 173 - len(str(self.root)) - 1
        if padding < 1:
            self.skipTest("test temporary root leaves no room for the 248-character fixture")
        parent = self.root / ("d" * padding)
        return parent / ("x" * 69 + ".mosp")

    def test_248_character_target_survives_write_copy_and_project_save(self) -> None:
        target = self.long_target()
        self.assertEqual(len(str(target)), 248)
        # The old .<target-name>.<random>.tmp path was 262 characters.
        self.assertEqual(len(str(target.parent / ("." + target.name + ".12345678.tmp"))), 262)
        _atomic_write(target, "字幕\n")
        self.assertEqual(target.read_bytes(), "字幕\n".encode("utf-8"))
        source = self.root / "source"
        source.write_bytes(b"copied\n")
        atomic_copy(source, target)
        self.assertEqual(target.read_bytes(), b"copied\n")
        target.write_text('{"segments": []}', encoding="utf-8")
        write_mosp(target, {"segments": []})
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["schema"], "moy.asr.project.v1")
        from maw.msw.subtitle_layers import migrate_project
        write_mosp(target, migrate_project({"segments": []}))
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["schema"], "msw.project.v2")
        self.assertFalse(list(target.parent.glob("*.tmp")))

    @unittest.skipIf(sys.platform == "win32", "Windows full-path limit is covered separately")
    def test_valid_near_name_max_filename_does_not_lengthen_temp_name(self) -> None:
        target = self.root / ("x" * 243 + ".mosp")
        atomic_write_text(target, "ok")
        self.assertEqual(target.read_text(), "ok")

    @unittest.skipUnless(sys.platform == "win32", "exercises the Windows file API")
    def test_windows_overlong_destination_reports_path_limit_or_saves_if_supported(self) -> None:
        target = self.long_target().with_name("x" * 95 + ".mosp")
        self.assertGreater(len(str(target)), 260)
        try:
            atomic_write_text(target, "ok")
        except FileSaveError as error:
            self.assertIn("路径过长", str(error))
            self.assertIn(str(target), str(error))
            self.assertIn(str(len(str(target))), str(error))
        else:
            # Long-path-aware Windows installations need not reject this path.
            self.assertEqual(target.read_text(), "ok")
        self.assertFalse(list(target.parent.glob("*.tmp")))

    def test_srt_keeps_utf8_bom_and_lf(self) -> None:
        target = self.root / "subtitle.srt"
        _atomic_write(target, "字幕\n")
        self.assertEqual(target.read_bytes(), b"\xef\xbb\xbf" + "字幕\n".encode("utf-8"))

    def test_replacement_failure_preserves_existing_file_and_cleans_temp(self) -> None:
        target = self.root / "project.mosp"
        target.write_bytes(b"original")
        cause = PermissionError(errno.EACCES, "Access denied", str(target))
        with mock.patch("maw.file_io.os.replace", side_effect=cause):
            with self.assertRaises(FileSaveError) as raised:
                atomic_write_text(target, "new")
        self.assertIn("写入权限", str(raised.exception))
        self.assertIn(str(target), str(raised.exception))
        self.assertIs(raised.exception.__cause__, cause)
        self.assertEqual(target.read_bytes(), b"original")
        self.assertEqual(list(self.root.iterdir()), [target])

    def test_sync_failure_preserves_existing_file(self) -> None:
        target = self.root / "project.mosp"
        target.write_bytes(b"original")
        cause = OSError(errno.ENOSPC, "No space left")
        with mock.patch("maw.file_io.os.fsync", side_effect=cause):
            with self.assertRaisesRegex(FileSaveError, "磁盘可用空间不足"):
                atomic_write_text(target, "new", sync=True)
        self.assertEqual(target.read_bytes(), b"original")
        self.assertEqual(list(self.root.iterdir()), [target])

    def test_temp_creation_errors_report_specific_reason(self) -> None:
        target = self.root / "project.mosp"
        for number, expected in (
            (errno.ENOSPC, "磁盘可用空间不足"),
            (errno.EACCES, "写入权限"),
            (errno.ENOENT, "磁盘／网络盘"),
            (errno.ENAMETOOLONG, "路径过长"),
            (errno.EIO, "系统错误"),
        ):
            with self.subTest(errno=number):
                cause = OSError(number, "test OS error", str(target))
                with mock.patch("maw.file_io.tempfile.mkstemp", side_effect=cause):
                    with self.assertRaisesRegex(FileSaveError, expected) as raised:
                        atomic_write_text(target, "new")
                self.assertEqual(raised.exception.errno, number)
                self.assertIs(raised.exception.__cause__, cause)
                self.assertIn(str(target), str(raised.exception))
        self.assertEqual(list(self.root.iterdir()), [])

    def test_windows_enoent_on_long_path_is_not_reported_as_missing_input(self) -> None:
        target = self.root / ("long" * 70) / "project.mosp"
        cause = FileNotFoundError(errno.ENOENT, "No such file or directory", str(target))
        with mock.patch("maw.file_io.sys.platform", "win32"):
            error = FileSaveError(target, cause)
        self.assertIn("路径过长", str(error))
        self.assertIn(str(len(str(target))), str(error))
        self.assertIn("缩短媒体", str(error))
        self.assertNotIn("找不到所需文件", str(error))
        # A short missing path still needs the directory/disk advice.
        short = self.root / "missing.mosp"
        self.assertIn("找不到所需文件", str(FileSaveError(short, FileNotFoundError(errno.ENOENT, "missing", str(short)))))

    def test_windows_error_codes_and_unicode_length(self) -> None:
        target = self.root / ("字幕🎬" * 70) / "project.mosp"
        cause = OSError(errno.EINVAL, "filename range", str(target))
        cause.winerror = 206
        with mock.patch("maw.file_io.sys.platform", "win32"):
            message = str(FileSaveError(target, cause))
        self.assertIn(str(len(str(target).encode("utf-16-le")) // 2), message)
        self.assertIn("路径过长", message)
        cause.winerror = 32
        cause.errno = errno.EACCES
        self.assertIn("其他程序占用", str(FileSaveError(target, cause)))

    def test_replace_error_checks_long_destination_not_only_short_temp(self) -> None:
        target = self.root / ("long" * 70) / "project.mosp"
        pending = self.root / ".msw-test.tmp"
        cause = FileNotFoundError(errno.ENOENT, "No such file or directory", str(pending))
        cause.filename2 = str(target)
        with mock.patch("maw.file_io.sys.platform", "win32"):
            error = FileSaveError(target, cause)
        self.assertIn("路径过长", str(error))
        self.assertIn(str(target), str(error))

    def test_directory_conflict_has_actionable_error(self) -> None:
        conflict = self.root / "not-a-directory"
        conflict.write_bytes(b"keep")
        with self.assertRaisesRegex(FileSaveError, "文件与文件夹冲突"):
            ensure_output_directory(conflict)
        self.assertEqual(conflict.read_bytes(), b"keep")

    def test_cleanup_failure_does_not_mask_original_save_error(self) -> None:
        target = self.root / "project.mosp"
        cause = OSError(errno.ENOSPC, "disk full")
        with mock.patch("maw.file_io.os.replace", side_effect=cause), mock.patch.object(
            Path, "unlink", side_effect=PermissionError("cleanup failed"),
        ):
            with self.assertRaisesRegex(FileSaveError, "磁盘可用空间不足") as raised:
                atomic_write_text(target, "new")
        self.assertIs(raised.exception.__cause__, cause)
        self.assertFalse(target.exists())
