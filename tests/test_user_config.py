import concurrent.futures
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maw.user_config import UserConfig, ConfigConflict, changes, REGISTRY


class UserConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = UserConfig(self.root / 'user-settings.mswconfig')

    def test_migrate_preserves_personal_values_and_original_files(self):
        path = self.root / 'server-editor-settings.json'
        path.write_text(json.dumps({'appearance': {'settings': {'theme': 'light'}}, 'recent_projects': [{'path': 'private'}]}))
        original = path.read_bytes()
        self.store.migrate_files()
        self.store.migrate({'browser': {'moy.asr.editor.settings.v1': {'theme': 'dark', 'seekStepMs': 200}}}, 'browser')
        settings = self.store.read()['sections']['browser']['moy.asr.editor.settings.v1']
        self.assertEqual(settings, {'theme': 'light', 'seekStepMs': 200})
        self.assertEqual(path.read_bytes(), original)
        self.assertNotIn('private', self.store.path.read_text())
        self.assertTrue(list((self.root / 'config-migration-backups').glob('*.mswconfig')))

    def test_browser_migration_is_once_across_origins_and_deletions(self):
        source = {'browser': {'mawe.language': 'en'}}
        self.store.migrate(source, 'browser')
        self.store.patch([{'path': ['browser', 'mawe.language'], 'exists': True, 'before': 'en', 'delete': True}])
        self.store.migrate(source, 'browser')
        self.assertNotIn('mawe.language', self.store.read()['sections']['browser'])

    def test_concurrent_independent_preferences_survive_and_conflicts_are_atomic(self):
        self.store.migrate({'browser': {'moy.asr.editor.settings.v1': {'theme': 'dark', 'seekStepMs': 200}}}, 'browser')
        prefix = ['browser', 'moy.asr.editor.settings.v1']
        self.store.patch(changes({'theme': 'dark'}, {'theme': 'light'}, prefix))
        self.store.patch(changes({'seekStepMs': 200}, {'seekStepMs': 500}, prefix))
        original = self.store.path.read_bytes()
        with self.assertRaises(ConfigConflict):
            self.store.patch(changes({'theme': 'dark', 'seekStepMs': 500}, {'theme': 'blue', 'seekStepMs': 1000}, prefix))
        self.assertEqual(self.store.path.read_bytes(), original)
        self.assertEqual(self.store.read()['sections']['browser'][prefix[1]], {'theme': 'light', 'seekStepMs': 500})

    def test_ordered_batch_and_idempotent_retry(self):
        batch = [{'id': 'first', 'path': ['browser', 'mawe.language'], 'exists': False, 'value': 'en'},
                 {'id': 'second', 'path': ['browser', 'mawe.language'], 'exists': True, 'before': 'en', 'value': 'zh'}]
        self.store.patch(batch)
        revision = self.store.read()['revision']
        self.store.patch(batch)  # A successful write with a lost HTTP response.
        self.assertEqual(self.store.read()['revision'], revision)
        self.assertEqual(self.store.read()['sections']['browser']['mawe.language'], 'zh')

    def test_thread_writes_do_not_lose_fields(self):
        def save(i):
            UserConfig(self.store.path).patch([{'path': ['server', 'saved_workspaces', str(i)], 'exists': False, 'value': {'layout': 'custom'}}])
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(save, range(16)))
        self.assertEqual(len(self.store.read()['sections']['server']['saved_workspaces']), 16)

    def test_credentials_unknown_keys_future_and_corrupt_files_do_not_overwrite(self):
        for value in [{'credentials': {}}, {'browser': {'unknown': 'x'}}, {'browser': {'moy.asr.editor.settings.v1': {'apiKey': 'private'}}}]:
            with self.assertRaises(ValueError):
                self.store.migrate(value, 'browser')
        for text in ['{broken', '{"format":"msw-config","version":900}']:
            self.store.path.write_text(text)
            with self.assertRaises(ValueError):
                self.store.update(['browser', 'mawe.language'], 'en')
            self.assertEqual(self.store.path.read_text(), text)

    def test_non_sensitive_env_migration_preserves_credentials_and_explicit_overrides(self):
        from maw.gui_config import load_env, save_env, effective_config
        env = self.root / '.env'
        original = 'DASHSCOPE_API_KEY=fixture-only\nMAW_GUI_THEME=light\nMAW_GUI_LANG=zh\n'
        env.write_text(original)
        with patch.dict(os.environ, {'MSW_APP_DATA_ROOT': '', 'MAW_APP_DATA_ROOT': ''}):
            self.assertEqual(load_env(env)['MAW_GUI_THEME'], 'light')
            save_env(env, {'MAW_GUI_THEME': 'dark'})
            self.assertEqual(load_env(env)['MAW_GUI_THEME'], 'dark')
            self.assertEqual(effective_config(env, {'MAW_GUI_THEME': 'system'}).theme, 'system')
        self.assertEqual(env.read_text(), original)
        self.assertNotIn('fixture-only', self.store.path.read_text())

    def test_backup_is_previous_revision_and_replace_failure_keeps_original(self):
        self.store.update(['browser', 'mawe.language'], 'en')
        old = self.store.read()
        self.store.update(['browser', 'mawe.language'], 'zh')
        self.assertEqual(json.loads(self.store.path.with_suffix('.mswconfig.bak').read_text()), old)
        before = self.store.path.read_bytes()
        with patch('maw.user_config.os.replace', side_effect=OSError('fixture failure')):
            with self.assertRaises(OSError):
                self.store.update(['browser', 'mawe.language'], 'en')
        self.assertEqual(before, self.store.path.read_bytes())

    def test_registry_excludes_projects_queues_machine_paths(self):
        for key in ('MSW_HOME_SELECTED_PATH', 'msw.processing.drafts.project', 'msw.local-asr-options', 'moy.asr.editor.savedAt.v1'):
            self.assertNotIn(key, REGISTRY)

    def test_launcher_bridge_does_not_expose_credentials_and_keeps_window_baselines(self):
        from maw.gui_web import LauncherApi, LauncherPaths
        env = self.root / '.env'
        env.write_text('DASHSCOPE_API_KEY=fixture-secret\nMAW_GUI_THEME=light\n')
        paths = LauncherPaths(root=self.root, env_path=env, launcher_html=self.root / 'index.html',
                              recent_metadata=self.root / 'recent.json', project_registry=self.root / 'registry.json')
        a, b = LauncherApi(paths=paths), LauncherApi(paths=paths)
        self.assertNotIn('fixture-secret', json.dumps(a.get_user_config()))
        b.get_user_config()
        self.assertTrue(a.save_prefs({'theme': 'dark'})['ok'])
        self.assertTrue(b.save_prefs({'zoomPercent': 115})['ok'])
        self.assertFalse(b.save_prefs({'theme': 'system'})['ok'])
        saved = self.store.read()['sections']['launcher']
        self.assertEqual(saved['MAW_GUI_THEME'], 'dark')
        self.assertEqual(saved['MAW_GUI_ZOOM_PERCENT'], '115')


if __name__ == '__main__':
    unittest.main()
