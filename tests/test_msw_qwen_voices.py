import base64
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
import wave

import requests

from maw.msw.qwen_catalog import MODEL_TYPES, voices_for
from maw.msw.tts import DEFAULT_RECIPE, TtsSettings, validate_recipe
from maw.msw.qwen_voices import QwenVoices, cloud_request, reference_wav
import test_msw_processing as processing_tests


def wav(seconds=4, rate=24000, channels=1):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as writer:
        writer.setparams((channels, 2, rate, 0, 'NONE', 'not compressed'))
        writer.writeframes(b'\x01\x00' * int(seconds * rate) * channels)
    return stream.getvalue()


def settings(kind='VoiceDesign', **updates):
    return TtsSettings('synthetic-voice-key', {**DEFAULT_RECIPE, 'model_type': kind,
        'model': MODEL_TYPES[kind][0], 'voice': '', **updates})


def design(key='design-test'):
    return {'request_key': key, 'name': '中文音色', 'voice_prompt': '清晰温柔的女声', 'preview_text': '你好，欢迎使用字幕配音。'}


class QwenVoiceCatalogTests(unittest.TestCase):
    def test_old_recipe_defaults_to_customvoice_and_space_ids_remain_intact(self):
        self.assertEqual(validate_recipe({})['model_type'], 'CustomVoice')
        self.assertEqual(validate_recipe({'voice': 'Eldric Sage'})['voice'], 'Eldric Sage')
        self.assertEqual(len(voices_for('qwen3-tts-flash')), 48)
        self.assertEqual(len(voices_for('qwen3-tts-instruct-flash')), 24)
        self.assertEqual(len(voices_for('qwen3-tts-flash-2025-09-18')), 17)

    def test_known_incompatible_voices_and_modes_rejected_before_cloud_call(self):
        for recipe in [dict(model='qwen3-tts-instruct-flash', voice='Jada'),
                       dict(model='qwen3-tts-flash-2025-09-18', voice='Serena'),
                       dict(model_type='VoiceDesign'), dict(voice='bad\n')]:
            with self.subTest(recipe=recipe), self.assertRaises(ValueError):
                validate_recipe(recipe)

    def test_custom_modes_preserve_voice_ids_and_require_a_voice_only_for_synthesis(self):
        for kind in ('VoiceDesign', 'VoiceClone'):
            recipe = {**DEFAULT_RECIPE, 'model_type': kind, 'model': MODEL_TYPES[kind][0], 'voice': ''}
            self.assertEqual(validate_recipe(recipe, require_voice=False), recipe)
            with self.assertRaises(ValueError):
                validate_recipe(recipe)
            recipe['voice'] = 'qwen-tts-custom-example-20260909'
            self.assertEqual(validate_recipe(recipe), recipe)
            with self.assertRaises(ValueError):
                validate_recipe({**recipe, 'instructions': '慢一些'})


class QwenVoiceServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.controllers = []

    def tearDown(self):
        for controller in self.controllers:
            controller.close()
            if controller.worker:
                controller.worker.join(5)
            self.assertTrue(controller.close_complete.wait(5))
        self.temp.cleanup()

    def controller(self, request):
        controller = QwenVoices(self.root, 9000, lambda: SimpleNamespace(ffmpeg=None), request=request)
        self.controllers.append(controller)
        return controller

    def done(self, controller, operation):
        controller.worker.join(5)
        self.assertFalse(controller.worker.is_alive())
        return controller.get(operation['id'])

    def test_design_protocol_preview_idempotence_and_restart(self):
        calls = []
        def create(config, body):
            calls.append(body)
            self.assertEqual(config, settings())
            return {'output': {'voice': 'qwen-designed-test', 'preview_audio': {'data': base64.b64encode(wav(.1)).decode()}}}
        controller = self.controller(create)
        first = controller.start(design(), settings())
        self.assertEqual(controller.start(design(), settings())['id'], first['id'])
        done = self.done(controller, first)
        self.assertEqual(done['status'], 'succeeded', done)
        self.assertTrue(done['preview'])
        self.assertEqual(controller.preview(first['id']).read_bytes(), wav(.1))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['model'], 'qwen-voice-design')
        self.assertEqual(calls[0]['parameters'], {'sample_rate': 24000, 'response_format': 'wav'})
        self.assertEqual(calls[0]['input']['target_model'], settings().model)
        self.assertEqual(len(calls[0]['input']['preferred_name']), 12)
        with self.assertRaises(ValueError):
            controller.start({**design(), 'voice_prompt': 'different'}, settings())
        controller.close()
        reopened = self.controller(lambda *_: self.fail('must not repeat billable HTTP'))
        self.assertEqual(reopened.start(design(), settings()), done)
        self.assertEqual(reopened.catalog(settings())['voices'][0]['name'], '中文音色')
        self.assertNotIn(settings().api_key.encode(), (self.root / 'voices.sqlite3').read_bytes())

    def test_clone_uploads_normalized_reference_without_persisting_it(self):
        raw = wav()
        calls = []
        def create(_, body):
            calls.append(body)
            return {'output': {'voice': 'qwen-cloned-test'}}
        controller = self.controller(create)
        payload = {'request_key': 'clone-test', 'name': '复刻', 'filename': '参考.wav', 'audio_base64': base64.b64encode(raw).decode()}
        done = self.done(controller, controller.start(payload, settings('VoiceClone')))
        self.assertEqual(done['status'], 'succeeded', done)
        self.assertEqual(calls[0]['model'], 'qwen-voice-enrollment')
        self.assertEqual(calls[0]['input']['audio']['data'], 'data:audio/wav;base64,' + payload['audio_base64'])
        self.assertNotIn(payload['audio_base64'], json.dumps(controller.catalog(settings('VoiceClone'))))
        self.assertNotIn(payload['audio_base64'].encode(), (self.root / 'voices.sqlite3').read_bytes())
        self.assertEqual(list(self.root.rglob('*.wav')), [])
        with self.assertRaises(ValueError):
            controller.start({**payload, 'filename': 'reference.mp3'}, settings('VoiceClone'))

    def test_bad_preview_preserves_voice_and_known_voice_is_scoped(self):
        controller = self.controller(lambda *_: {'output': {'voice': 'qwen-designed-test', 'preview_audio': {'data': 'invalid'}}})
        done = self.done(controller, controller.start(design(), settings()))
        self.assertEqual(done['status'], 'succeeded')
        self.assertFalse(done['preview'])
        config = settings(voice=done['voice'])
        controller.validate_voice(config)
        for incompatible in [settings('VoiceClone', voice=done['voice']), settings(region='singapore', voice=done['voice'])]:
            with self.subTest(config=incompatible), self.assertRaises(ValueError):
                controller.validate_voice(incompatible)
            self.assertEqual(controller.catalog(incompatible)['voices'], [])
        rotated = TtsSettings('different-synthetic-key', config.recipe)
        self.assertEqual(controller.catalog(rotated)['voices'], [])
        controller.validate_voice(rotated)  # Another key can belong to the same account.
        controller.validate_voice(settings(voice='manually-entered-external-voice'))

    def test_uncertain_creation_is_never_automatically_repeated(self):
        calls = []
        def fail(*_):
            calls.append(1)
            raise ValueError('网络失败 ' + settings().api_key)
        controller = self.controller(fail)
        done = self.done(controller, controller.start(design(), settings()))
        self.assertEqual(done['status'], 'failed')
        self.assertNotIn(settings().api_key, done['message'])
        self.assertIn('未自动重试', done['message'])
        self.assertEqual(controller.start(design(), settings()), done)
        self.assertEqual(len(calls), 1)

    def test_closing_after_post_still_preserves_paid_voice(self):
        entered, release = threading.Event(), threading.Event()
        def create(*_):
            entered.set()
            release.wait(3)
            return {'output': {'voice': 'qwen-late-result'}}
        controller = self.controller(create)
        first = controller.start(design(), settings())
        try:
            self.assertTrue(entered.wait(2))
            with self.assertRaisesRegex(ValueError, '已有音色'):
                controller.start(design('another'), settings())
            controller.close()
        finally:
            release.set()
        self.assertEqual(self.done(controller, first)['voice'], 'qwen-late-result')

    def test_restart_marks_orphan_operations_without_interrupting_other_live_ports(self):
        controller = self.controller(lambda *_: {'output': {'voice': 'qwen-test'}})
        done = self.done(controller, controller.start(design(), settings()))
        operation = {**done, 'status': 'creating', 'voice': ''}
        with controller.db() as db:
            db.execute('UPDATE operations SET port=?,payload=? WHERE id=?', (9999, json.dumps(operation), done['id']))
        with patch('maw.msw.qwen_voices.port_alive', return_value=True):
            reopened = self.controller(lambda *_: self.fail('never retry'))
            self.assertEqual(reopened.get(done['id'])['status'], 'creating')
        with patch('maw.msw.qwen_voices.port_alive', return_value=False):
            self.assertEqual(reopened.get(done['id'])['status'], 'interrupted')
        self.assertEqual(reopened.start(design(), settings())['status'], 'interrupted')

    def test_invalid_reference_never_calls_cloud(self):
        controller = self.controller(lambda *_: self.fail('invalid audio must not be uploaded'))
        for index, raw in enumerate([wav(2), wav(61), wav()[:-200]]):
            payload = {'request_key': f'bad-{index}', 'name': '无效参考', 'filename': 'test.wav', 'audio_base64': base64.b64encode(raw).decode()}
            self.assertEqual(self.done(controller, controller.start(payload, settings('VoiceClone')))['status'], 'failed')
        for bad in [{'filename': '../test.wav'}, {'filename': 'file.ogg'}, {'audio_base64': '%invalid'}]:
            with self.assertRaises(ValueError):
                controller.start({**payload, **bad}, settings('VoiceClone'))

    def test_reference_conversion_requires_ffmpeg_and_rejects_long_audio(self):
        with self.assertRaisesRegex(ValueError, 'FFmpeg'):
            reference_wav(wav(rate=16000, channels=2), 'source.wav', lambda: SimpleNamespace(ffmpeg=None), threading.Event())
        directory = os.environ.get('MSW_TEST_FFMPEG')
        if not directory:
            self.skipTest('set MSW_TEST_FFMPEG to test real MP3/M4A normalization')
        ffmpeg = Path(directory) / ('ffmpeg.exe' if os.name == 'nt' else 'ffmpeg')
        source = self.root / 'source.wav'
        source.write_bytes(wav(rate=16000, channels=2))
        for suffix in ['.mp3', '.m4a']:
            target = self.root / ('encoded' + suffix)
            subprocess.run([str(ffmpeg), '-nostdin', '-v', 'error', '-i', str(source), str(target)], check=True, capture_output=True, timeout=20)
            normalized = reference_wav(target.read_bytes(), target.name, lambda: SimpleNamespace(ffmpeg=ffmpeg), threading.Event())
            with wave.open(io.BytesIO(normalized), 'rb') as reader:
                self.assertEqual((reader.getframerate(), reader.getnchannels(), reader.getsampwidth()), (24000, 1, 2))
                self.assertGreaterEqual(reader.getnframes() / reader.getframerate(), 3)
        source.write_bytes(wav(61, rate=16000))
        target = self.root / 'long.mp3'
        subprocess.run([str(ffmpeg), '-nostdin', '-v', 'error', '-i', str(source), str(target)], check=True, capture_output=True, timeout=20)
        with self.assertRaisesRegex(ValueError, '3–60'):
            reference_wav(target.read_bytes(), target.name, lambda: SimpleNamespace(ffmpeg=ffmpeg), threading.Event())

    def test_cloud_transport_bounds_redirects_and_does_not_expose_provider_errors(self):
        calls = []
        class Response:
            status_code = 200
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def iter_content(self, _): return [b'{"output":{"voice":"test"}}']
        class Session:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def post(self, url, **kwargs):
                calls.append((url, kwargs))
                return Response()
        with patch('maw.msw.qwen_voices.requests.Session', Session):
            self.assertEqual(cloud_request(settings(region='singapore'), {'model': 'qwen-voice-design'})['output']['voice'], 'test')
            self.assertEqual(calls[0][0], 'https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/customization')
            self.assertFalse(calls[0][1]['allow_redirects'])
            Response.status_code = 401
            with self.assertRaisesRegex(ValueError, 'HTTP 401'):
                cloud_request(settings(), {})
            Response.status_code = 200
            with patch('maw.msw.qwen_voices.MAX_RESPONSE_BYTES', 5), self.assertRaisesRegex(ValueError, '响应过大'):
                cloud_request(settings(), {})
        with patch('maw.msw.qwen_voices.requests.Session', side_effect=requests.Timeout('secret provider body')), self.assertRaisesRegex(ValueError, '未自动重试'):
            cloud_request(settings(), {})


