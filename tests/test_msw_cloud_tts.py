"""Cloud protocol tests use synthetic credentials/audio; no paid API calls."""
import base64
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from maw.msw import minimax_tts as mini, mossland_tts as moss, tts_engines
from maw.msw.cloud_tts import object_json
from maw.msw.jobs import JobCancelled, JobManager, TERMINAL
from maw.msw.tts import TtsService, TtsServiceError
from maw.msw.assets import AssetStore
from test_msw_gpt_sovits import wav


def encoded(value):
    return json.dumps(value).encode(), 'application/json'


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.converter = Mock(side_effect=lambda data, suffix, **kw: wav(.2))
        self.mini = mini.MiniMaxTts(self.root, self.root/'isolated.env', self.converter)
        self.moss = moss.MosslandTts(self.root, self.root/'isolated.env', self.converter)
        self.addCleanup(self.mini.close)
        self.addCleanup(self.moss.close)

    def settings(self, controller, **recipe):
        return controller.resolve({'apiKey': 'synthetic-secret', 'recipe': dict(controller.default, voice='voice(test)', **recipe)})

    def test_configuration_and_region_account_isolation(self):
        self.mini.save({'apiKey': 'synthetic-secret', 'recipe': dict(mini.DEFAULT_RECIPE, voice='test')})
        payload = self.mini.payload()
        self.assertNotIn('synthetic-secret', json.dumps(payload))
        self.assertTrue(payload['regions'][0]['hasApiKey'])
        s = self.mini.resolve({})
        self.assertEqual(s.base_url, mini.ENDPOINTS['cn'])
        self.assertNotEqual(self.mini.cache_path(s), self.mini.cache_path(self.settings(self.mini, region='global')))
        other = self.mini.resolve({'apiKey': 'another-account'})
        self.assertNotEqual(self.mini.cache_path(s), self.mini.cache_path(other))
        with self.assertRaises(ValueError):
            self.mini.resolve({'recipe': dict(mini.DEFAULT_RECIPE, voice='test', region='global')})

    def test_model_capabilities_and_numeric_validation(self):
        for key, value in [('volume', float('nan')), ('speed', True), ('pitch', .2), ('emotion', 'whisper'), ('region', 'http://localhost')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                mini.validate_recipe(dict(mini.DEFAULT_RECIPE, voice='x', **{key: value}))
        mini.validate_recipe(dict(mini.DEFAULT_RECIPE, voice='Chinese (Mandarin)_Reliable_Executive', model='speech-2.6-hd', emotion='whisper'))
        with self.assertRaises(ValueError):
            moss.validate_recipe(dict(moss.DEFAULT_RECIPE, voice='x', model='moss-tts-1.0-pro', language_type='Japanese'))

    def test_minimax_audio_payload_and_business_errors(self):
        s = self.settings(self.mini, emotion='happy', speed=1.2, volume=2, pitch=3)
        with patch.object(self.mini, 'request', return_value=encoded({'base_resp': {'status_code': 0}, 'data': {'status': 2, 'audio': b'mp3-data'.hex()}})) as request:
            self.assertTrue(mini.synthesize(s, 'spoken', threading.Event()).startswith(b'RIFF'))
        body = request.call_args.kwargs['json']
        self.assertEqual(body['voice_setting'], {'voice_id': 'voice(test)', 'speed': 1.2, 'vol': 2, 'pitch': 3, 'emotion': 'happy'})
        self.assertEqual(body['text'], 'spoken')
        for content in [{'base_resp': {'status_code': 1008, 'status_msg': 'secret'}},
                        {'base_resp': None}, {'base_resp': {'status_code': []}},
                        {'base_resp': {'status_code': 0}, 'data': None},
                        {'base_resp': {'status_code': 0}, 'data': {'status': 1, 'audio': '00'}},
                        {'base_resp': {'status_code': 0}, 'data': {'status': 2, 'audio': 'bad'}}]:
            with patch.object(self.mini, 'request', return_value=encoded(content)), self.assertRaises(TtsServiceError) as error:
                mini.synthesize(s, 'x', threading.Event())
            self.assertNotIn('secret', str(error.exception))

    def test_minimax_balance_error_identifies_api_account_without_leaking_response(self):
        with self.assertRaises(TtsServiceError) as caught:
            mini.checked(encoded({'base_resp': {'status_code': 1008, 'status_msg': 'secret'}})[0])
        self.assertIn('API 余额', str(caught.exception))
        self.assertIn('1008', str(caught.exception))
        self.assertNotIn('secret', str(caught.exception))

    def test_moss_optional_duration_is_validated_and_forwarded_without_padding_text(self):
        for invalid in [0, -1, 601, True, '2', float('nan'), float('inf')]:
            with self.assertRaises(ValueError):
                moss.validate_recipe({**moss.DEFAULT_RECIPE, 'voice': 'test', 'expected_duration_sec': invalid})
        for seconds in [None, 2.0]:
            recipe = {} if seconds is None else {'expected_duration_sec': seconds}
            with patch.object(self.moss, 'request', return_value=(wav(.2), 'audio/wav')) as request:
                audio = moss.synthesize(self.settings(self.moss, **recipe), '但说实话', threading.Event())
            body = request.call_args.kwargs['json']
            self.assertEqual(body['input'], '但说实话')
            self.assertEqual(body.get('expected_duration_sec'), seconds)
            self.assertTrue(audio.startswith(b'RIFF'))

    def test_moss_sync_wav_and_no_fabricated_controls(self):
        with patch.object(self.moss, 'request', return_value=(wav(.2), 'audio/wav')) as request:
            moss.synthesize(self.settings(self.moss, language_type='Japanese'), 'hello', threading.Event())
        body = request.call_args.kwargs['json']
        self.assertEqual(body['language'], 'Japanese')
        self.assertEqual(body['delivery_method'], 'audio')
        self.assertFalse(body['async'])
        self.assertNotIn('speed', body)
        with patch.object(self.moss, 'request', return_value=encoded({'status': 'PENDING', 'id': 'task'})), self.assertRaises(TtsServiceError):
            moss.synthesize(self.settings(self.moss), 'hello', threading.Event())

    def test_catalog_pagination_and_failed_refresh_preserves_cache(self):
        raw = {'action': 'refresh', 'apiKey': 'synthetic-secret'}
        pages = [encoded({'data': [{'id': 'a', 'name': 'A'}], 'has_more': True, 'next_cursor': 'next'}),
                 encoded({'data': [{'id': 'b'}], 'has_more': False})]
        with patch.object(self.moss, 'request', side_effect=pages) as request:
            out = self.moss.action(raw)
        self.assertEqual([r['id'] for r in out['voices']], ['a', 'b'])
        self.assertEqual(request.call_args.kwargs['params']['after'], 'next')
        with patch.object(self.moss, 'request', side_effect=TtsServiceError('offline')), self.assertRaises(TtsServiceError):
            self.moss.action(raw)
        self.assertEqual(self.moss.payload(raw)['voices'], out['voices'])
        self.assertEqual(self.moss.payload({'apiKey': 'different-account'})['voices'], [])

    def test_create_voice_deduplicates_and_persists_unknown_submissions(self):
        raw = {'action': 'create-voice', 'apiKey': 'synthetic-secret', 'name': 'Reference', 'request_key': 'one',
               'suffix': '.wav', 'audio': base64.b64encode(wav(.2)).decode()}
        with patch.object(self.moss, 'request', return_value=encoded({'id': 'created', 'name': 'Reference'})) as request:
            first = self.moss.action(raw)
            self.assertEqual(self.moss.action(raw)['created_voice'], first['created_voice'])
            request.assert_called_once()
        self.assertEqual(self.moss.payload(raw)['voices'][0]['id'], 'created')
        raw['request_key'] = 'unknown'
        with patch.object(self.moss, 'request', side_effect=TtsServiceError('timeout')) as request:
            with self.assertRaises(TtsServiceError):
                self.moss.action(raw)
            with self.assertRaisesRegex(ValueError, '尚未确认'):
                self.moss.action(raw)
            request.assert_called_once()
        self.converter.side_effect = lambda *a, **kw: wav(31)
        raw['request_key'] = 'long'
        with patch.object(self.moss, 'request') as request, self.assertRaisesRegex(ValueError, '30 秒'):
            self.moss.action(raw)
        request.assert_not_called()

    def test_seven_engines_and_cloud_jobs_keep_original_recipe_and_spoken_text(self):
        self.assertEqual(len(tts_engines.capabilities()), 7)
        assets = AssetStore(self.root/'assets')
        manager = JobManager(self.root/'jobs.sqlite3', tts=TtsService(assets))
        def close():
            manager.close()
            self.assertTrue(manager.close_complete.wait(5))
        self.addCleanup(close)
        for controller, module in [(self.mini, mini), (self.moss, moss)]:
            settings = self.settings(controller)
            snapshot = {'project_id': 'project', 'entries': [{'key': controller.provider, 'id': 'cue', 'track_id': 'secondary',
                         'start': 0, 'end': 1000, 'text': '显示原文', 'pronunciation_override': '实际朗读'}]}
            with patch.object(module, 'synthesize', return_value=wav(.2)) as synth:
                job = manager.submit({'kind': 'tts', 'project_id': 'project', 'request_key': controller.provider, 'snapshot': snapshot}, settings)
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    state = manager.get(job['id'], 'project')
                    if state['status'] in TERMINAL:
                        break
                    time.sleep(.01)
                self.assertEqual(state['status'], 'succeeded')
                self.assertEqual(synth.call_args.args[1], '实际朗读')
        for asset in assets.list('project')['assets']:
            self.assertEqual(asset['source_ref']['track_id'], 'secondary')
            self.assertEqual(asset['generation']['display_text'], '显示原文')
            self.assertEqual(asset['generation']['spoken_text'], '实际朗读')
            self.assertNotIn('synthetic-secret', json.dumps(asset))

    def response(self, *, status=200, chunks=(b'complete',), delay=0):
        value = Mock(status_code=status, headers={'Content-Type': 'audio/wav'})
        value.__enter__ = Mock(return_value=value)
        value.__exit__ = Mock(return_value=False)
        def content(*args):
            for chunk in chunks:
                time.sleep(delay)
                yield chunk
        value.iter_content.side_effect = content
        return value

    def test_transport_cancel_no_redirect_no_retry_and_redaction(self):
        settings = self.settings(self.mini)
        cancel = threading.Event()
        timer = threading.Timer(.05, cancel.set)
        timer.start()
        response = self.response(delay=.2)
        with patch('requests.Session.request', return_value=response) as request, self.assertRaises(JobCancelled):
            self.mini.request(settings, 'POST', '/v1/t2a_v2', cancel, json={})
        timer.join()
        time.sleep(.25)
        request.assert_called_once()
        self.assertFalse(request.call_args.kwargs['allow_redirects'])
        for status in [302, 401, 402, 429, 500]:
            with patch('requests.Session.request', return_value=self.response(status=status)) as request, self.assertRaises(TtsServiceError) as error:
                self.mini.request(settings, 'POST', '/v1/t2a_v2', threading.Event())
            request.assert_called_once()
            self.assertNotIn(settings.api_key, str(error.exception))

    def test_oversize_malformed_and_conversion_failure(self):
        with patch('requests.Session.request', return_value=self.response(chunks=[b'12345'])), self.assertRaises(TtsServiceError):
            self.mini.request(self.settings(self.mini), 'POST', '/v1/t2a_v2', threading.Event(), limit=4)
        for content in [b'invalid', b'[]']:
            with self.assertRaises(TtsServiceError):
                object_json(content)
        self.converter.side_effect = ValueError('conversion failed')
        with patch.object(self.moss, 'request', return_value=(wav(.2), 'audio/wav')), self.assertRaisesRegex(ValueError, 'conversion failed'):
            moss.synthesize(self.settings(self.moss), 'x', threading.Event())


if __name__ == '__main__':
    unittest.main()
