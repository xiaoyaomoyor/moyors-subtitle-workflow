import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maw.media import project_media_reference, rebase_project_media, resolve_project_media
from maw.project_io import write_mosp
from maw.postprocess_io import write_derived_project
from tests.test_local_editor_server import server_editor


class MediaReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.media = self.root / '原片 #1 & 2.wav'
        self.media.write_bytes(b'synthetic')
        self.output = self.root / '_msw' / 'project.mosp'
        self.output.parent.mkdir()

    def test_explicit_relative_path_uses_cwd_and_bad_explicit_never_guesses(self):
        with patch('maw.media.Path.cwd', return_value=self.root):
            found = resolve_project_media(self.output, {}, self.media.name)
            missing = resolve_project_media(self.output, {'media': str(self.media)}, 'missing.wav')
        self.assertEqual(found.resolved_path, self.media)
        self.assertFalse(missing.loadable)

    def test_legacy_output_fallback_is_exact_and_limited_to_one_parent(self):
        for folder in ('_msw', 'clip_maw'):
            project = self.root / folder / 'project.mosp'
            project.parent.mkdir(exist_ok=True)
            self.assertEqual(resolve_project_media(project, {'media': self.media.name}).requested_path, self.media)
            self.assertFalse(resolve_project_media(project, {'media': 'different.wav'}).loadable)
        arbitrary = self.root / 'ordinary' / 'project.mosp'
        arbitrary.parent.mkdir()
        self.assertFalse(resolve_project_media(arbitrary, {'media': self.media.name}).loadable)
        nested = self.output.parent / '_msw' / 'project.mosp'
        nested.parent.mkdir()
        self.assertFalse(resolve_project_media(nested, {'media': self.media.name}).loadable)

    def test_save_reference_rebases_from_source_and_does_not_mutate(self):
        source = {'media': self.media.name, 'segments': [], 'custom': {'keep': True}}
        previous = copy.deepcopy(source)
        rebased = rebase_project_media(source, self.output, source_project_path=self.root/'source.mosp')
        self.assertEqual(rebased['media'], '../' + self.media.name)
        self.assertEqual(source, previous)
        self.assertEqual(resolve_project_media(self.output, rebased).resolved_path, self.media)
        with patch('maw.media.os.path.relpath', side_effect=ValueError('different drive')):
            self.assertEqual(project_media_reference(self.output, self.media), self.media.as_posix())

    def test_legacy_parent_original_wins_over_a_same_stem_playback_cache(self):
        source = self.root/'clip.flv';source.write_bytes(b'original')
        cached = self.output.parent/'clip.mp4';cached.write_bytes(b'cache')
        found = resolve_project_media(self.output, {'media':'clip.flv'})
        self.assertEqual(found.requested_path, source)
        self.assertEqual(found.resolved_path, source)

    def test_write_and_derived_output_reopen_from_new_directory(self):
        source = {'media': self.media.name, 'segments': []}
        with patch('maw.project_io.probe_video_fps', return_value=None), patch('maw.project_io.probe_audio_tracks', return_value=None):
            write_mosp(self.output, source, media_path=self.media)
        saved = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertEqual(saved['media'], '../'+self.media.name)
        derived = self.root / 'derived' / 'result.mosp'
        write_derived_project(saved, derived, self.output)
        self.assertEqual(resolve_project_media(derived, json.loads(derived.read_text(encoding='utf-8'))).resolved_path, self.media)
        self.assertEqual(source['media'], self.media.name)

    def test_metadata_probe_uses_project_directory_without_explicit_media(self):
        with patch('maw.project_io.probe_video_fps', return_value=None) as probe, patch('maw.project_io.probe_audio_tracks', return_value=None):
            write_mosp(self.output, {'media': '../'+self.media.name, 'segments': []})
        self.assertEqual(Path(probe.call_args.args[0]).resolve(), self.media)

    def test_remember_only_changes_link_and_keeps_exact_backup_and_revision_guard(self):
        original = b'\xef\xbb\xbf' + json.dumps({'media': 'old.wav', 'segments': [], 'waveform': {'keep': 1}, 'custom': 17}).encode()
        self.output.write_bytes(original)
        server_editor.remember_project_media(self.output, '../'+self.media.name, original)
        saved = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertEqual(saved, {'media': '../'+self.media.name, 'segments': [], 'waveform': {'keep': 1}, 'custom': 17})
        self.assertEqual(self.output.with_suffix('.mosp.bak').read_bytes(), original)
        self.assertNotIn(b'\r\n', self.output.read_bytes())
        with self.assertRaisesRegex(ValueError, '其他程序修改'):
            server_editor.remember_project_media(self.output, 'different.wav', original)
        self.assertEqual(self.output.with_suffix('.mosp.bak').read_bytes(), original)

    def test_load_remembers_only_when_opted_in_and_preserves_paired_source(self):
        source = self.root/'clip.flv'; source.write_bytes(b'synthetic flv')
        paired = source.with_suffix('.mp4'); paired.write_bytes(b'synthetic mp4')
        original = json.dumps({'media': 'missing.wav', 'segments': [], 'custom': 1}).encode()
        self.output.write_bytes(original)
        for remember in (False, True):
            with patch.object(server_editor, 'enrich_project_media_metadata', side_effect=lambda data, **kw: data):
                loaded = server_editor.load_project(self.output, str(source), str(self.root), no_waveform=True,
                    peaks_per_second=100, remember_media=remember)
            self.assertEqual(loaded.source_media_path, source)
            self.assertEqual(loaded.media_path, paired)
            self.assertEqual(loaded.data['media'], '../clip.flv')
            if not remember:
                self.assertEqual(self.output.read_bytes(), original)
            else:
                self.assertEqual(json.loads(self.output.read_text(encoding='utf-8')), {'media': '../clip.flv', 'segments': [], 'custom': 1})

    def test_remember_backup_failure_does_not_replace_original(self):
        original = b'{"media":"old.wav","segments":[]}'
        self.output.write_bytes(original)
        with patch('maw.file_io.os.replace', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                server_editor.remember_project_media(self.output, '../'+self.media.name, original)
        self.assertEqual(self.output.read_bytes(), original)

    def test_launcher_uses_original_media_identity_and_never_reuses_wrong_link(self):
        from maw.gui_web import LauncherApi
        from maw.gui_workflow import build_serve_command
        from unittest.mock import Mock
        api = object.__new__(LauncherApi)
        api._owned_session_running = Mock(return_value=False)
        api._stop_session = Mock()
        payload = {'intent':'project', 'jsonPath':str(self.output), 'mediaPath':str(self.media), 'port':8250}
        existing = {'projectPath':str(self.output), 'mediaPath':str(self.root/'preview.mp4'), 'sourceMediaPath':str(self.media)}
        self.output.write_text(json.dumps({'media':'missing.wav','segments':[]}), encoding='utf-8')
        with patch('maw.gui_web._probe_existing_server', return_value=existing):
            self.assertTrue(api.start_server(payload)['sameProject'])
            conflict = api.start_server({**payload, 'rememberMedia':True})
            self.assertEqual(conflict['code'], 'server_conflict')
            self.assertTrue(conflict['conflict']['mediaConflict'])
            self.output.write_text(json.dumps({'media':'../'+self.media.name,'segments':[]}), encoding='utf-8')
            self.assertTrue(api.start_server({**payload,'rememberMedia':True})['sameProject'])
            existing['sourceMediaPath'] = str(self.root/'different.wav')
            self.assertTrue(api.start_server(payload)['conflict']['mediaConflict'])
            self.assertEqual(api.start_server({**payload,'mediaPath':str(self.root/'absent.wav')})['code'], 'server_media_missing')
        api._stop_session.assert_not_called()
        self.assertIn('--remember-media', build_serve_command(self.output,self.media,8250,remember_media=True))
        self.assertNotIn('--remember-media', build_serve_command(self.output,self.media,8250))
