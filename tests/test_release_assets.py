from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from scripts.check_release_assets import check_release, expected_names


class ReleaseAssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tag = 'v1.6.0-beta.1'

    def make_windows(self):
        for name in expected_names(self.tag, 'windows'):
            with ZipFile(self.root / name, 'w') as archive:
                files = ['MSW.exe', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'FAQ-常见问题.txt',
                         'README-开始使用.txt', '_internal/web/launcher/logo.svg', '_internal/web/favicon.svg',
                         '_internal/maw/msw/yukkuri_worker.mjs', '_internal/maw/msw/yukkuri_resources.json']
                if '-lite-' not in name:
                    files += ['ffmpeg/bin/ffmpeg.exe', 'ffmpeg/bin/ffprobe.exe']
                for file in files:
                    archive.writestr('MSW/' + file, b'synthetic-test-resource')

    def test_missing_platform_or_unexpected_upload_blocks_release(self):
        self.make_windows()
        with self.assertRaisesRegex(ValueError, 'missing='):
            check_release(self.root, self.tag)
        (self.root / 'private-project.mosp').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'unexpected='):
            check_release(self.root, self.tag, 'windows')

    def test_complete_pair_has_hashes_and_lite_must_not_include_ffmpeg(self):
        self.make_windows()
        hashes = check_release(self.root, self.tag, 'windows')
        self.assertEqual(len(hashes), 2)
        self.assertTrue(all(len(digest) == 64 for _, digest in hashes))
        lite = next(self.root.glob('*-lite-*.zip'))
        with ZipFile(lite, 'a') as archive:
            archive.writestr('MSW/ffmpeg/bin/ffmpeg.exe', b'unexpected')
        with self.assertRaisesRegex(ValueError, 'lite package unexpectedly'):
            check_release(self.root, self.tag, 'windows')

    def test_private_configuration_cannot_enter_an_archive(self):
        self.make_windows()
        archive_path = next(self.root.glob('*.zip'))
        with ZipFile(archive_path, 'a') as archive:
            archive.writestr('MSW/.env', b'synthetic-test-only')
        with self.assertRaisesRegex(ValueError, 'private/cache'):
            check_release(self.root, self.tag, 'windows')

    def test_regular_file_renamed_to_appimage_is_rejected(self):
        name, = expected_names(self.tag, 'linux')
        (self.root / name).write_bytes(b'not-an-AppImage')
        with self.assertRaisesRegex(ValueError, 'AppImage'):
            check_release(self.root, self.tag, 'linux')

    def test_corrupt_zip_or_missing_resource_is_rejected(self):
        self.make_windows()
        archive_path = next(self.root.glob('*.zip'))
        with ZipFile(archive_path, 'w') as archive:
            archive.writestr('MSW/MSW.exe', b'incomplete')
        with self.assertRaisesRegex(ValueError, 'missing'):
            check_release(self.root, self.tag, 'windows')


if __name__ == '__main__':
    unittest.main()
