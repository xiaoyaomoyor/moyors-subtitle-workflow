from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from maw.msw.assets import AssetStore, audio_info
from maw.msw.jobs import JobCancelled
from maw.msw.project_codec import valid_asset
from maw.msw.tts import TtsService, validate_snapshot
from maw.msw.yukkuri import YukkuriSettings, resolve_settings, synthesize
from maw.msw.yukkuri_runtime import (ResourceCancelled, RuntimeController, VOICES, download,
                                     extract_package, manifest, validate_recipe, verify)
import test_msw_processing as processing_tests


class ResourcesTests(unittest.TestCase):
    def test_config_rejects_invalid_voice_speed_and_ignores_paths(self):
        for change in ({"voice": "../f1"}, {"speed": True}, {"speed": 301}, {"speed": 49}, {"language_type": "German"}):
            with self.assertRaises(ValueError):
                validate_recipe(change)
        value = validate_recipe({"runtime_path": "untrusted", "engine_version": "fake", "apiKey": "fake"})
        self.assertNotIn("runtime_path", value)
        self.assertNotIn("apiKey", value)
        self.assertEqual(value["engine_version"], manifest()["engine_version"])

    def test_recipe_persistence_does_not_require_cloud_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            controller = RuntimeController(directory)
            controller.save(engine="yukkuri", recipe={"voice": "jgr", "speed": 80})
            restored = RuntimeController(directory)
            self.assertEqual(restored.payload()["engine"], "yukkuri")
            self.assertEqual(restored.payload()["recipe"]["voice"], "jgr")
            with self.assertRaisesRegex(ValueError, "安装或检测"):
                resolve_settings(restored, {})
            with self.assertRaises(ValueError):
                restored.start("check", "")

    def test_archive_rejects_traversal_links_and_oversized_members(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, name in enumerate(["package/../../escaped", "package/C:evil", "package/link"]):
                archive = root / f"{index}.tgz"
                with tarfile.open(archive, "w:gz") as stream:
                    member = tarfile.TarInfo(name)
                    if index == 2:
                        member.type, member.linkname = tarfile.SYMTYPE, "../../escaped"
                    stream.addfile(member)
                with self.assertRaises(ValueError):
                    extract_package(archive, root / "out", threading.Event())
            self.assertFalse((root / "escaped").exists())
            archive = root / "valid.tgz"
            with tarfile.open(archive, "w:gz") as stream:
                member = tarfile.TarInfo("package/LICENSE")
                member.size = 7
                stream.addfile(member, io.BytesIO(b"license"))
            with patch("maw.msw.yukkuri_runtime.MAX_EXPANDED", 6), self.assertRaises(ValueError):
                extract_package(archive, root / "out", threading.Event())
            extract_package(archive, root / "valid", threading.Event())
            self.assertEqual((root / "valid/LICENSE").read_text(), "license")

    def test_download_checks_digest_and_reuses_verified_cache(self):
        class Response:
            status_code = 200
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def iter_content(self, _): return [b"resource"]
        class Session:
            calls = 0
            def get(self, *_args, **kwargs):
                self.calls += 1
                assert kwargs["allow_redirects"] is False
                return Response()
        item = {"url": "https://example.test/resource", "sha256": hashlib.sha256(b"resource").hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            root, session, cancel = Path(directory), Session(), threading.Event()
            path = download(item, root, cancel, session)
            self.assertEqual(download(item, root, cancel, session), path)
            self.assertEqual(session.calls, 1)
            with self.assertRaisesRegex(ValueError, "校验失败"):
                download({**item, "sha256": "0" * 64}, root, cancel, session)
            self.assertFalse(list(root.glob("*.pending")))
            cancel.set()
            with self.assertRaises(ResourceCancelled):
                download({**item, "sha256": "1" * 64}, root, cancel, session)

    def test_background_cancel_keeps_previous_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            controller = RuntimeController(directory)
            controller.save(runtime_path="previous-runtime")
            def installing(_base, cancel, _progress):
                cancel.wait(3)
                raise ResourceCancelled()
            with patch("maw.msw.yukkuri_runtime.install", installing):
                controller.start("install")
                with self.assertRaises(ValueError):
                    controller.start("install")
                controller.start("cancel")
                controller.thread.join(5)
            self.assertEqual(controller.payload()["state"], "cancelled")
            self.assertEqual(controller.payload()["runtime_path"], "previous-runtime")

    def test_override_validation_and_original_text(self):
        source = {"key": "cue-1", "id": "1", "track_id": None, "start": 0, "end": 1000, "text": "重庆"}
        snapshot = {"project_id": "p", "entries": [{**source, "pronunciation_override": "虫庆"}]}
        self.assertEqual(validate_snapshot(snapshot), snapshot)
        snapshot["entries"][0]["pronunciation_override"] = "字" * 601
        with self.assertRaises(ValueError):
            validate_snapshot(snapshot)

    def test_asset_codec_preserves_long_spoken_text_and_bounds_override(self):
        from test_msw_tts import wav_bytes
        with tempfile.TemporaryDirectory() as directory:
            source = {"key": "c", "id": "c", "track_id": None, "text": "重庆", "start": 0, "end": 1000}
            asset = AssetStore(directory).add("p", "j", source, validate_recipe({}), wav_bytes(), spoken_text="カ" * 3000)
            self.assertTrue(valid_asset(asset))
            for value in (None, 123, "字" * 601):
                asset["source_ref"]["pronunciation_override"] = value
                self.assertFalse(valid_asset(asset))
            asset["source_ref"].pop("pronunciation_override")
            asset["generation"]["spoken_text"] = "カ" * 12001
            self.assertFalse(valid_asset(asset))


@unittest.skipUnless(os.environ.get("MSW_TEST_YUKKURI_RUNTIME"), "requires separately installed Yukkuri resources")
class LiveYukkuriTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(os.environ["MSW_TEST_YUKKURI_RUNTIME"])
        cls.node = verify(cls.root)

    def settings(self, **recipe):
        return YukkuriSettings(validate_recipe(recipe), self.root, self.node)

    def test_chinese_english_mixed_all_eight_voices(self):
        hashes = set()
        for voice in VOICES:
            for text in ["你好，欢迎使用。", "Hello world!", "中文 English 123 测试。"]:
                with self.subTest(voice=voice, text=text):
                    audio, spoken = synthesize(self.settings(voice=voice), text, threading.Event())
                    info = audio_info(audio)
                    self.assertEqual(info["sample_rate"], 8000)
                    self.assertGreater(info["sample_count"], 1000)
                    self.assertNotEqual(spoken, text)
                    if text == "Hello world!":
                        hashes.add(info["sha256"])
        self.assertEqual(len(hashes), 8)

    def test_speed_numbers_long_text_and_failure(self):
        slow, _ = synthesize(self.settings(speed=50), "Hello 123", threading.Event())
        fast, _ = synthesize(self.settings(speed=300), "Hello 123", threading.Event())
        self.assertGreater(audio_info(slow)["sample_count"], audio_info(fast)["sample_count"])
        _, en = synthesize(self.settings(language_type="English"), "123", threading.Event())
        _, zh = synthesize(self.settings(language_type="Chinese"), "123", threading.Event())
        self.assertNotEqual(en, zh)
        audio, spoken = synthesize(self.settings(), "你好世界，" * 120, threading.Event())
        self.assertGreater(len(spoken), 180)
        self.assertGreater(audio_info(audio)["sample_count"], 100000)
        with self.assertRaises(ValueError):
            synthesize(self.settings(), "𠮷", threading.Event())

    def test_job_metadata_and_persisted_audio_need_no_engine_on_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AssetStore(Path(directory) / "staging")
            source = {"key": "cue-1", "id": "1", "track_id": "副轨", "start": 0, "end": 1000,
                      "text": "重庆", "pronunciation_override": "虫庆"}
            job = {"id": "job-1", "project_id": "p", "snapshot": {"entries": [source]}}
            result = TtsService(store).run(job, self.settings(), threading.Event(), lambda *_: None)
            self.assertEqual(result["items"][0]["status"], "ready")
            asset = store.list("p")["assets"][0]
            self.assertTrue(valid_asset(asset))
            self.assertEqual(asset["generation"]["display_text"], "重庆")
            self.assertNotEqual(asset["generation"]["spoken_text"], "重庆")
            self.assertEqual(asset["source_ref"]["pronunciation_override"], "虫庆")
            self.assertNotIn(str(self.root), json.dumps(asset))
            self.assertEqual(asset["sha256"], audio_info(store.resolve("p", asset).read_bytes())["sha256"])

    def test_cancel_terminates_child_and_next_synthesis_works(self):
        cancel = threading.Event()
        timer = threading.Timer(.1, cancel.set)
        timer.start()
        started = time.monotonic()
        try:
            with self.assertRaises(JobCancelled):
                synthesize(self.settings(speed=50), "你好世界，" * 120, cancel)
        finally:
            timer.cancel()
        self.assertLess(time.monotonic() - started, 10)
        self.assertGreater(len(synthesize(self.settings(), "Hello", threading.Event())[0]), 44)


class YukkuriApiTests(processing_tests.ProcessingApiTests):
    def test_preview_is_guarded_and_only_synthesizes_a_fixed_temporary_sample(self):
        from types import SimpleNamespace
        from urllib.request import Request, urlopen
        self.assertEqual(self.call('yukkuri-preview', {}, headers={'X-MSW-Token': ''})[0], 403)
        self.assertEqual(self.call('yukkuri-preview', {}, headers={'Origin': 'https://example.test'})[0], 403)
        api = self.server.processing_api
        with api._preview_lock:
            self.assertEqual(self.call('yukkuri-preview', {})[0], 400)
        with patch('maw.msw.yukkuri.resolve_settings', return_value=SimpleNamespace(recipe={'language_type': 'English'})), \
                patch('maw.msw.yukkuri.synthesize', return_value=(b'preview-bytes', 'spoken')) as synth:
            request = Request(self.url + 'yukkuri-preview', data=json.dumps({'text': 'ignored user text'}).encode(),
                              headers={'X-MSW-Token': self.server.request_token, 'Content-Type': 'application/json'})
            with urlopen(request, timeout=3) as response:
                self.assertEqual(response.headers['Content-Type'], 'audio/wav')
                self.assertEqual(response.read(), b'preview-bytes')
            self.assertEqual(synth.call_args.args[1], 'Hello, welcome to our story.')
            self.assertIsNone(api._manager)
            self.assertIsNone(api._assets)
        api.close()
        self.assertTrue(api._preview_cancel.is_set())

    def test_local_settings_and_runtime_routes_are_guarded(self):
        self.server.processing_api.data_root = self.root / "local-data"
        with patch.dict(os.environ, {}, clear=True):
            status, result = self.call("tts-settings", {"recipe": {"provider": "yukkuri", "voice": "m2", "speed": 120}})
            self.assertEqual(status, 200, result)
            self.assertEqual(result["engine"], "yukkuri")
            self.assertEqual(result["yukkuri"]["recipe"]["voice"], "m2")
            self.assertFalse((self.root / "isolated.env").exists())
            self.assertEqual(self.call("yukkuri-runtime", headers={"X-MSW-Token": ""})[0], 403)
            self.assertEqual(self.call("yukkuri-runtime", {"action": "install"}, headers={"Origin": "https://example.test"})[0], 403)
            self.assertEqual(self.call("yukkuri-runtime", {"action": "check", "directory": ""})[0], 400)
            status, result = self.call("jobs", {"kind": "tts", "project_id": "project-test",
                                                "provider": {"recipe": {"provider": "yukkuri"}, "runtime_path": "untrusted"}})
            self.assertEqual(status, 400, result)
            self.assertIn("资源包", result["error"])
