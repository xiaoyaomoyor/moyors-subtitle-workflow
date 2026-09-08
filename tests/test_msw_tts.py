from __future__ import annotations

import copy
import io
import json
import os
import struct
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import wave
from urllib.request import Request, urlopen
import zipfile

from maw.msw.assets import AssetStore, audio_info, confined_path, normalize_generated_wav
from maw.msw.jobs import JobManager, TERMINAL
from maw.msw.project_codec import normalize_extension
from maw.msw.tts import (DEFAULT_RECIPE, TtsSettings, TtsService, audio_download_url,
                         config_payload, resolve_settings, save_settings, synthesize,
                         validate_recipe, validate_snapshot, TtsServiceError)
import test_msw_processing as processing_tests


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        writer.writeframes(b"\0\0" * 2400)
    return output.getvalue()


def snapshot():
    return {"project_id": "tts-project", "entries": [
        {"key": "entry-1", "id": "字幕一", "track_id": None, "text": "Hello", "start": 0, "end": 1000},
        {"key": "entry-2", "id": "字幕二", "track_id": "副轨", "text": "World", "start": 1000, "end": 2000}]}


class TtsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = AssetStore(self.root / "staging")
        self.settings = TtsSettings("synthetic-tts-key", dict(DEFAULT_RECIPE))
        self.managers = []

    def tearDown(self):
        for manager in self.managers:
            manager.close()
            self.assertTrue(manager.close_complete.wait(5))
        self.temp.cleanup()

    def manager(self, synthesize_one):
        manager = JobManager(self.root / "jobs.sqlite3", tts=TtsService(self.assets, synthesize_one=synthesize_one))
        self.managers.append(manager)
        return manager

    def submit(self, manager, **updates):
        return manager.submit({"kind": "tts", "project_id": "tts-project", "request_key": "request-1",
                               "client_token": "page-1", "snapshot": snapshot(), **updates}, self.settings)

    def wait(self, manager, job):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            result = manager.get(job["id"], "tts-project")
            if result["status"] in TERMINAL:
                return result
            time.sleep(.01)
        self.fail("TTS task did not terminate")

    def test_config_is_region_specific_and_masks_keys(self):
        env = self.root / "test.env"
        with patch.dict(os.environ, {}, clear=True):
            result = save_settings(env, {"recipe": DEFAULT_RECIPE, "apiKey": self.settings.api_key})
            self.assertNotIn(self.settings.api_key, json.dumps(result))
            self.assertEqual(resolve_settings(env, {}).api_key, self.settings.api_key)
            self.assertEqual(config_payload(env), result)
            with self.assertRaises(ValueError):
                resolve_settings(env, {"recipe": {**DEFAULT_RECIPE, "region": "singapore"}})
            self.assertFalse(result["regions"][1]["hasApiKey"])

    def test_snapshot_and_model_capabilities_reject_before_billing(self):
        bad = snapshot()
        bad["entries"][0]["text"] = "字" * 601
        with self.assertRaises(ValueError):
            validate_snapshot(bad)
        with self.assertRaises(ValueError):
            validate_recipe({**DEFAULT_RECIPE, "instructions": "speak slowly"})
        self.assertEqual(validate_snapshot(snapshot()), snapshot())
        self.assertEqual(validate_recipe({**DEFAULT_RECIPE, "model": "qwen3-tts-instruct-flash", "instructions": "慢速"})["instructions"], "慢速")

    def test_http_protocol_and_download_never_forward_key_or_redirect(self):
        class Response:
            status_code = 200
            headers = {"Content-Length": str(len(wav_bytes()))}
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def json(self): return {"output": {"audio": {"url": "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=example"}}}
            def iter_content(self, _): return [wav_bytes()]
        calls = []
        class Session:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def post(self, url, **kwargs):
                calls.append(("post", url, kwargs)); return Response()
            def get(self, url, **kwargs):
                calls.append(("get", url, kwargs)); return Response()
        self.assertEqual(synthesize(self.settings, "你好", threading.Event(), session_factory=Session), wav_bytes())
        self.assertEqual(calls[0][2]["json"]["input"], {"text": "你好", "voice": "Cherry", "language_type": "Auto"})
        self.assertFalse(calls[0][2]["allow_redirects"])
        self.assertEqual(calls[1][2]["headers"], {"Accept-Encoding": "identity"})
        self.assertTrue(calls[1][1].startswith("https://"))
        for url in ["https://127.0.0.1/test.wav", "https://example.com/test.wav", "file:///secret",
                    "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.test/a"]:
            with self.assertRaises(ValueError): audio_download_url(url)

        # Even a whole-frame truncation must fail before WAV normalization.
        Response.headers["Content-Length"] = str(len(wav_bytes()) + 2)
        with self.assertRaisesRegex(ValueError, "音频下载不完整"):
            synthesize(self.settings, "你好", threading.Event(), session_factory=Session)

    def test_partial_results_idempotency_and_retry_excludes_ready(self):
        calls = []
        def one(settings, text, _):
            calls.append(text)
            if text == "World": raise ValueError("failed " + settings.api_key)
            return wav_bytes()
        manager = self.manager(one)
        job = self.submit(manager)
        self.assertEqual(self.submit(manager)["id"], job["id"])
        done = self.wait(manager, job)
        self.assertEqual([row["status"] for row in done["result"]["items"]], ["ready", "failed"])
        self.assertNotIn(self.settings.api_key, json.dumps(done))
        self.assertEqual(len(self.assets.list("tts-project")["assets"]), 1)
        with self.assertRaises(ValueError):
            self.submit(manager, request_key="retry-invalid", retry_of=job["id"])
        retry = {**snapshot(), "entries": snapshot()["entries"][1:]}
        self.wait(manager, self.submit(manager, request_key="retry-1", retry_of=job["id"], snapshot=retry))
        self.assertEqual(calls, ["Hello", "World", "World"])

    def test_streaming_wav_lengths_are_finalized_before_asset_registration(self):
        expected = wav_bytes()
        for marker in (0xFFFFFFFF, 0x7FFFFFFF, 0x7FFFF000):
            with self.subTest(marker=marker):
                audio = bytearray(expected)
                struct.pack_into("<I", audio, 4, marker)
                struct.pack_into("<I", audio, 40, marker)
                with self.assertRaisesRegex(ValueError, "WAV 音频不完整"):
                    audio_info(bytes(audio))
                asset = self.assets.add("tts-project", "job-stream", snapshot()["entries"][0], DEFAULT_RECIPE, bytes(audio))
                stored = self.assets.resolve("tts-project", asset)
                self.assertEqual(stored.read_bytes(), expected)
                self.assertEqual(asset["sample_count"], 2400)
                self.assertEqual(asset["byte_size"], len(expected))
                self.assertEqual(asset["sha256"], audio_info(expected)["sha256"])

    def test_streaming_wav_handles_metadata_before_audio_and_fixed_riff_length(self):
        original = wav_bytes()
        metadata = b"JUNK" + struct.pack("<I", 3) + b"abc\0"
        audio = bytearray(original[:36] + metadata + original[36:])
        struct.pack_into("<I", audio, 4, len(audio) - 8)
        struct.pack_into("<I", audio, 52, 0xFFFFFFFF)
        normalized = normalize_generated_wav(bytes(audio))
        self.assertEqual(normalized[36:48], metadata)
        self.assertEqual(normalized[56:], original[44:])
        self.assertEqual(audio_info(normalized)["sample_count"], 2400)

    def test_bailian_streaming_length_reproduces_reported_byte_counts(self):
        # Regression for the user's 2147483546 / 241920-byte failure. wave
        # rounds an odd data chunk length down to whole 16-bit PCM frames.
        expected = wav_bytes()[:36] + b"JUNK" + struct.pack("<I", 48) + bytes(48)
        expected += b"data" + struct.pack("<I", 241920) + bytes(241920)
        expected = bytearray(expected)
        struct.pack_into("<I", expected, 4, len(expected) - 8)
        for declared in (2147483546, 2147483547):
            with self.subTest(declared=declared):
                audio = bytearray(expected)
                struct.pack_into("<I", audio, 4, 0x7FFFFFFF - 8)
                struct.pack_into("<I", audio, 96, declared)
                with self.assertRaisesRegex(ValueError, "头部声明 2147483546 字节，实际读取 241920 字节"):
                    audio_info(bytes(audio))
                asset = self.assets.add("tts-project", "job-bailian", snapshot()["entries"][0], DEFAULT_RECIPE, bytes(audio))
                self.assertEqual(asset["sample_count"], 120960)
                self.assertEqual(asset["byte_size"], len(expected))
                self.assertEqual(self.assets.resolve("tts-project", asset).read_bytes(), bytes(expected))

    def test_wav_normalization_preserves_valid_files_and_rejects_truncation(self):
        expected = wav_bytes()
        self.assertIs(normalize_generated_wav(expected), expected)
        for audio in (expected[:-1], expected[:-2]):
            with self.subTest(removed=len(expected) - len(audio)):
                with self.assertRaisesRegex(ValueError, "WAV 音频不完整"):
                    self.assets.add("tts-project", "job-short", snapshot()["entries"][0], DEFAULT_RECIPE, audio)
        stream = bytearray(expected)
        struct.pack_into("<I", stream, 4, 0xFFFFFFFF)
        struct.pack_into("<I", stream, 40, 0xFFFFFFFF)
        for audio in (bytes(stream[:-1]), bytes(stream[:44])):
            with self.assertRaisesRegex(ValueError, "WAV 音频不完整"):
                normalize_generated_wav(audio)
        self.assertEqual(self.assets.count("tts-project"), 0)

    def test_large_non_streaming_lengths_are_not_silently_repaired(self):
        for declared in (4802, 32 * 1024 * 1024, 0x40000000, 0x7FFEFFFF):
            with self.subTest(declared=declared):
                audio = bytearray(wav_bytes())
                struct.pack_into("<I", audio, 4, declared + 36)
                struct.pack_into("<I", audio, 40, declared)
                with self.assertRaisesRegex(ValueError, "WAV 音频不完整"):
                    self.assets.add("tts-project", "job-invalid-size", snapshot()["entries"][0], DEFAULT_RECIPE, bytes(audio))
        self.assertEqual(self.assets.count("tts-project"), 0)

    def test_wav_normalization_handles_unknown_riff_with_known_data_length(self):
        original = wav_bytes()
        audio = bytearray(original)
        struct.pack_into("<I", audio, 4, 0xFFFFFFFF)
        self.assertEqual(normalize_generated_wav(bytes(audio)), original)
        with self.assertRaisesRegex(ValueError, "WAV 音频不完整"):
            normalize_generated_wav(bytes(audio[:-2]))

    def test_streaming_wav_task_produces_a_ready_playable_asset(self):
        audio = bytearray(wav_bytes())
        struct.pack_into("<I", audio, 4, 0xFFFFFFFF)
        struct.pack_into("<I", audio, 40, 0xFFFFFFFF)
        manager = self.manager(lambda *_: bytes(audio))
        done = self.wait(manager, self.submit(manager))
        self.assertEqual(done["progress"]["ready"], 2)
        self.assertTrue(all(row["status"] == "ready" for row in done["result"]["items"]))

    def test_streaming_wav_uses_frame_alignment_and_pads_odd_pcm_chunks(self):
        for channels, width in ((1, 1), (1, 3), (2, 2)):
            with self.subTest(channels=channels, width=width):
                output = io.BytesIO()
                with wave.open(output, "wb") as writer:
                    writer.setparams((channels, width, 24000, 0, "NONE", "not compressed"))
                    writer.writeframes(b"\0" * (3 * channels * width))
                audio = bytearray(output.getvalue())
                struct.pack_into("<I", audio, 4, 0xFFFFFFFF)
                struct.pack_into("<I", audio, 40, 0xFFFFFFFF)
                normalized = normalize_generated_wav(bytes(audio))
                self.assertEqual(len(normalized) % 2, 0)
                self.assertEqual(audio_info(normalized)["sample_count"], 3)
                struct.pack_into("<H", audio, 32, 0)  # Invalid block alignment.
                with self.assertRaisesRegex(ValueError, "WAV 音频参数无效"):
                    normalize_generated_wav(bytes(audio))

    def test_ready_audio_available_before_batch_ends_cancel_keeps_completed(self):
        started, release = threading.Event(), threading.Event()
        def one(_, text, cancel):
            if text == "World":
                started.set(); release.wait(3)
            return wav_bytes()
        manager = self.manager(one)
        job = self.submit(manager)
        try:
            self.assertTrue(started.wait(2))
            self.assertEqual(len(self.assets.list("tts-project")["assets"]), 1)
            manager.cancel(job["id"], "tts-project")
        finally:
            release.set()
        done = self.wait(manager, job)
        self.assertEqual(done["status"], "cancelled")
        self.assertEqual(len(done["result"]["items"]), 1)
        self.assertEqual(len(self.assets.list("tts-project")["assets"]), 1)

    def test_assets_survive_save_as_restart_missing_and_schema_roundtrip(self):
        asset = self.assets.add("tts-project", "job-1", snapshot()["entries"][0], DEFAULT_RECIPE, wav_bytes())
        project = {"segments": [], "msw": {"schema": "msw.editor.v1", "project_id": "tts-project", "assets": [asset]}}
        self.assertEqual(normalize_extension(project["msw"]), project["msw"])
        target = self.root / "saved" / "project.mosp"
        self.assets.persist_project(project, target)
        self.assertTrue((target.parent / asset["path"]).is_file())
        new_store = AssetStore(self.root / "other-machine")
        self.assertEqual(new_store.resolve("tts-project", asset, target).read_bytes(), wav_bytes())
        copy_target = self.root / "copied" / "other.mosp"
        new_store.persist_project(project, copy_target, target)
        self.assertEqual(new_store.resolve("tts-project", asset, copy_target).read_bytes(), wav_bytes())
        with self.assertRaises(FileNotFoundError): new_store.resolve("tts-project", asset)
        for change in [{"path": "../secret.wav"}, {"channels": False}, {"id": "../../bad"}]:
            bad = copy.deepcopy(project["msw"]); bad["assets"][0].update(change)
            with self.assertRaises(ValueError): normalize_extension(bad)
        with self.assertRaises(ValueError): confined_path(self.root, "../escape")
        with self.assertRaises(ValueError): audio_info(wav_bytes()[:-1])

    def test_audio_clip_codec_preserves_edits_and_validates_references(self):
        asset = self.assets.add("tts-project", "job-audio", snapshot()["entries"][0], DEFAULT_RECIPE, wav_bytes())
        clip = {"id": "clip-1", "track_id": "voice", "asset_id": asset["id"], "start_ms": 1000,
                "source_in_sample": 0, "source_out_sample": 2400, "playback_rate": 1, "gain_db": -3, "muted": True, "label": "配音"}
        value = {"schema": "msw.editor.v1", "project_id": "tts-project", "assets": [asset],
                 "audio_tracks": [{"id": "voice", "name": "配音", "gain_db": 0, "muted": False}],
                 "audio_clips": [clip], "audio_settings": {"heatmap": False, "gap_policy": "follow"}}
        self.assertEqual(normalize_extension(value), value)
        for changes in ({"source_out_sample": 2401}, {"asset_id": "absent"}, {"muted": 1}, {"playback_rate": True}, {"gain_db": float("nan")}):
            bad = copy.deepcopy(value)
            bad["audio_clips"][0].update(changes)
            with self.assertRaises(ValueError):
                normalize_extension(bad)
        for key in ("audio_tracks", "audio_clips", "audio_settings"):
            with self.assertRaises(ValueError):
                normalize_extension({**value, key: None})
        target = self.root / "with-audio" / "project.mosp"
        project = {"segments": [], "msw": value}
        self.assets.persist_project(project, target)
        self.assertEqual(self.assets.resolve("tts-project", asset, target).read_bytes(), wav_bytes())

    def test_retry_does_not_repeat_a_successful_child_retry(self):
        fail = [True]
        def one(_, text, cancel):
            if text == "World" and fail[0]: raise ValueError("one item failed")
            return wav_bytes()
        manager = self.manager(one)
        original = self.wait(manager, self.submit(manager))
        fail[0] = False
        retry = {**snapshot(), "entries": snapshot()["entries"][1:]}
        self.wait(manager, self.submit(manager, request_key="retry", retry_of=original["id"], snapshot=retry))
        with self.assertRaises(ValueError):
            self.submit(manager, request_key="duplicate-retry", retry_of=original["id"], snapshot=retry)

    def test_service_failure_stops_batch_and_inputs_are_stored_once(self):
        calls = []
        def one(_, text, cancel):
            calls.append(text)
            raise TtsServiceError("service unavailable")
        manager = self.manager(one)
        done = self.wait(manager, self.submit(manager))
        self.assertEqual(done["status"], "failed")
        self.assertEqual(calls, ["Hello"])
        with manager.lock:
            stored = json.loads(manager.db.execute("SELECT payload FROM jobs WHERE id=?", (done["id"],)).fetchone()[0])
            self.assertNotIn("snapshot", stored)
            self.assertEqual(manager.db.execute("SELECT COUNT(*) FROM job_inputs").fetchone()[0], 1)
        manager.close()
        self.assertTrue(manager.close_complete.wait(5))
        reopened = self.manager(lambda *_: self.fail("must not retry after restart"))
        self.assertEqual(reopened.get(done["id"], "tts-project")["snapshot"], snapshot())

    def test_library_limit_is_checked_before_provider_is_called(self):
        manager = self.manager(lambda *_: self.fail("must reject before billing"))
        with self.assertRaisesRegex(ValueError, "10000"):
            self.submit(manager, library_size=9999)