class QwenVoiceApiTests(processing_tests.ProcessingApiTests):
    def tearDown(self):
        api = self.server.processing_api
        if api._qwen_voices:
            api._qwen_voices.close()
            self.assertTrue(api._qwen_voices.close_complete.wait(5))
        super().tearDown()

    def test_create_list_poll_preview_and_token_guards(self):
        controller = QwenVoices(self.root / 'voices', self.server.server_address[1], lambda: SimpleNamespace(ffmpeg=None),
            request=lambda *_: {'output': {'voice': 'api-designed', 'preview_audio': {'data': base64.b64encode(wav(.1)).decode()}}})
        self.server.processing_api._qwen_voices = controller
        body = {**design(), 'action': 'create', 'provider': {'recipe': settings().recipe, 'apiKey': settings().api_key}}
        self.assertEqual(self.call('qwen-voices', body, {'X-MSW-Token': ''})[0], 403)
        self.assertEqual(self.call('qwen-voices', body, {'Origin': 'https://example.com'})[0], 403)
        status, result = self.call('qwen-voices', body)
        self.assertEqual(status, 202, result)
        controller.worker.join(3)
        route = 'qwen-voice-jobs/' + result['operation']['id']
        status, result = self.call(route)
        self.assertEqual(result['operation']['status'], 'succeeded', result)
        self.assertEqual(self.call('qwen-voices', {**body, 'action': 'list'})[1]['voices'][0]['voice'], 'api-designed')
        self.assertEqual(self.call(route + '/preview', headers={'X-MSW-Token': ''})[0], 403)
        with urlopen(Request(self.url + route + '/preview', headers={'X-MSW-Token': self.server.request_token}), timeout=3) as response:
            self.assertEqual(response.read(), wav(.1))
        self.assertEqual(self.call('qwen-voice-jobs/invalid')[0], 404)


if __name__ == '__main__':
    unittest.main()
