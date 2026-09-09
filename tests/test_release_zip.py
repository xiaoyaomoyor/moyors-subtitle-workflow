import os
from pathlib import Path
import stat
import tempfile
import unittest
from zipfile import ZipFile

from scripts.create_release_zip import create_zip


class ReleaseZipTests(unittest.TestCase):
    def test_unicode_names_contents_and_executable_mode_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / 'stage'
            stage.mkdir()
            document = stage / 'README-开始使用.txt'
            document.write_text('欢迎使用 MSW', encoding='utf-8')
            executable = stage / 'MSW.app' / 'Contents' / 'MacOS' / 'MSW'
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b'example-executable')
            executable.chmod(0o755)
            output = root / 'release.zip'
            create_zip(stage, output)
            with ZipFile(output) as archive:
                self.assertEqual(archive.read(document.name), document.read_bytes())
                self.assertTrue(archive.getinfo(document.name).flag_bits & 0x800)
                self.assertEqual(archive.read('MSW.app/Contents/MacOS/MSW'), executable.read_bytes())
                if os.name != 'nt':
                    self.assertEqual(stat.S_IMODE(archive.getinfo('MSW.app/Contents/MacOS/MSW').external_attr >> 16), 0o755)
                self.assertIsNone(archive.testzip())

    def test_bundle_symlink_is_preserved_without_following_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / 'stage'
            (stage / 'Resources').mkdir(parents=True)
            (stage / 'Resources' / '说明.txt').write_text('Resource', encoding='utf-8')
            try:
                (stage / 'Frameworks').symlink_to('Resources', target_is_directory=True)
            except OSError:
                self.skipTest('Directory symlinks are unavailable on this host')
            create_zip(stage, root / 'bundle.zip')
            with ZipFile(root / 'bundle.zip') as archive:
                self.assertTrue(stat.S_ISLNK(archive.getinfo('Frameworks').external_attr >> 16))
                self.assertEqual(archive.read('Frameworks'), b'Resources')
                self.assertNotIn('Frameworks/说明.txt', archive.namelist())

    def test_output_cannot_be_inside_its_source_tree(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(ValueError):
                create_zip(root, root / 'recursive.zip')