class TtsApiTests(processing_tests.ProcessingApiTests):
    def test_saved_asset_audio_range_and_project_bundle(self):
        api = self.server.processing_api
        api.data_root = self.root / "appdata"
        asset = api.assets.add("project-test", "job-test", snapshot()["entries"][0], DEFAULT_RECIPE, wav_bytes())
        project = copy.deepcopy(self.server.project.data)
        project["msw"]["assets"] = [asset]
        _, context = self.call("capabilities")
        status, result = self.call("project", {"project": project, "binding": context["binding"], "saveRevision": context["saveRevision"]})
        self.assertEqual(status, 200, result)
        self.assertTrue((self.path.parent / asset["path"]).is_file())
        audio_url = self.url + "asset-audio?project_id=project-test&asset_id=" + asset["id"]
        request = Request(audio_url, headers={"X-MSW-Token": self.server.request_token, "Range": "bytes=0-43"})
        with urlopen(request) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), wav_bytes()[:44])
        body = {"project_id": "project-test", "project": project}
        request = Request(self.url + "asset-bundle", data=json.dumps(body).encode(),
                          headers={"X-MSW-Token": self.server.request_token, "Content-Type": "application/json"})
        with urlopen(request) as response:
            self.assertEqual(response.status, 200)
            with zipfile.ZipFile(io.BytesIO(response.read())) as archive:
                self.assertEqual(archive.read(asset["path"]), wav_bytes())
                self.assertEqual(json.loads(archive.read("project.mosp"))["msw"]["assets"], [asset])
        self.assertEqual(self.call("asset-audio?project_id=another-project&asset_id=" + asset["id"])[0], 404)
        self.assertEqual(self.call("asset-audio?project_id=project-test&asset_id=../../secret")[0], 404)


if __name__ == "__main__":
    unittest.main()
