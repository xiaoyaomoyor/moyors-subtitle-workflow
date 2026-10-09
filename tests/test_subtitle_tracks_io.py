from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from maw.msw import subtitle_tracks as core
from maw.msw import subtitle_tracks_io as codec
from maw.msw import subtitle_layers as layers
from maw.project import validate_project
from maw.project_io import serialize_mosp, write_mosp

FIXTURES = Path(__file__).parent / "fixtures"


class SubtitleTracksIOTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "测试工程.mosp"
        self.source = json.loads((FIXTURES / "msw_beta1_legacy_project.json").read_text(encoding="utf-8"))
        # Deliberately keep BOM and CRLF in the backup, while v3 output uses LF.
        self.raw = b"\xef\xbb\xbf" + (json.dumps(self.source, ensure_ascii=False, indent=2).replace("\n", "\r\n") + "\r\n").encode("utf-8")
        self.path.write_bytes(self.raw)

    def test_read_save_reopen_preserves_backup_media_assets_and_source_refs(self):
        doc = codec.read_project(self.path)
        self.assertEqual(self.path.read_bytes(), self.raw)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])
        saved = codec.save_project(doc)
        self.assertEqual(saved.backup.read_bytes(), self.raw)
        self.assertEqual(codec.read_project(self.path).project, doc.project)
        self.assertEqual(saved.document.project, doc.project)
        self.assertEqual(doc.project["msw"], self.source["msw"])
        self.assertEqual(doc.project["media"], self.source["media"])
        self.assertNotIn(b"\r\n", self.path.read_bytes())

    def test_fixed_presentation_style_and_positions_roundtrip_without_external_presets(self):
        doc = codec.read_project(self.path)
        doc.project["subtitle_tracks"]["presentation"] = "fixed"
        track = doc.project["subtitle_tracks"]["tracks"][0]
        snapshot = dict(schema="msw.subtitle-style.v1", main=dict(fontSize=64), secondary=dict(fontSize=42),
                        pairLayout=dict(order="secondary-above", gap=-12))
        track.update(kind="annotation", style=dict(mode="snapshot", value=snapshot, custom=snapshot, selection="current"),
                     position=dict(x=0.4, y=0.1))
        for row in core.TrackIndex(doc.project).records(include_hidden=True):
            row["cue"]["subtitle_position"] = dict(x=0.6, y=0.2)
        saved = codec.save_project(doc)
        reopened = codec.read_project(saved.document.path)
        self.assertEqual(reopened.project, doc.project)
        self.assertEqual(saved.backup.read_bytes(), self.raw)
        saved.document.project["subtitle_tracks"]["tracks"][0].update(name="对白 A", locked=True, collapsed=True)
        again = codec.save_project(saved.document)
        self.assertIsNone(again.backup)
        self.assertEqual(len(list(self.path.parent.glob(".msw-tracks-backup-*.mosp"))), 1)
        self.assertEqual(codec.read_project(self.path).project, again.document.project)
        with self.assertRaisesRegex(ValueError, "其他程序修改"):
            codec.save_project(doc)

    def test_v2_roundtrip_does_not_normalize_or_modify_content(self):
        for fixture in json.loads((FIXTURES / "subtitle-tracks.json").read_text(encoding="utf-8")):
            with self.subTest(fixture=fixture["name"]):
                self.path.write_text(json.dumps(fixture["project"]), encoding="utf-8")
                doc = codec.read_project(self.path)
                codec.save_project(doc)
                self.assertEqual(codec.read_project(self.path).project, doc.project)

    def test_cancel_before_backup_or_after_pending_write_never_replaces_source(self):
        for cancel_call in (1, 2):
            with self.subTest(cancel_call=cancel_call):
                count = 0

                def cancel():
                    nonlocal count
                    count += 1
                    return count == cancel_call

                with self.assertRaises(codec.MigrationCancelled):
                    codec.save_project(codec.read_project(self.path), cancelled=cancel)
                self.assertEqual(self.path.read_bytes(), self.raw)
                self.assertEqual(list(self.path.parent.glob("*.tmp")), [])
                self.assertEqual(list(self.path.parent.glob("*.lock")), [])

    def test_backup_or_replace_failure_never_damages_original(self):
        for target in ("_backup", "os.replace"):
            with self.subTest(target=target):
                doc = codec.read_project(self.path)
                patched = "maw.msw.subtitle_tracks_io._backup" if target == "_backup" else "maw.file_io.os.replace"
                with patch(patched, side_effect=OSError("模拟磁盘错误")):
                    with self.assertRaises(OSError):
                        codec.save_project(doc)
                self.assertEqual(self.path.read_bytes(), self.raw)

    def test_backup_fsync_failure_stops_before_replace(self):
        with patch("maw.msw.subtitle_tracks_io.os.fsync", side_effect=OSError("模拟写入错误")):
            with self.assertRaisesRegex(OSError, "备份旧工程"):
                codec.save_project(codec.read_project(self.path))
        self.assertEqual(self.path.read_bytes(), self.raw)

    def test_external_save_before_or_during_migration_is_not_overwritten(self):
        newer = self.raw + b" "
        doc = codec.read_project(self.path)
        self.path.write_bytes(newer)
        with self.assertRaisesRegex(ValueError, "其他程序修改"):
            codec.save_project(doc)
        self.assertEqual(self.path.read_bytes(), newer)
        self.path.write_bytes(self.raw)
        original_backup = codec._backup

        def backup_then_external_save(document):
            backup = original_backup(document)
            self.path.write_bytes(newer)
            return backup

        with patch.object(codec, "_backup", side_effect=backup_then_external_save):
            with self.assertRaisesRegex(ValueError, "其他程序修改"):
                codec.save_project(doc)
        self.assertEqual(self.path.read_bytes(), newer)

    def test_exclusive_writer_does_not_remove_another_writers_lock(self):
        doc = codec.read_project(self.path)
        with codec._writer_lock(self.path):
            with self.assertRaisesRegex(ValueError, "已有固定轨道写入任务"):
                codec.save_project(doc)
            self.assertEqual(len(list(self.path.parent.glob("*.lock"))), 1)
        self.assertEqual(self.path.read_bytes(), self.raw)

    def test_invalid_migration_or_json_rejects_without_writing(self):
        invalid = [b'{"segments":[],"segments":[]}', b'{"segments":[],"x":NaN}',
                   b'{"schema":"msw.project.v4","segments":[]}',
                   b'{"schema":"msw.project.v2","segments":[],"subtitle_layers":{"legacy_overlay":null}}',
                   b'{"segments":[{"id":"a","start":0,"end":1000,"text":"x","items":{}}]}']
        for raw in invalid:
            with self.subTest(raw=raw):
                self.path.write_bytes(raw)
                with self.assertRaises(ValueError):
                    codec.read_project(self.path)
                self.assertEqual(self.path.read_bytes(), raw)
                self.assertFalse(list(self.path.parent.glob(".msw-tracks-backup-*.mosp")))

    def test_invalid_save_fails_before_backup_and_production_accepts_valid_v3(self):
        doc = codec.read_project(self.path)
        self.assertTrue(validate_project(doc.project).ok)
        self.assertEqual(json.loads(serialize_mosp(doc.project))["subtitle_tracks"], doc.project["subtitle_tracks"])
        doc.project["subtitle_tracks"]["assignments"].clear()
        with self.assertRaises(ValueError):
            codec.save_project(doc)
        self.assertEqual(self.path.read_bytes(), self.raw)
        self.assertFalse(list(self.path.parent.glob(".msw-tracks-backup-*.mosp")))

    def test_stale_v1_and_v2_writers_cannot_overwrite_upgraded_file(self):
        saved = codec.save_project(codec.read_project(self.path))
        for source in (self.source, layers.migrate_project(self.source)):
            with self.subTest(schema=source.get("schema")):
                with self.assertRaisesRegex(ValueError, "不能用旧版结构"):
                    write_mosp(self.path, source)
                self.assertEqual(self.path.read_bytes(), saved.document.original)

    def test_cli_defaults_to_dry_run_and_requires_explicit_write(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(codec.main([str(self.path)]), 0)
        self.assertEqual(self.path.read_bytes(), self.raw)
        self.assertIn("原文件未修改", output.getvalue())
        with redirect_stdout(output):
            self.assertEqual(codec.main([str(self.path), "--write"]), 0)
        self.assertEqual(codec.read_project(self.path).project["schema"], core.SCHEMA)
