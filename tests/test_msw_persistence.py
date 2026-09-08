import copy
from dataclasses import replace
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

from test_msw_processing import server_module
from maw.msw.assets import AssetStore
from maw.msw.tts import DEFAULT_RECIPE
from maw.msw.recovery import RecoveryStore


def wav_data():
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(24000)
        writer.writeframes(b"\0\0" * 2400)
    return output.getvalue()


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.environment = patch.dict(os.environ, {"MSW_APP_DATA_ROOT": str(self.root / "local"),
                                                    "MAW_ENV_FILE": str(self.root / "isolated.env")})
        self.environment.start()
        self.path = self.root / "original.mosp"
        self.media = self.root / "source.wav"
        self.media.write_bytes(wav_data())
        data = {"media": str(self.media), "segments": [],
                "msw": {"schema": "msw.editor.v1", "project_id": "original", "assets": []}}
        self.path.write_text(json.dumps(data), encoding="utf-8")
        project = server_module.ServerProject(data, self.path, self.media, None, [], source_media_path=self.media)
        self.server = server_module.EditorServer(("127.0.0.1", 0), project, no_waveform=True, settings_path=self.root / "settings.json")
        self.api = self.server.processing_api
        self.service = self.api.persistence
        self.destination = self.root / "copy" / "copied.mosp"
        self.destination.parent.mkdir()
        self.service.picker = lambda _: self.destination

    def tearDown(self):
        self.server.server_close()
        self.environment.stop()
        self.temp.cleanup()

    def asset(self):
        source = {"key": "cue", "id": "cue", "track_id": None, "text": "Hello", "start": 0, "end": 1000}
        asset = self.api.assets.add("original", "job-1", source, DEFAULT_RECIPE, wav_data())
        self.server.project.data["msw"]["assets"].append(asset)
        return asset

    def target(self):
        context = self.api.context()
        result = self.service.choose_target({"binding": context["binding"], "filename": "copied.mosp"})
        return {"target": result.get("target"), "binding": context["binding"]}

    def save_as(self, **options):
        request = self.target()
        request.update(project=copy.deepcopy(self.server.project.data), **options)
        return self.service.save_as(request, self.server.write_project)

    def test_save_as_collects_audio_and_media_and_reopens_without_local_cache(self):
        asset = self.asset()
        previous = self.path.read_bytes()
        result = self.save_as(collectMedia=True)
        saved = json.loads(self.destination.read_text(encoding="utf-8"))
        self.assertNotEqual(saved["msw"]["project_id"], "original")
        self.assertEqual(saved["msw"]["source_project_id"], "original")
        self.assertFalse(Path(saved["media"]).is_absolute())
        self.assertEqual((self.destination.parent / saved["media"]).read_bytes(), wav_data())
        clean_store = AssetStore(self.root / "clean-machine")
        self.assertEqual(clean_store.resolve(result["projectId"], asset, self.destination).read_bytes(), wav_data())
        self.assertEqual(result["assets"]["available"], 1)
        self.assertEqual(self.path.read_bytes(), previous)
        self.assertEqual(self.server.project.json_path, self.destination)

    def test_optional_media_collection_and_relative_reference_relocation(self):
        self.server.project.data["media"] = self.media.name
        result = self.save_as()
        self.assertEqual(result["project"]["media"], str(self.media))
        self.assertFalse(any(self.destination.parent.glob("*.assets/media/*")))

    def test_unbound_project_does_not_borrow_media_from_the_bound_project(self):
        project = copy.deepcopy(self.server.project.data)
        project["msw"]["project_id"] = "unbound-project"
        with self.assertRaisesRegex(ValueError, "尚未由服务器接管"):
            self.service.save_as({**self.target(), "project": project, "collectMedia": True}, self.server.write_project)
        self.assertFalse(self.destination.exists())
        self.service.save_as({**self.target(), "project": project}, self.server.write_project)
        record = next(row for row in self.service.recovery.list() if row["kind"] == "saved")
        self.assertIsNone(self.service.recovery.get(record["id"])["media"])
        self.assertIsNone(self.server.project.media_path)

    def test_fork_links_immutable_assets_and_late_results_can_be_saved(self):
        first = self.asset()
        result = self.save_as()
        new_id = result["projectId"]
        self.assertEqual(self.api.assets.list(new_id)["assets"], [first])
        late = self.api.assets.add("original", "job-late", first["source_ref"], DEFAULT_RECIPE, wav_data())
        self.server.project.data["msw"]["assets"].append(late)
        context = self.api.context()
        self.server.save_project(self.server.project.data, expected_binding=context["binding"],
                                 expected_revision=context["saveRevision"])
        self.assertTrue((self.destination.parent / late["path"]).is_file())
        self.assertEqual(self.api.assets.get(new_id, late["id"]), late)

    def test_health_distinguishes_staging_from_collected_files(self):
        asset = self.asset()
        self.assertEqual(self.service.health()["stagedOnly"], [asset["id"]])
        self.api.assets.persist_project(self.server.project.data, self.path)
        self.assertEqual(self.service.health()["stagedOnly"], [])

    def test_only_native_target_can_be_written_and_grant_is_single_use(self):
        with self.assertRaisesRegex(ValueError, "失效"):
            self.service.save_as({"target": str(self.destination), "project": self.server.project.data}, self.server.write_project)
        body = {**self.target(), "project": self.server.project.data}
        self.service.save_as(body, self.server.write_project)
        with self.assertRaisesRegex(ValueError, "失效"):
            self.service.save_as(body, self.server.write_project)

    def test_target_changed_or_binding_changed_is_not_overwritten(self):
        body = {**self.target(), "project": self.server.project.data}
        self.destination.write_text("external change", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "发生变化"):
            self.service.save_as(body, self.server.write_project)
        self.assertEqual(self.destination.read_text(), "external change")
        body = {**self.target(), "project": self.server.project.data}
        self.api.invalidate_binding()
        with self.assertRaisesRegex(ValueError, "已切换"):
            self.service.save_as(body, self.server.write_project)

    def test_missing_audio_keeps_reference_and_reports_incomplete_collection(self):
        asset = self.asset()
        self.api.assets.persist_project(self.server.project.data, self.path)
        # Simulate a second machine where metadata exists but files do not.
        self.api._assets = AssetStore(self.root / "different-cache")
        self.server.project = replace(self.server.project, json_path=self.root / "elsewhere" / "moved.mosp")
        result = self.save_as()
        self.assertEqual(result["assets"]["missing"], [asset["id"]])
        self.assertEqual(result["project"]["msw"]["assets"], [asset])

    def test_collection_failure_does_not_publish_project_or_switch_binding(self):
        self.asset()
        original = self.server.project
        with patch("maw.msw.persistence.collect_media", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.save_as(collectMedia=True)
        self.assertFalse(self.destination.exists())
        self.assertIs(self.server.project, original)

    def test_cancelled_picker_does_not_create_target_or_write(self):
        self.service.picker = lambda _: None
        self.assertIsNone(self.target()["target"])
        self.assertFalse(self.destination.exists())

    def test_draft_is_independent_of_disk_and_restores_without_overwriting(self):
        original = self.path.read_bytes()
        draft = copy.deepcopy(self.server.project.data)
        draft["segments"] = [{"id": "a", "start": 0, "end": 1000, "text": "Unsaved"}]
        record = self.service.draft({"session": "tab-one", "binding": self.api.context()["binding"],
                                     "filename": "original.mosp", "project": draft})
        restored = self.service.restore(record["id"])
        self.assertEqual(restored["project"]["segments"][0]["text"], "Unsaved")
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(self.server.project.data["segments"], [])
        self.api.invalidate_binding()
        with self.assertRaisesRegex(ValueError, "已切换"):
            self.service.draft({"session": "tab-one", "binding": "old", "project": draft})

    def test_recovery_from_another_project_collects_original_media_and_audio(self):
        asset = self.asset()
        self.api.assets.persist_project(self.server.project.data, self.path)
        record = self.service.draft({"session": "tab-one", "binding": self.api.context()["binding"],
                                     "filename": "original.mosp", "project": self.server.project.data})
        # A fresh, unrelated server project and empty asset index must not take
        # precedence over the recovery record's server-registered origin.
        self.api._assets = AssetStore(self.root / "fresh-cache")
        self.server.project = replace(self.server.project, json_path=None, media_path=None, source_media_path=None,
                                      data={"media": "", "segments": []})
        restored = self.service.restore(record["id"])
        result = self.service.save_as({**self.target(), "project": restored["project"],
                                       "recovery": True, "collectMedia": True}, self.server.write_project)
        self.assertEqual(result["assets"]["available"], 1)
        self.assertEqual((self.destination.parent / asset["path"]).read_bytes(), wav_data())
        saved_record = next(row for row in self.service.recovery.list() if row["kind"] == "saved")
        self.assertEqual(self.service.recovery.get(saved_record["id"])["media"], self.destination.parent / result["project"]["media"])

    def test_history_retention_drafts_and_rebuildable_caches(self):
        store = RecoveryStore(self.root / "history")
        project = copy.deepcopy(self.server.project.data)
        for index in range(30):
            project["language"] = str(index)
            store.put(project, kind="history", name="original.mosp", now=100 + index * 61)
        self.assertEqual(len(store.list()), 20)
        for tab in range(4):
            store.put(project, kind="draft", name="unsaved.mosp", session=f"tab-{tab}")
        self.assertEqual(sum(row["kind"] == "draft" for row in store.list()), 3)
        project["waveform"] = {"invalid_rebuildable_cache": True}
        record_id = store.put(project, kind="draft", name="unsaved.mosp", session="tab-3")
        self.assertNotIn("waveform", store.get(record_id)["project"])
        store.MAX_RECORDS = 2
        store.put(project, kind="saved", name="original.mosp")
        self.assertEqual(len(store.list()), 2)

    def test_primary_save_reports_recovery_failure_without_claiming_save_failed(self):
        with patch.object(RecoveryStore, "put", side_effect=OSError("disk full")):
            result = self.save_as()
        self.assertTrue(self.destination.is_file())
        self.assertIn("恢复记录未更新", result["recoveryWarning"])
