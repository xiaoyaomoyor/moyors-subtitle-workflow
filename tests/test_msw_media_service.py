from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
import wave
from unittest.mock import patch

from maw.ffmpeg import resolve_ffmpeg_tools
from maw.msw.media_service import MediaService
from maw.msw.audio_exports import AudioExports
from maw.msw.persistence import ProjectPersistence
from maw.project import normalize_project, ProjectValidationFailed


class MediaServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.tools = resolve_ffmpeg_tools()
        self.context = {'projectId': 'bound', 'binding': 'binding', 'saveRevision': None}
        self.api = SimpleNamespace(data_root=self.root, context=lambda: self.context,
            lock=threading.RLock(), _persistence=None, exports=SimpleNamespace(tools=lambda: self.tools),
            server=SimpleNamespace(save_lock=threading.RLock(), project=SimpleNamespace(
                data={'segments': []}, json_path=None, media_path=None, source_media_path=None)))
        self.media = MediaService(self.api)
        self.api._media = self.media
        self.scope = {'project_id': 'temporary', 'binding': 'binding', 'client_token': 'page'}
        self.source = self.root / 'original.wav'
        with wave.open(str(self.source), 'wb') as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(16000)
            stream.writeframes(b'\0\0' * 32000)

    def tearDown(self):
        self.media.close()
        self.temp.cleanup()

    def test_background_probe_does_not_hold_save_lock_or_publish_after_media_changes(self):
        bound=self.api.server.project
        bound.source_media_path=self.source;bound.data['media']=str(self.source);bound.audio_track=0
        entered,release=threading.Event(),threading.Event();results=[]
        register=self.media.register
        def delayed(*args,**kwargs):
            entered.set();release.wait(5);return register(*args,**kwargs)
        with patch.object(self.media,'register',side_effect=delayed):
            thread=threading.Thread(target=lambda:results.append(self.media.context('bound',str(self.source))))
            thread.start()
            try:
                self.assertTrue(entered.wait(3))
                acquired=self.api.server.save_lock.acquire(timeout=.3)
                self.assertTrue(acquired,'FFprobe must not block saving')
                if acquired:
                    bound.data['media']='another.wav'
                    self.api.server.save_lock.release()
            finally:
                release.set();thread.join(6)
        self.assertEqual(results,[None]);self.assertIsNone(self.media.active('bound'))

    def test_concurrent_windows_share_one_committed_media_identity(self):
        bound=self.api.server.project
        bound.source_media_path=self.source;bound.data['media']=str(self.source);bound.audio_track=0
        barrier=threading.Barrier(2);results=[];register=self.media.register
        def together(*args,**kwargs):
            record=register(*args,**kwargs);barrier.wait(timeout=5);return record
        with patch.object(self.media,'register',side_effect=together):
            threads=[threading.Thread(target=lambda:results.append(self.media.context('bound',str(self.source)))) for _ in range(2)]
            for thread in threads:thread.start()
            for thread in threads:thread.join(7)
        self.assertEqual(len(results),2);self.assertEqual(results[0]['id'],results[1]['id'])

    def upload(self):
        data = self.source.read_bytes()
        start = self.media.begin_upload({**self.scope, 'name': 'dropped.wav', 'size': len(data)})
        identity = start['upload_id']
        first = self.media.chunk(identity, 'temporary', 0, data[:100])
        self.assertEqual(first['offset'], 100)
        self.assertEqual(self.media.chunk(identity, 'temporary', 0, data[:100]), first)
        self.media.chunk(identity, 'temporary', 100, data[100:])
        return self.media.finish_upload({**self.scope, 'upload_id': identity})['media']

    def test_upload_is_not_active_until_committed_and_survives_service_restart(self):
        result = self.upload()
        self.assertIsNone(self.media.active('temporary'))
        self.media.bind({**self.scope, 'media_id': result['id']})
        self.assertEqual(Path(self.media.active('temporary')['path']).read_bytes(), self.source.read_bytes())
        reloaded = MediaService(self.api)
        self.assertEqual(reloaded.context('temporary', result['reference'])['id'], result['id'])
        reloaded.close()

    def test_export_and_recovery_use_registered_source_for_unsaved_project(self):
        result = self.upload()
        self.media.bind({**self.scope, 'media_id': result['id']})
        source, owner, index = AudioExports.source_scope(SimpleNamespace(api=self.api), 'temporary', 'binding')
        self.assertEqual(str(source), result['reference'])
        self.assertEqual(owner['media'], result['reference'])
        self.assertEqual(index, 0)
        persistence = ProjectPersistence(self.api)
        project = {'segments': [], 'media': result['reference'], 'msw': {'schema': 'msw.editor.v1', 'project_id': 'temporary'}}
        record = persistence.draft({'project': project, 'binding': 'binding', 'session': 'page', 'filename': 'empty.mosp'})
        self.assertEqual(str(persistence.recovery.get(record['id'])['media']), result['reference'])

    def test_upload_rejects_wrong_project_bad_offsets_conflicting_retries_and_stale_binding(self):
        result = self.media.begin_upload({**self.scope, 'name': 'video.wav', 'size': 100})
        with self.assertRaises(KeyError):
            self.media.chunk(result['upload_id'], 'other', 0, b'x')
        with self.assertRaises(ValueError):
            self.media.chunk(result['upload_id'], 'temporary', 1, b'x')
        self.media.chunk(result['upload_id'], 'temporary', 0, b'x')
        with self.assertRaises(ValueError):
            self.media.chunk(result['upload_id'], 'temporary', 0, b'y')
        with self.assertRaises(ValueError):
            self.media.finish_upload({**self.scope, 'upload_id': result['upload_id']})
        self.context['binding'] = 'new'
        with self.assertRaises(ValueError):
            self.media.chunk(result['upload_id'], 'temporary', 1, b'z')

    def test_cancel_keeps_source_and_changed_source_invalidates_registration(self):
        upload = self.media.begin_upload({**self.scope, 'name': 'dropped.wav', 'size': 100})
        self.media.cancel_upload({**self.scope, 'upload_id': upload['upload_id']})
        self.assertTrue(self.source.is_file())
        self.assertFalse(self.media.uploads)
        record = self.media.register(self.source, 'temporary')
        with self.source.open('ab') as stream:
            stream.write(b'changed')
        with self.assertRaises(ValueError):
            self.media.get(record['id'], 'temporary')

    def test_native_picker_ignores_request_path_and_cancel_preserves_state(self):
        self.media.picker = lambda: None
        self.assertEqual(self.media.choose({**self.scope, 'path': str(self.source)}), {'cancelled': True})
        self.assertFalse(self.media.records)
        for name in ['../escape.wav', 'x\\escape.wav', 'movie.m3u8']:
            with self.assertRaises(ValueError):
                self.media.begin_upload({**self.scope, 'name': name, 'size': 1})

    def test_duration_contract_accepts_empty_tracks_and_rejects_invalid_duration(self):
        self.assertEqual(normalize_project({'segments': [], 'media_metadata': {'duration_ms': 2000, 'audio_tracks': []}})['segments'], [])
        for value in [True, -1, 1.5, '2000', 8 * 86400000]:
            with self.assertRaises(ProjectValidationFailed):
                normalize_project({'segments': [], 'media_metadata': {'duration_ms': value}})

    @unittest.skipUnless(resolve_ffmpeg_tools().complete, 'FFmpeg required for real media metadata')
    def test_real_probe_reports_duration_and_container_stream_index(self):
        result = self.upload()
        self.assertEqual(result['metadata']['duration_ms'], 2000)
        self.assertEqual(result['metadata']['audio_tracks'][0]['stream_index'], 0)
        self.assertEqual(result['metadata']['audio_tracks'][0]['sample_rate'], 16000)


if __name__ == '__main__':
    unittest.main()
