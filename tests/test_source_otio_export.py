"""Source OTIOZ packs only bound media and validated relative sticker files."""
import copy
import io
import json
import tempfile
import unittest
import zipfile
from dataclasses import replace
from pathlib import Path

from test_local_editor_server import server_editor


def clip(relative=None):
    return {
        "OTIO_SCHEMA": "Clip.2",
        "metadata": {"moy": {"sticker_rel": relative}} if relative is not None else {},
        "source_range": {"duration": {"rate": 24}},
        "media_references": {"DEFAULT_MEDIA": {
            "OTIO_SCHEMA": "ExternalReference.1", "target_url": "file:///never/read/client/path",
        }},
    }


class SourceOtioExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.media = self.root / "中文 素材.png"
        self.media.write_bytes(b"bound-source")
        self.stickers = self.root / "stickers"
        for folder in ("a", "b"):
            (self.stickers / folder).mkdir(parents=True)
            (self.stickers / folder / self.media.name).write_bytes(folder.encode())
        path = self.root / "project.mosp"
        bound_audio = self.root / "source.wav"
        bound_audio.write_bytes(b"bound-source")
        path.write_text(json.dumps({"media": str(bound_audio), "segments": []}), encoding="utf-8")
        self.project = server_editor.load_project(path, None, str(self.stickers), no_waveform=True, peaks_per_second=100)
        # Exercise archive collision handling independently of the loader's
        # media extension allowlist (normal projects bind audio/video).
        self.project = replace(self.project, source_media_path=self.media)

    def export(self, clips, root=True):
        timeline = {"OTIO_SCHEMA": "Timeline.1", "tracks": {"children": [{"children": clips}]}}
        before = copy.deepcopy(timeline)
        result = server_editor.export_timeline_otioz(self.project, "source", timeline, self.stickers if root else None)
        self.assertEqual(timeline, before)
        return zipfile.ZipFile(io.BytesIO(result[0]))

    def test_deduplicates_images_preserves_unicode_and_avoids_source_name_collision(self):
        with self.export([clip(), clip("a/中文 素材.png"), clip("b/中文 素材.png"), clip("a/中文 素材.png")]) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), {"content.otio", "version.txt", "media/中文 素材.png", "media/中文 素材-2.png", "media/中文 素材-3.png"})
            self.assertEqual(archive.read("media/中文 素材.png"), b"bound-source")
            self.assertEqual(archive.read("media/中文 素材-2.png"), b"a")
            self.assertEqual(archive.read("media/中文 素材-3.png"), b"b")
            clips = json.loads(archive.read("content.otio"))["tracks"]["children"][0]["children"]
            refs = [item["media_references"]["DEFAULT_MEDIA"] for item in clips]
            self.assertEqual(refs[1]["target_url"], refs[3]["target_url"])
            self.assertEqual(refs[1]["available_range"]["duration"], {"OTIO_SCHEMA": "RationalTime.1", "rate": 24, "value": 1})
            for ref in refs:
                self.assertIn(ref["target_url"], archive.namelist())

    def test_rejects_missing_outside_and_non_image_stickers_without_reading_client_url(self):
        for relative in ("../中文 素材.png", str(self.media), "missing.png", "a/config.env", "", 1):
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                self.export([clip(), clip(relative)])
        with self.assertRaisesRegex(ValueError, "根目录"):
            self.export([clip(), clip("a/中文 素材.png")], root=False)

    def test_rejects_invalid_sticker_references_and_sticker_only_source_export(self):
        for references in ({}, None, {"invalid": {}}, {"invalid": "text"}):
            sticker = clip("a/中文 素材.png")
            sticker["media_references"] = references
            with self.subTest(references=references), self.assertRaisesRegex(ValueError, "有效媒体引用"):
                self.export([clip(), sticker])
        with self.assertRaisesRegex(ValueError, "没有可打包的媒体引用"):
            self.export([clip("a/中文 素材.png")])

    def test_invalid_still_image_rate_uses_finite_default(self):
        for rate in (True, 0, -1, float("inf"), float("nan"), "24"):
            sticker = clip("a/中文 素材.png")
            sticker["source_range"]["duration"]["rate"] = rate
            with self.subTest(rate=rate), self.export([clip(), sticker]) as archive:
                exported = json.loads(archive.read("content.otio"))["tracks"]["children"][0]["children"][1]
                self.assertEqual(exported["media_references"]["DEFAULT_MEDIA"]["available_range"]["duration"]["rate"], 60)
