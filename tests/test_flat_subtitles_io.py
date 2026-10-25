import io
import json
import unittest
from contextlib import redirect_stdout
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from maw.msw import flat_subtitles as core, flat_subtitles_io as codec, subtitle_tracks_io as old_io
from maw.msw import subtitle_tracks as old, subtitle_layers as layers
from maw.project_io import serialize_mosp, write_mosp


class FlatSubtitlesIOTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "合成工程.mosp"
        self.source = json.loads((Path(__file__).parent / "fixtures/msw_beta1_legacy_project.json").read_text(encoding="utf-8"))
        self.raw = b"\xef\xbb\xbf" + (json.dumps(self.source, ensure_ascii=False, indent=2).replace("\n", "\r\n") + "\r\n").encode("utf-8")
        self.path.write_bytes(self.raw)

    def test_read_upgrade_backup_reopen_and_native_edits(self):
        doc = codec.read_project(self.path)
        self.assertEqual(self.path.read_bytes(), self.raw)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])
        saved = codec.save_project(doc)
        self.assertEqual(saved.backup.read_bytes(), self.raw)
        self.assertEqual(codec.read_project(self.path).project, doc.project)
        self.assertEqual(doc.project["msw"], self.source["msw"])
        self.assertEqual(doc.project["media"], self.source["media"])
        self.assertNotIn(b"\r\n", self.path.read_bytes())
        changed = deepcopy(doc.project)
        changed["subtitles"]["tracks"][0].update(name="独立轨道", purpose="translation")
        again = codec.save_project(saved.document, changed)
        self.assertIsNone(again.backup)
        self.assertEqual(codec.read_project(self.path).project, changed)
        self.assertEqual(len(list(self.path.parent.glob(".msw-tracks-backup-*.mosp"))), 1)
        with self.assertRaisesRegex(ValueError, "其他程序修改"):
            codec.save_project(doc)

    def test_cancel_and_concurrent_save_preserve_original(self):
        for call in (1, 2):
            count = 0
            def cancelled():
                nonlocal count
                count += 1
                return count == call
            with self.assertRaises(codec.MigrationCancelled):
                codec.save_project(codec.read_project(self.path), cancelled=cancelled)
            self.assertEqual(self.path.read_bytes(), self.raw)
            self.assertFalse(list(self.path.parent.glob("*.lock")))
            self.assertFalse(list(self.path.parent.glob("*.tmp")))
        doc = codec.read_project(self.path)
        original_backup = old_io._backup
        def racing_backup(document):
            backup = original_backup(document)
            self.path.write_bytes(self.raw + b" ")
            return backup
        with patch.object(old_io, "_backup", side_effect=racing_backup):
            with self.assertRaisesRegex(ValueError, "其他程序修改"):
                codec.save_project(doc)
        self.assertEqual(self.path.read_bytes(), self.raw + b" ")

    def test_shared_lock_blocks_both_codecs(self):
        doc = codec.read_project(self.path)
        with old_io._writer_lock(self.path):
            for action in (lambda: codec.save_project(doc), lambda: old_io.save_project(old_io.read_project(self.path))):
                with self.assertRaisesRegex(ValueError, "写入任务"):
                    action()
            self.assertEqual(len(list(self.path.parent.glob("*.lock"))), 1)
        self.assertEqual(self.path.read_bytes(), self.raw)

    def test_backup_fsync_and_replace_errors_preserve_original(self):
        for target in ("maw.msw.subtitle_tracks_io._backup", "maw.msw.subtitle_tracks_io.os.fsync", "maw.file_io.os.replace"):
            with self.subTest(target=target):
                with patch(target, side_effect=OSError("模拟写入错误")):
                    with self.assertRaises(OSError):
                        codec.save_project(codec.read_project(self.path))
                self.assertEqual(self.path.read_bytes(), self.raw)
                self.assertFalse(list(self.path.parent.glob("*.lock")))

    def test_invalid_data_refused_without_backup_or_write(self):
        for raw in (b'{"segments":[],"segments":[]}', b'{"segments":[],"bad":NaN}',
                    b'{"schema":"msw.project.v5","segments":[]}', b'{"schema":"msw.project.v4","segments":[]}',
                    b'{"segments":[{"id":"a","start":0,"end":1000,"text":"x","items":{}}]}'):
            self.path.write_bytes(raw)
            with self.assertRaises(ValueError):
                codec.read_project(self.path)
            self.assertEqual(self.path.read_bytes(), raw)
        self.path.write_bytes(self.raw)
        doc = codec.read_project(self.path)
        doc.project["subtitles"]["cues"][0]["track_id"] = "missing"
        with self.assertRaises(ValueError):
            codec.save_project(doc)
        self.assertEqual(self.path.read_bytes(), self.raw)
        self.assertFalse(list(self.path.parent.glob(".msw-tracks-backup-*.mosp")))

    def test_production_and_legacy_codecs_cannot_downgrade_v4(self):
        stale = old_io.read_project(self.path)
        saved = codec.save_project(codec.read_project(self.path))
        with self.assertRaises(ValueError):
            old_io.read_project(self.path)
        with self.assertRaises(ValueError):
            old_io.save_project(stale)
        self.assertEqual(json.loads(serialize_mosp(saved.document.project))['subtitles'], saved.document.project['subtitles'])
        for source in (self.source, layers.migrate_project(self.source), old.migrate_project(self.source)):
            with self.assertRaises(ValueError):
                write_mosp(self.path, source)
            self.assertEqual(self.path.read_bytes(), saved.document.original)

    def test_prevalidated_new_snapshot_still_checks_original_and_disk_conflicts(self):
        value = codec.read_project(self.path).project
        for raw in (b'{"schema":"msw.project.v5"}', b'{"schema":"msw.project.v4","subtitles":{}}', b'[]'):
            self.path.write_bytes(raw)
            document = codec.FlatDocument(self.path, raw, value)
            with self.assertRaises(ValueError):
                codec.save_project(document, value, _validated=True)
            self.assertEqual(self.path.read_bytes(), raw)
        self.path.write_bytes(self.raw)
        document = codec.read_project(self.path)
        self.path.write_bytes(self.raw + b' ')
        with self.assertRaisesRegex(ValueError, '其他程序修改'):
            codec.save_project(document, value, _validated=True)

    def test_cli_is_readonly_by_default_and_write_is_explicit(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(codec.main([str(self.path)]), 0)
        self.assertEqual(self.path.read_bytes(), self.raw)
        self.assertIn("原文件未修改", output.getvalue())
        self.assertIn("普通编辑器", output.getvalue())
        with redirect_stdout(output):
            self.assertEqual(codec.main([str(self.path), "--write-v4"]), 0)
        self.assertEqual(codec.read_project(self.path).project["schema"], core.SCHEMA)
