import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maw.gui_config import local_device_choices
from maw.gui_web import LauncherApi, LauncherPaths
from maw.local_model_preferences import KEY, load_model_paths, save_model_paths
from maw.msw import asr_config
from maw.user_config import UserConfig, config_path

QWEN = 'qwen3-asr-local'
WHISPER = 'whisper-large-v3-local'


class LocalModelPreferenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.env = self.root / 'isolated.env'
        self.env.write_text('', encoding='utf-8')
        self.paths = LauncherPaths(root=self.root, env_path=self.env, launcher_html=self.root / 'launcher.html')
        self.api = LauncherApi(paths=self.paths, window_getter=lambda: None)
        probe = patch('maw.local_models.local_model_payload', return_value={'installed': False})
        probe.start()
        self.addCleanup(probe.stop)

    def test_launcher_directory_survives_reopen_and_editor_sees_it(self):
        path = str(self.root / 'Qwen')
        self.assertTrue(self.api.save_prefs({'localModelPaths': {QWEN: path}})['ok'])
        reopened = LauncherApi(paths=self.paths, window_getter=lambda: None)
        self.assertEqual(reopened.get_config()['localModelPaths'], {QWEN: path})
        self.assertEqual(asr_config.catalog(self.env)['localModelPaths'], {QWEN: path})
        self.assertEqual(self.env.read_text(), '')

    def test_editor_directory_is_model_specific_and_can_be_cleared(self):
        for model, path in [(QWEN, 'C:/Models/Qwen'), (WHISPER, 'C:/Models/Whisper')]:
            asr_config.save_settings(self.env, {'providerId': 'local', 'modelId': model,
                                               'localModelPath': path, 'device': 'auto'}, section='call')
        self.assertEqual(load_model_paths(self.env), {QWEN: 'C:/Models/Qwen', WHISPER: 'C:/Models/Whisper'})
        # Leaving a field out while switching models must not reuse Whisper's path.
        settings = asr_config.resolve_settings(self.env, {'providerId': 'local', 'modelId': QWEN}, validate_runtime=False)
        self.assertEqual(settings.request.model_path, 'C:/Models/Qwen')
        self.api.save_prefs({'localModelPaths': {QWEN: ''}})
        self.assertEqual(load_model_paths(self.env)[QWEN], '')
        self.assertEqual(load_model_paths(self.env)[WHISPER], 'C:/Models/Whisper')

    def test_legacy_editor_directory_migrates_without_overwriting_clear(self):
        self.env.write_text('MSW_EDITOR_ASR_OPTIONS=' + json.dumps({'modelId': QWEN, 'localModelPath': 'C:/old'}) + '\n')
        self.assertEqual(load_model_paths(self.env), {QWEN: 'C:/old'})
        save_model_paths(self.env, {QWEN: ''})
        self.assertEqual(load_model_paths(self.env), {QWEN: ''})

    def test_invalid_paths_and_export_exclusion(self):
        for raw in ({'cloud-model': 'C:/x'}, {QWEN: 'bad\npath'}, {QWEN: 12}, []):
            self.assertFalse(self.api.save_prefs({'localModelPaths': raw})['ok'])
        save_model_paths(self.env, {QWEN: 'C:/private-model'})
        exported = UserConfig(config_path(self.env)).request({'action': 'export', 'categories': ['launcher', 'asr']})
        self.assertNotIn(KEY, json.dumps(exported))
        self.assertNotIn('private-model', json.dumps(exported))

    def test_devices_are_model_and_platform_specific_before_runtime_validation(self):
        with patch('maw.gui_config.sys.platform', 'darwin'):
            self.assertIn('mps', local_device_choices('qwen-asr'))
            self.assertNotIn('mps', local_device_choices('whisper'))
            options = {'providerId': 'local', 'modelId': QWEN, 'device': 'mps'}
            self.assertEqual(asr_config.resolve_settings(self.env, options, validate_runtime=False).request.device, 'mps')
            with self.assertRaisesRegex(ValueError, 'MPS'):
                asr_config.resolve_settings(self.env, {**options, 'modelId': WHISPER}, validate_runtime=False)
        with patch('maw.gui_config.sys.platform', 'win32'):
            self.assertNotIn('mps', local_device_choices('qwen-asr'))
            with self.assertRaisesRegex(ValueError, 'MPS'):
                asr_config.resolve_settings(self.env, options, validate_runtime=False)


if __name__ == '__main__':
    unittest.main()
