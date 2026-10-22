import shutil
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from maw import media_cache, quapeaks, mopeaks, waveform
from maw.cache_management import manage, cached_waveform
from maw.output_naming import maw_root
from test_media_cache import _make_tone


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
class CacheManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.media = self.root / 'sample.wav'
        _make_tone(self.media)
        self.project = {'segments': [], 'media': str(self.media)}

    def build(self, **kwargs):
        result = media_cache.embed_media_caches(self.project, self.media, **kwargs)
        self.assertIsNone(result.waveform_error)
        return result

    def duplicates(self):
        with patch('maw.quapeaks._load_rust_kernel', return_value=None):
            initial = self.build()
        fallback = mopeaks.mopeaks_path(self.media)
        self.assertTrue(fallback.is_file())
        upgraded = self.build()
        self.assertIsNotNone(upgraded.reapeaks_path)
        return initial, fallback, upgraded.reapeaks_path

    def test_launcher_editor_reuse_full_cache_without_decode_or_duplicate(self):
        self.build()
        with patch('maw.waveform.extract_waveform', side_effect=AssertionError('duplicate decode')), \
             patch('maw.quapeaks.generate_reapeaks_stream_bytes', side_effect=AssertionError('duplicate kernel')):
            second = self.build()
            loaded, extracted = waveform.load_or_extract_waveform(None, self.media)
        self.assertFalse(extracted)
        self.assertEqual(loaded['data'], second.project['waveform']['data'])
        self.assertFalse(mopeaks.mopeaks_path(self.media).exists())

    def test_kernel_missing_fallback_then_upgrade_and_explicit_cleanup(self):
        initial, fallback, container = self.duplicates()
        report = manage(self.media)
        self.assertEqual(report['count'], 1)
        self.assertTrue(fallback.exists(), 'analysis is read-only')
        with patch('send2trash.send2trash', side_effect=lambda path: Path(path).rename(self.root / 'trashed.mopeaks')) as trash:
            done = manage(self.media, token=report['token'])
        self.assertEqual(done['removed'], 1)
        trash.assert_called_once_with(str(fallback))
        self.assertTrue(container.is_file())
        self.assertEqual(cached_waveform(self.media)['data'], initial.project['waveform']['data'])

    def test_cleanup_rejects_stale_report_and_preserves_unique_resolution(self):
        _, fallback, _ = self.duplicates()
        report = manage(self.media)
        other = waveform.extract_waveform(self.media, peaks_per_second=50)
        mopeaks.save_mopeaks(other, self.media)
        with patch('send2trash.send2trash') as trash:
            with self.assertRaisesRegex(ValueError, '改变'):
                manage(self.media, token=report['token'])
            trash.assert_not_called()
        self.assertEqual(manage(self.media)['count'], 0)
        self.assertTrue(fallback.is_file())

    def test_trash_failure_preserves_file_and_reports_actual_removed_count(self):
        _, fallback, _ = self.duplicates()
        report = manage(self.media)
        with patch('send2trash.send2trash', side_effect=OSError('test-only denied')):
            result = manage(self.media, token=report['token'])
        self.assertEqual(result['removed'], 0)
        self.assertEqual(result['count'], 1)
        self.assertTrue(result['warnings'])
        self.assertTrue(fallback.is_file())

    def test_launcher_analyzes_only_picker_media_and_checks_preview_token(self):
        from maw.gui_web import LauncherApi
        from types import SimpleNamespace
        from webview.util import parse_file_type
        self.duplicates()
        api = LauncherApi.__new__(LauncherApi)
        api.paths = SimpleNamespace(env_path=self.root / 'empty-test.env')
        def choose(**kwargs):
            for value in kwargs['file_types']:
                parse_file_type(value)
            return (str(self.media),)
        with patch('maw.gui_web._file_dialog', side_effect=choose), \
             patch('maw.gui_web._postprocess_ffmpeg_tools', return_value=SimpleNamespace(ffprobe=shutil.which('ffprobe'))):
            report = api.update_user_config({'action': 'cache-analyze', 'path': 'ignored-untrusted-path'})
        self.assertEqual(report['media'], self.media.name)
        self.assertEqual(report['count'], 1)
        with patch('send2trash.send2trash') as trash:
            rejected = api.update_user_config({'action': 'cache-clean', 'token': 'stale'})
            self.assertIn('重新分析', rejected['error'])
            trash.assert_not_called()

    def test_corrupt_container_keeps_fallback_and_can_be_rebuilt(self):
        _, fallback, container = self.duplicates()
        container.write_bytes(container.read_bytes()[:18])
        self.assertEqual(manage(self.media)['count'], 0)
        self.assertIsNotNone(cached_waveform(self.media))
        self.build()
        self.assertTrue(fallback.exists())
        self.assertIsNotNone(quapeaks.load_self_wave_payload(self.media))

    def test_copy_media_and_cache_folder_preserves_identity(self):
        result = self.build()
        moved = self.root / 'moved'
        moved.mkdir()
        media = moved / self.media.name
        shutil.copy2(self.media, media)
        target = maw_root(media); target.mkdir(exist_ok=True)
        shutil.copy2(result.reapeaks_path, target / result.reapeaks_path.name)
        with patch('maw.waveform.extract_waveform', side_effect=AssertionError('moved cache missed')):
            self.assertEqual(waveform.load_or_extract_waveform(None, media)[0]['data'], result.project['waveform']['data'])
        media.write_bytes(media.read_bytes() + b'changed')
        self.assertIsNone(cached_waveform(media))

    def test_concurrent_generation_extracts_once(self):
        with patch('maw.waveform.extract_waveform', wraps=waveform.extract_waveform) as extract:
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(lambda _: self.build(), range(2)))
        self.assertEqual(extract.call_count, 1)

    def test_spectral_upgrade_preserves_base_and_plain_reuse_preserves_spectral(self):
        first = self.build()
        second = self.build(generate_spectral=True)
        self.assertEqual(first.project['waveform']['data'], second.project['waveform']['data'])
        self.assertIsNotNone(quapeaks.load_spectral_payload(self.media))
        with patch('maw.quapeaks.generate_reapeaks_stream_bytes', side_effect=AssertionError('unexpected rebuild')):
            self.build()
        self.assertIsNotNone(quapeaks.load_spectral_payload(self.media))

    def test_self_layer_added_to_existing_wave_only_container(self):
        quapeaks.generate_for_media(self.media, include_spectral=False)
        self.assertIsNone(quapeaks.find_self_wave_container(self.media))
        self.build()
        self.assertIsNotNone(quapeaks.find_self_wave_container(self.media))
        self.assertFalse(mopeaks.mopeaks_path(self.media).exists())

    def test_selected_track_never_reuses_default_fallback(self):
        with patch('maw.quapeaks._load_rust_kernel', return_value=None):
            self.build()
        self.assertIsNone(cached_waveform(self.media, audio_track=1))
        self.assertEqual(manage(self.media, tracks=[1])['count'], 0)

    def test_corrupt_primary_does_not_hide_valid_legacy_container(self):
        generated = self.build().reapeaks_path
        legacy = self.media.parent / generated.name
        shutil.copy2(generated, legacy)
        generated.write_bytes(generated.read_bytes()[:18])
        with patch('maw.waveform.extract_waveform', side_effect=AssertionError('valid legacy cache ignored')):
            self.assertFalse(waveform.load_or_extract_waveform(None, self.media)[1])
