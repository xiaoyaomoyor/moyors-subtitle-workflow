import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

from maw.msw.asset_export import selected_audio_zip


class SelectedAudioExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.records = {}
        for index in range(3):
            path = self.root / f'{index}.wav'
            content = f'fixture-{index}'.encode()
            path.write_bytes(content)
            self.records[str(index)] = {'id': str(index), 'byte_size': len(content),
                'sha256': hashlib.sha256(content).hexdigest(), 'generation': {'filename': '中文/重名.wav'}}
        self.api = SimpleNamespace(asset_reference=lambda project, id: (self.records.get(id) if project == 'project' else None, None),
            assets=SimpleNamespace(resolve=lambda project, asset, owner: self.root / (asset['id']+'.wav')))

    def test_selection_only_deduplicated_with_safe_unicode_names(self):
        with selected_audio_zip(self.api, 'project', ['2', '0', '2']) as (stream, size):
            self.assertGreater(size, 0)
            with zipfile.ZipFile(stream) as archive:
                self.assertEqual(archive.namelist(), ['0001-中文_重名.wav', '0002-中文_重名.wav'])
                self.assertEqual(archive.read(archive.namelist()[0]), b'fixture-2')
        self.assertTrue(stream.closed)

    def test_unknown_cross_project_and_empty_selections_do_not_produce_a_package(self):
        for project, ids in [('other', ['0']), ('project', ['0', 'missing']), ('project', []), ('project', ['../bad'])]:
            with self.subTest(project=project, ids=ids), self.assertRaises(ValueError):
                with selected_audio_zip(self.api, project, ids):
                    self.fail('must not yield a partial archive')

    def test_changed_bytes_and_size_limit_fail_before_streaming(self):
        (self.root/'0.wav').write_bytes(b'changed!!')
        with self.assertRaises(ValueError):
            with selected_audio_zip(self.api, 'project', ['0']):
                self.fail('changed asset exported')
        with patch('maw.msw.asset_export.MAX_BYTES', 1), self.assertRaises(ValueError):
            with selected_audio_zip(self.api, 'project', ['1']):
                self.fail('limit exceeded')
