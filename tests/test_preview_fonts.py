import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from maw.msw.subtitle_preview import font_manifest, font_file


class PreviewFontManifestTests(unittest.TestCase):
    def test_all_requested_files_are_returned_after_24_and_aliases_share_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            paths=[]
            for i in range(30):
                p=Path(folder)/f'{i:02}.ttf';p.write_bytes(b'font');paths.append(p)
            registry={f'family{i}':{p} for i,p in enumerate(paths)}
            registry['alias']={paths[-1]}
            with patch('maw.msw.subtitle_preview.installed_fonts',return_value=registry):
                manifest=font_manifest(list(registry))
                self.assertEqual(len(manifest['fonts']),30)
                self.assertEqual(manifest['missing'],[])
                self.assertEqual(manifest['unavailable'],[])
                self.assertEqual({font_file(f['id']) for f in manifest['fonts']},set(paths))
                old=manifest['fonts'][0]['id'];paths[0].write_bytes(b'new version')
                self.assertNotEqual(font_manifest(['family0'])['fonts'][0]['id'],old)

    def test_memory_limit_and_unreadable_files_are_reported_by_family(self):
        paths=[Path(f'font-{i}') for i in range(7)]
        def info(p):
            if p==paths[-1]:raise OSError('unreadable')
            return SimpleNamespace(st_size=(65 if p==paths[0] else 64)*1024*1024,st_mtime_ns=1)
        with patch('maw.msw.subtitle_preview.installed_fonts',return_value={f'f{i}':{p} for i,p in enumerate(paths)}),patch.object(Path,'stat',info):
            manifest=font_manifest([*(f'f{i}' for i in range(7)),'missing'])
        self.assertEqual(len(manifest['fonts']),4)
        self.assertEqual(manifest['missing'],['missing'])
        self.assertEqual({f['family'] for f in manifest['unavailable']},{'f0','f5','f6'})
        self.assertTrue(all(f['reason'] for f in manifest['unavailable']))
