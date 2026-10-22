import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maw.user_config import UserConfig, ConfigConflict
from maw.config_transfer import package, parse, workspace, CATEGORIES
from maw.config_defaults import public_recipe, public_plan, recipe


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = UserConfig(self.root / 'user-settings.mswconfig')
        self.store.update(['browser', 'mawe.language'], 'zh')
        self.store.update(['launcher', 'MAW_GUI_THEME'], 'dark')

    def imported(self, raw, policy='replace', categories=None):
        request = dict(package=raw, policy=policy, categories=categories or raw['categories'])
        preview = self.store.request(dict(action='preview', **request))
        return self.store.request(dict(action='import', **request, token=preview['token'], revision=preview['revision']))

    def test_partial_import_and_history_roundtrip(self):
        original = self.store.read()['sections']
        raw = package({'browser': {'mawe.language': 'en'}}, ['interface'])
        self.imported(raw)
        self.assertEqual(self.store.read()['sections']['launcher'], original['launcher'])
        saved = self.store.request({'action': 'snapshots'})['snapshots'][0]
        req = dict(id=saved['id'], categories=['interface'], policy='replace')
        preview = self.store.request(dict(action='restore-preview', **req))
        self.store.request(dict(action='restore', **req, token=preview['token'], revision=preview['revision']))
        self.assertEqual(self.store.read()['sections'], original)

    def test_preview_is_readonly_and_stale_preview_rejected(self):
        raw = package({'browser': {'mawe.language': 'en'}}, ['interface'])
        before = self.store.path.read_bytes()
        req = dict(package=raw, categories=['interface'], policy='replace')
        preview = self.store.request(dict(action='preview', **req))
        self.assertEqual(before, self.store.path.read_bytes())
        self.store.update(['launcher', 'MAW_GUI_THEME'], 'light')
        with self.assertRaises(ConfigConflict):
            self.store.request(dict(action='import', **req, token=preview['token'], revision=preview['revision']))
        self.assertEqual(self.store.read()['sections']['browser']['mawe.language'], 'zh')

    def test_keep_conflicts_and_add_missing(self):
        raw = package({'browser': {'mawe.language': 'en', 'msw.assets.columns': '3'}}, ['interface'])
        self.imported(raw, 'keep')
        current = self.store.read()['sections']['browser']
        self.assertEqual(current['mawe.language'], 'zh')
        self.assertEqual(current['msw.assets.columns'], '3')

    def test_export_excludes_internal_project_and_secrets(self):
        self.store.update(['browser', 'moy.asr.editor.charcountMigrated.v1'], 'yes')
        output = self.store.request({'action': 'export', 'categories': ['interface']})['package']
        self.assertNotIn('revision', output)
        self.assertNotIn('charcountMigrated', json.dumps(output))
        for content in [{'apiKey': 'private'}, {'__proto__': {}}, {'secret': 'x'}]:
            with self.assertRaises(ValueError):
                parse(package({'browser': {'moy.asr.editor.settings.v1': content}}, ['interface']))

    def test_invalid_files_atomic(self):
        raw = package({'browser': {'mawe.language': 'en'}}, ['interface'])
        before = self.store.path.read_bytes()
        for update in [{'version': 9}, {'sections': {'project': {}}}, {'categories': ['bogus']}, {'kind': 'internal'}]:
            with self.assertRaises(ValueError):
                self.imported({**raw, **update})
        self.assertEqual(before, self.store.path.read_bytes())

    def test_preview_preset_dependency_and_collision(self):
        from maw.project_subtitle_style import builtin_presets
        preset = dict(builtin_presets()[0], id='user-1', name='User')
        self.store.update(['subtitlePresets'], {'version': 1, 'presets': [preset]})
        self.store.update(['browser', 'msw.subtitle-proof.v1'], {'mode': 'user-1'})
        output = self.store.request({'action': 'export', 'categories': ['preview']})['package']
        self.assertIn('subtitlePresets', output['categories'])
        self.store.update(['subtitlePresets'], {'version': 1, 'presets': []})
        preview = self.store.request(dict(action='preview', package=output, categories=['preview'], policy='replace'))
        self.assertTrue(preview['errors'])
        self.imported(output)
        self.assertEqual(self.store.read()['sections']['subtitlePresets']['presets'][0]['id'], 'user-1')

    def test_legacy_workspace_does_not_remove_other_workspaces_or_display_preferences(self):
        self.store.update(['server', 'saved_workspaces'], {'Existing': {'preset': 'classic'}})
        self.store.update(['browser', 'moy.asr.waveform.settings.v1'], {'rowHeight': 200})
        raw = workspace({'schema': 'moy.asr.editor.workspace.v1', 'preset': 'custom', 'tree': {}}, 'Imported')
        self.imported(raw)
        current = self.store.read()['sections']
        self.assertEqual(set(current['server']['saved_workspaces']), {'Existing', 'Imported'})
        self.assertEqual(current['browser']['moy.asr.waveform.settings.v1']['rowHeight'], 200)

    def test_workspace_navigation_is_local_and_not_exported(self):
        self.store.update(['server', 'saved_workspaces'], {'Desk': {'preset': 'classic', 'navigation': {'selected': 'private-project-cue'}}})
        exported = self.store.request({'action': 'export', 'categories': ['waveform']})['package']
        self.assertNotIn('private-project-cue', json.dumps(exported))
        exported['sections']['server']['saved_workspaces']['Desk']['preset'] = 'custom'
        self.imported(exported)
        self.assertEqual(self.store.read()['sections']['server']['saved_workspaces']['Desk']['navigation']['selected'], 'private-project-cue')

    def test_write_failure_keeps_previous_config_and_recovery(self):
        raw = package({'browser': {'mawe.language': 'en'}}, ['interface'])
        before = self.store.path.read_bytes()
        with patch.object(self.store, '_write', side_effect=OSError('test write failure')):
            with self.assertRaises(OSError):
                self.imported(raw)
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(len(self.store.request({'action': 'snapshots'})['snapshots']), 1)

    def test_public_tts_has_no_private_voice_reference_or_connection(self):
        for provider in ('qwen', 'edge', 'yukkuri', 'indextts', 'gpt-sovits', 'minimax', 'mossland'):
            clean = public_recipe(provider, {})
            self.store.update(['defaults', 'tts', provider], clean)
            self.assertNotIn('speaker_ref', clean)
            self.assertNotIn('apiKey', clean)
            if provider not in ('edge', 'yukkuri'):
                self.assertNotIn('voice', clean)
        result = public_recipe('indextts', {'speaker_ref': 'private-ref', 'duration_factor': 1.5, 'apiKey': 'private'})
        self.assertEqual(result['duration_factor'], 1.5)

    def test_imported_recipe_is_used_without_changing_private_resources(self):
        from maw.msw.edge_tts import EdgeTts
        engine = EdgeTts(self.root, None)
        engine.save({'recipe': {'rate': 20}})
        raw = package({'defaults': {'tts': {'edge': public_recipe('edge', {'rate': 40})}}}, ['tts'])
        self.imported(raw)
        self.assertEqual(engine.settings()['recipe']['rate'], 40)
        engine.save({'recipe': {'rate': 10}})
        self.assertEqual(engine.settings()['recipe']['rate'], 10)

    def test_public_plan_removes_paths_and_project_track_scope(self):
        clean = public_plan({'outputDirectory': 'private', 'trackScope': {'sourceTrackId': 'cue-1'},
                             'steps': [{'id': 'match', 'scriptPath': 'private', 'enabled': True}]})
        self.assertNotIn('private', json.dumps(clean))
        self.assertNotIn('trackScope', clean)
        self.store.update(['defaults', 'postprocess'], clean)

    def test_custom_theme_names_without_ids_merge_and_keep_local_collisions(self):
        key = ['browser', 'moy.asr.editor.customThemes.v1']
        self.store.update(key, [{'name': 'A', 'theme': 'dark'}])
        self.imported(package({'browser': {key[1]: [{'name': 'A', 'theme': 'light'}, {'name': 'B', 'theme': 'light'}]}}, ['interface']), 'keep')
        self.assertEqual(self.store.read()['sections']['browser'][key[1]], [{'name': 'A', 'theme': 'dark'}, {'name': 'B', 'theme': 'light'}])

    def test_portable_tts_presets_restore_parameters_without_reference_files(self):
        from maw.msw.index_tts import IndexTts, validate_recipe
        engine = IndexTts(self.root, None)
        engine.write('presets.json', {'Voice': validate_recipe({'duration_factor': 1.3})})
        raw = self.store.request({'action': 'export', 'categories': ['tts']})['package']
        self.assertNotIn('speaker_ref', json.dumps(raw))
        other = UserConfig(self.root / 'other' / 'user-settings.mswconfig')
        req = dict(package=raw, policy='replace', categories=['tts'])
        preview = other.request(dict(action='preview', **req))
        other.request(dict(action='import', **req, token=preview['token'], revision=preview['revision']))
        restored = IndexTts(other.path.parent, None).read('presets.json', {})
        self.assertEqual(restored['Voice']['duration_factor'], 1.3)
        self.assertEqual(restored['Voice']['speaker_ref'], '')

    def test_empty_tts_category_resets_public_defaults_without_reviving_old_files(self):
        from maw.msw.edge_tts import EdgeTts
        engine = EdgeTts(self.root, None)
        engine.save({'recipe': {'rate': 50}})
        self.imported(package({}, ['tts']))
        self.assertEqual(engine.settings()['recipe']['rate'], 0)

    def test_native_dialog_export_and_read(self):
        from maw.gui_web import LauncherApi
        from types import SimpleNamespace
        from webview.util import parse_file_type
        target = self.root / 'Portable.mswconfig'
        api = LauncherApi.__new__(LauncherApi)
        api.paths = SimpleNamespace(env_path=self.root / 'safe-test.env')
        api.paths.env_path.write_text('', encoding='utf-8')
        def choose(**kwargs):
            for value in kwargs['file_types']:
                parse_file_type(value)
            return (str(target),)
        with patch('maw.gui_web._file_dialog', side_effect=choose):
            self.assertTrue(api.save_user_config_file({'categories': ['interface']})['ok'])
            result = api.choose_user_config_file()
        self.assertEqual(json.loads(result['content'])['format'], 'msw-config')
        self.assertEqual(result['name'], target.name)


if __name__ == '__main__':
    unittest.main()
