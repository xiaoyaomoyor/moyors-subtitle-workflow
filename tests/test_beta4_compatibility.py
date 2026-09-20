"""MSW compatibility boundaries for the fixed upstream beta.4 upgrade."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from maw.media import MediaStatus, resolve_project_media
from maw.project_io import (
    discard_stale_inline_caches, enrich_project_media_metadata,
    restore_runtime_caches, serialize_mosp,
)
from maw.waveform import media_signature


class Beta4CompatibilityTests(unittest.TestCase):
    def test_launcher_notification_preference_is_enforced_at_backend(self):
        from maw.gui_web import LauncherApi, LauncherPaths
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            api = LauncherApi(paths=LauncherPaths(root, root / 'isolated.env', root / 'example.env'), window_getter=lambda: None)
            with mock.patch('maw.gui_web.send_system_notification', return_value=True) as send:
                self.assertFalse(api.send_notification({'title': 'MSW', 'message': 'done'})['sent'])
                send.assert_not_called()
                self.assertTrue(api.save_prefs({'notifyOnComplete': True})['ok'])
                self.assertTrue(api.send_notification({'title': 'MSW', 'message': 'done'})['sent'])
                send.assert_called_once_with('MSW', 'done')

    def test_backfill_preserves_msw_assets_secondary_tracks_and_unchanged_word_times(self):
        from maw.postprocess import embed_translated_project
        project = {'segments': [
            {'id': 'a', 'start': 0, 'end': 1000, 'text': '中文', 'items': [{'text': '中文', 'start': 0, 'end': 1000}]},
            {'id': 'b', 'start': 1000, 'end': 2000, 'text': 'Hello', 'items': [{'text': 'Hello', 'start': 1000, 'end': 2000}]},
        ], 'msw': {'schema': 'msw.editor.v1', 'project_id': 'test-project', 'future': {'asset_ref': 'unchanged'}},
            'multi_subtitle': {'schema': 'moy.asr.multi_subtitle.v1', 'enabled': False, 'tracks': [], 'bindings': []}}
        translated = copy.deepcopy(project)
        translated['segments'][1]['text'] = '你好'
        result = embed_translated_project(project, translated)
        self.assertEqual(result['msw'], project['msw'])
        self.assertIn('multi_subtitle', result)
        self.assertEqual(result['segments'][0]['items'], project['segments'][0]['items'])
        self.assertNotIn('items', result['segments'][1])
        self.assertEqual(result['segments'][1]['id'], 'b')
        self.assertEqual(project['segments'][1]['text'], 'Hello')

    def test_translation_snapshot_validates_and_preserves_output_mode(self):
        from maw.msw.jobs import validate_snapshot
        snapshot = {'project_id': 'test-project', 'track_id': None, 'output_mode': 'replace_main', 'entries': [
            {'source': {'id': 'a', 'start': 0, 'end': 1000, 'text': 'Hello'}, 'target': None, 'binding_id': None}]}
        self.assertEqual(validate_snapshot(snapshot)['output_mode'], 'replace_main')
        with self.assertRaisesRegex(ValueError, '输出方式'):
            validate_snapshot({**snapshot, 'output_mode': 'unknown'})

    def test_foreign_reference_prefers_original_filename_over_project_name(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            original = root / '原视频.mp4'
            original.write_bytes(b'video')
            (root / '编辑后的工程.mp4').write_bytes(b'other video')
            for reference in (r'D:\old\原视频.mp4', '/old/原视频.mp4'):
                resolved = resolve_project_media(root / '编辑后的工程.mosp', {'media': reference})
                self.assertEqual(resolved.status, MediaStatus.SUCCESS)
                self.assertEqual(resolved.resolved_path, original)

    def test_dimension_enrichment_preserves_existing_fps_and_optional_fields(self):
        project = {'segments': [], 'media': 'clip.mp4', 'media_metadata': {
            'video_fps': 24, 'video_fps_ratio': '24/1', 'selected_audio_track': 2,
            'audio_tracks': [], 'duration_ms': 4567, 'vendor': {'data': 1},
        }}
        before = copy.deepcopy(project)
        with mock.patch('maw.project_io.probe_video_fps', return_value={
            'video_fps': 30, 'video_fps_ratio': '30/1', 'video_width': 1080, 'video_height': 1920,
        }):
            result = enrich_project_media_metadata(project)
        self.assertEqual(project, before)
        for key, value in before['media_metadata'].items():
            self.assertEqual(result['media_metadata'][key], value)
        self.assertEqual(result['media_metadata']['video_width'], 1080)
        self.assertEqual(result['media_metadata']['video_height'], 1920)

    def test_loudness_is_runtime_only_and_bound_to_source_and_track(self):
        with tempfile.TemporaryDirectory() as directory:
            media = Path(directory).resolve() / 'source.wav'
            media.write_bytes(b'audio')
            project = {'schema': 'moy.asr.project.v1', 'segments': [], 'media': str(media),
                       'media_metadata': {'selected_audio_track': 2}}
            runtime = {**project, 'loudness': {
                'schema': 'moy.asr.loudness.v1', 'source': media_signature(media),
                'audio_track': 2, 'p95': .2, 'max': .4, 'rms': .15, 'mean': .1,
                'bin_count': 40, 'channels': 2,
            }}
            with mock.patch('maw.project_io.enrich_project_media_metadata', side_effect=lambda value, *a, **k: value):
                disk = json.loads(serialize_mosp(runtime))
            self.assertNotIn('loudness', disk)
            self.assertIn('loudness', runtime)
            self.assertEqual(restore_runtime_caches(disk, runtime, media)['loudness'], runtime['loudness'])
            switched = {**disk, 'media_metadata': {'selected_audio_track': 1}}
            self.assertNotIn('loudness', restore_runtime_caches(switched, runtime, media))
            self.assertNotIn('loudness', discard_stale_inline_caches({**runtime, **switched}, media))
            media.write_bytes(b'changed audio')
            self.assertNotIn('loudness', restore_runtime_caches(disk, runtime, media))
            self.assertNotIn('loudness', discard_stale_inline_caches(runtime, media))


if __name__ == '__main__':
    unittest.main()
