import copy
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

import requests

from maw.msw.assets import AssetStore
from maw.msw.jobs import JobManager, TERMINAL
from maw.msw.tts import DEFAULT_RECIPE, TtsSettings, TtsService, TtsServiceError, synthesize
from test_msw_tts import snapshot, wav_bytes


class Response:
    status_code = 404
    headers = {}
    payload = {'code': 'ModelNotFound', 'message': 'The model does not exist.', 'request_id': 'test-request-1'}

    def __enter__(self): return self
    def __exit__(self, *_): pass
    def json(self): return copy.deepcopy(self.payload)
    def iter_content(self, _): return [wav_bytes()]


class Session:
    def __init__(self, response=None):
        self.response = response or Response()
        self.calls = []

    def __enter__(self): return self
    def __exit__(self, *_): pass
    def post(self, *args, **kwargs):
        self.calls.append('post')
        return self.response
    def get(self, *args, **kwargs):
        self.calls.append('get')
        return self.response


class TtsErrorTests(unittest.TestCase):
    def setUp(self):
        self.settings = TtsSettings('synthetic-secret-key', dict(DEFAULT_RECIPE))

    def test_http_failure_preserves_diagnostics_and_never_downloads_or_retries(self):
        response = Response()
        session = Session(response)
        with self.assertRaises(TtsServiceError) as error:
            synthesize(self.settings, 'private speech', threading.Event(), session_factory=lambda: session)
        detail = str(error.exception)
        for part in ('HTTP 404', 'ModelNotFound', 'test-request-1', 'model does not exist', 'beijing', '未自动重试'):
            self.assertIn(part, detail)
        self.assertEqual(session.calls, ['post'])

    def test_voice_failure_redacts_credentials_urls_text_and_other_response_fields(self):
        response = Response()
        response.payload = {
            'code': 'InvalidParameter.VoiceNotFound', 'request_id': 'request-2',
            'message': ('Voice not found: Cherry; synthetic-secret-key; private speech; '
                        'https://user:password@example.test/audio?Signature=secret; Bearer other-token; sk-other-key'),
            'input': {'text': 'body-only-private-text'}, 'Authorization': 'body-only-secret',
        }
        session = Session(response)
        with self.assertRaises(TtsServiceError) as error:
            synthesize(self.settings, 'private speech', threading.Event(), session_factory=lambda: session)
        detail = str(error.exception)
        self.assertIn('本机记录不代表云端音色仍可用', detail)
        for secret in ('Cherry', 'synthetic-secret-key', 'private speech', 'password', 'Signature=', 'other-token', 'sk-other-key', 'body-only'):
            self.assertNotIn(secret, detail)

    def test_actual_design_model_missing_response_has_specific_guidance(self):
        response = Response()
        response.payload = {'code': 'InvalidParameter', 'message': 'Model not exist.', 'request_id': 'synthetic-request'}
        settings = TtsSettings('test-secret', {**DEFAULT_RECIPE, 'model_type': 'VoiceDesign',
            'model': 'qwen3-tts-vd-2026-01-26', 'voice': 'synthetic-designed-voice'})
        with self.assertRaises(TtsServiceError) as error:
            synthesize(settings, 'hello', threading.Event(), session_factory=lambda: Session(response))
        self.assertIn('服务端未找到当前模型', str(error.exception))
        self.assertIn('不能直接改用普通 Flash', str(error.exception))
        self.assertNotIn('无法确定哪一项', str(error.exception))
        self.assertEqual(settings.recipe['voice'], 'synthetic-designed-voice')

    def test_malformed_http_error_keeps_status_without_showing_html(self):
        for payload in (['private response'], None, {'message': {'nested': 'private response'}}):
            response = Response(); response.payload = payload
            with self.subTest(payload=payload), self.assertRaisesRegex(TtsServiceError, 'HTTP 404') as error:
                synthesize(self.settings, 'hello', threading.Event(), session_factory=lambda: Session(response))
            self.assertNotIn('private response', str(error.exception))
        response.json = lambda: (_ for _ in ()).throw(ValueError('<html>secret</html>'))
        with self.assertRaisesRegex(TtsServiceError, 'HTTP 404') as error:
            synthesize(self.settings, 'hello', threading.Event(), session_factory=lambda: Session(response))
        self.assertNotIn('secret', str(error.exception))

    def test_200_with_service_error_stops_instead_of_attempting_audio_download(self):
        response = Response(); response.status_code = 200
        session = Session(response)
        with self.assertRaisesRegex(TtsServiceError, 'ModelNotFound'):
            synthesize(self.settings, 'hello', threading.Event(), session_factory=lambda: session)
        self.assertEqual(session.calls, ['post'])

    def test_invalid_success_json_is_not_reported_as_network_failure(self):
        response = Response(); response.status_code = 200
        response.json = lambda: (_ for _ in ()).throw(requests.exceptions.JSONDecodeError('bad', 'secret', 0))
        with self.assertRaisesRegex(TtsServiceError, '不是有效 JSON'):
            synthesize(self.settings, 'hello', threading.Event(), session_factory=lambda: Session(response))

    def test_network_errors_explain_stage_without_signed_urls(self):
        url = 'https://user:password@example.test/?Signature=secret'
        for exception, expected in ((requests.exceptions.SSLError, 'TLS'), (requests.exceptions.ProxyError, '代理'),
                                    (requests.Timeout, '超时'), (requests.ConnectionError, '连接')):
            session = Session()
            session.post = lambda *args, **kwargs: (_ for _ in ()).throw(exception(url))
            with self.subTest(kind=exception.__name__), self.assertRaises(TtsServiceError) as error:
                synthesize(self.settings, 'hello', threading.Event(), session_factory=lambda: session)
            detail = str(error.exception)
            self.assertIn(expected, detail); self.assertIn('合成请求', detail)
            self.assertNotIn('password', detail); self.assertNotIn('Signature', detail)
        response = Response(); response.status_code = 200
        response.payload = {'output': {'audio': {'url': 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.wav'}}}
        session = Session(response)
        session.get = lambda *args, **kwargs: (_ for _ in ()).throw(requests.Timeout(url))
        with self.assertRaisesRegex(TtsServiceError, '音频下载.*超时'):
            synthesize(self.settings, 'hello', threading.Event(), session_factory=lambda: session)

    def test_failed_entry_has_error_and_batch_stops_preserving_success(self):
        with tempfile.TemporaryDirectory() as directory:
            assets = AssetStore(Path(directory) / 'assets')
            calls = []
            def one(settings, text, cancel):
                calls.append(text)
                if len(calls) == 1: return wav_bytes()
                raise TtsServiceError('HTTP 404 ModelNotFound request-1')
            manager = JobManager(Path(directory) / 'jobs.sqlite3', tts=TtsService(assets, synthesize_one=one))
            try:
                source = snapshot()
                source['entries'].append({**source['entries'][1], 'id': 'third', 'key': 'third', 'text': 'not sent'})
                job = manager.submit({'kind': 'tts', 'project_id': 'tts-project', 'request_key': 'first', 'snapshot': source}, self.settings)
                end = time.monotonic() + 5
                while time.monotonic() < end:
                    result = manager.get(job['id'], 'tts-project')
                    if result['status'] in TERMINAL: break
                    time.sleep(.01)
                self.assertEqual(result['status'], 'failed')
                self.assertEqual(result['stage'], 'synthesizing')
                self.assertEqual(result['progress'], {'current': 2, 'total': 3, 'ready': 1, 'failed': 1})
                self.assertEqual([i['status'] for i in result['result']['items']], ['ready', 'failed'])
                self.assertIn('ModelNotFound', result['result']['items'][1]['error'])
                self.assertEqual(calls, ['Hello', 'World'])
                self.assertEqual(len(assets.list('tts-project')['assets']), 1)
                self.assertNotIn(self.settings.api_key, json.dumps(result))
            finally:
                manager.close(); self.assertTrue(manager.close_complete.wait(5))


if __name__ == '__main__': unittest.main()
