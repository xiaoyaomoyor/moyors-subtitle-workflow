"""Real pywebview filter grammar at the launcher file-picker boundary."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tests  # isolate application data
from maw.gui_web import LauncherApi, LauncherPaths


class FilePickerTests(unittest.TestCase):
    def test_all_picker_filters_parse_and_mixed_selection_preserves_paths(self):
        from webview.util import parse_file_type

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            api = LauncherApi(paths=LauncherPaths(root=root, env_path=root / 'test.env',
                launcher_html=root / 'index.html', recent_metadata=root / 'recent.json',
                project_registry=root / 'registry.json'))
            selected = (str(root / '字幕 #1.srt'), str(root / 'clip.mosp'))

            def select(**kwargs):
                for filter_text in kwargs['file_types']:
                    description, extensions = parse_file_type(filter_text)
                    self.assertTrue(description)
                    self.assertTrue(extensions.startswith('*'))
                return selected if kwargs['multiple'] else selected[:1]

            for kind in ('prefab', 'waveform', 'json', 'subtitle', 'subtitle-burn',
                         'video', 'ffconcat', 'script', 'hotwords', 'media'):
                with self.subTest(kind=kind), patch('maw.gui_web._file_dialog', side_effect=select):
                    result = api.choose_file({'kind': kind, 'multiple': True})
                    self.assertEqual(result, {'ok': True, 'path': selected[0], 'paths': list(selected)})
            with patch('maw.gui_web._file_dialog', return_value=None):
                self.assertEqual(api.choose_file({'kind': 'prefab', 'multiple': True}),
                                 {'ok': False, 'path': ''})
