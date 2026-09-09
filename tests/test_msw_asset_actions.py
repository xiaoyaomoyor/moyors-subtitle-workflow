import base64
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest

from maw.ffmpeg import resolve_ffmpeg_tools
from maw.msw.assets import AssetStore, audio_info
from maw.msw.audio_import import AudioImporter
from maw.msw.project_codec import normalize_extension, valid_removed_assets
from test_msw_tts import wav_bytes
import test_msw_processing as processing_tests


class AssetActionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = AssetStore(self.root / 'assets')
        self.api = SimpleNamespace(assets=self.store, exports=SimpleNamespace(tools=lambda: SimpleNamespace(ffmpeg=None)),
                                   jobs=SimpleNamespace(lock=threading.RLock(), reserved_tts_assets=lambda _: 0))
        self.importer = AudioImporter(self.api)

    def tearDown(self):
        self.importer.close()
        self.temp.cleanup()

    def payload(self, audio=None, filename='external.wav', request='request'):
        return {'project_id': 'p', 'request_key': request, 'filename': filename,
                'audio_base64': base64.b64encode(audio if audio is not None else wav_bytes()).decode()}

    def test_pcm_import_is_idempotent_and_persists_without_original(self):
        first = self.importer.import_audio(self.payload())
        second = self.importer.import_audio(self.payload())
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(self.store.count('p'), 1)
        self.assertEqual(first['generation']['provider'], 'imported')
        self.assertEqual(first['generation']['spoken_text'], '')
        self.assertEqual(first['source_ref']['end'], 100)
        project = {'msw': {'schema': 'msw.editor.v1', 'project_id': 'p', 'assets': [first]}}
        normalize_extension(project['msw'])
        target = self.root / 'saved/project.mosp'
        self.store.persist_project(project, target)
        self.assertEqual((target.parent / first['path']).read_bytes(), wav_bytes())
        with self.assertRaises(ValueError):
            self.importer.import_audio(self.payload(filename='changed.wav'))

    def test_invalid_upload_missing_frames_and_limits_do_not_register_assets(self):
        for payload in [self.payload(wav_bytes()[:-2]), self.payload(filename='../escape.wav'), self.payload(filename='list.m3u'),
                        {**self.payload(), 'audio_base64': 'bad-base64'}, {**self.payload(), 'library_size': 10000}]:
            with self.subTest(filename=payload['filename']), self.assertRaises(ValueError):
                self.importer.import_audio(payload)
        self.assertEqual(self.store.count('p'), 0)
        self.importer.close()
        with self.assertRaises(ValueError):
            self.importer.import_audio(self.payload())

    def test_deleted_asset_contract_excludes_inventory_and_releases_quota(self):
        asset = self.importer.import_audio(self.payload())
        extension = {'schema': 'msw.editor.v1', 'project_id': 'p', 'assets': [], 'removed_asset_ids': [asset['id']]}
        self.assertEqual(normalize_extension(extension), extension)
        self.assertEqual(self.store.count('p', extension['removed_asset_ids']), 0)
        self.assertEqual(self.store.get('p', asset['id']), asset)  # Still available to undo/export snapshots.
        with self.assertRaises(ValueError):
            normalize_extension({**extension, 'assets': [asset]})
        for value in (None, {}, ['../bad'], [asset['id'], asset['id']]):
            self.assertFalse(valid_removed_assets(value))

    def test_import_respects_tts_reservations_created_during_conversion(self):
        self.api.jobs.reserved_tts_assets = lambda _: 10000
        with self.assertRaisesRegex(ValueError, '待合成'):
            self.importer.import_audio(self.payload())
        self.api.jobs.reserved_tts_assets = lambda _: 0
        original_convert = self.importer.convert
        def convert_and_reserve(audio, suffix):
            result = original_convert(audio, suffix)
            self.api.jobs.reserved_tts_assets = lambda _: 10000
            return result
        self.importer.convert = convert_and_reserve
        with self.assertRaisesRegex(ValueError, '待合成'):
            self.importer.import_audio(self.payload())
        self.assertEqual(self.store.count('p'), 0)

    @unittest.skipUnless(os.environ.get('MSW_TEST_FFMPEG'), 'requires FFmpeg')
    def test_real_compressed_import_and_decoded_size_limit(self):
        tools = resolve_ffmpeg_tools(configured_path=os.environ['MSW_TEST_FFMPEG'])
        self.api.exports.tools = lambda: tools
        source = self.root / 'source.wav'
        source.write_bytes(wav_bytes())
        for extension, codec in [('mp3', 'libmp3lame'), ('flac', 'flac'), ('m4a', 'aac'), ('ogg', 'libvorbis'), ('opus', 'libopus')]:
            target = self.root / ('converted.' + extension)
            subprocess.run([str(tools.ffmpeg), '-v', 'error', '-i', str(source), '-c:a', codec, str(target)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            result = self.importer.import_audio(self.payload(target.read_bytes(), target.name, extension))
            info = audio_info(self.store.resolve('p', result).read_bytes())
            self.assertEqual(info['sample_rate'], 48000)
            self.assertEqual(info['channels'], 2)
        from unittest.mock import patch
        with patch('maw.msw.audio_import.MAX_AUDIO_BYTES', 1024), self.assertRaisesRegex(ValueError, '截断'):
            self.importer.import_audio(self.payload(target.read_bytes(), target.name, 'too-large'))


class AssetImportApiTests(processing_tests.ProcessingApiTests):
    def tearDown(self):
        api = self.server.processing_api
        api.close()
        if api._manager:
            self.assertTrue(api._manager.close_complete.wait(3), 'task store did not close')
        super().tearDown()

    def test_import_route_is_scoped_and_preserves_exported_project(self):
        api = self.server.processing_api
        api.data_root = self.root / 'appdata'
        body = {'project_id': 'project-test', 'request_key': 'upload', 'filename': 'imported.wav',
                'audio_base64': base64.b64encode(wav_bytes()).decode()}
        self.assertEqual(self.call('asset-import', body, headers={'Origin': 'https://example.test'})[0], 403)
        status, result = self.call('asset-import', body)
        self.assertEqual(status, 200, result)
        project = copy.deepcopy(self.server.project.data)
        project['msw']['assets'] = [result['asset']]
        _, context = self.call('capabilities')
        status, saved = self.call('project', {'project': project, 'binding': context['binding'], 'saveRevision': context['saveRevision']})
        self.assertEqual(status, 200, saved)
        self.assertTrue((self.path.parent / result['asset']['path']).is_file())
        self.assertEqual(json.loads(self.path.read_text())['msw']['assets'][0]['generation']['provider'], 'imported')
