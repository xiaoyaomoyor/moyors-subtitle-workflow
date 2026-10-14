import base64
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from maw.msw.qwen_upload import upload_reference
from maw.msw.qwen_voices import QwenVoices
from maw.msw.tts import DEFAULT_RECIPE, TtsSettings, resolve_settings, save_settings, synthesize, validate_recipe
from test_msw_qwen_voices import wav


MODEL = 'qwen-audio-3.0-tts-flash'


def settings(kind='VoiceClone', voice='qwen-audio-3.0-tts-flash-mswtest-voice'):
    return TtsSettings('synthetic-key', {**DEFAULT_RECIPE, 'model': MODEL, 'model_type': kind, 'voice': voice}, 'ws-synthetic')


class Response:
    status_code = 200
    headers = {}

    def __init__(self, data=None, audio=b''):
        self.data, self.audio = data, audio

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def json(self):
        return self.data

    def iter_content(self, _):
        yield self.audio


class QwenAudioTests(unittest.TestCase):
    def test_workspace_is_connection_only_and_voice_id_preserves_periods(self):
        config = settings()
        self.assertEqual(validate_recipe(config.recipe), config.recipe)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.env'
            payload = save_settings(path, {'recipe': config.recipe, 'apiKey': config.api_key, 'workspaceId': config.workspace_id})
            self.assertEqual(resolve_settings(path, {}).workspace_id, config.workspace_id)
            self.assertEqual(payload['regions'][0]['workspaceId'], config.workspace_id)
            self.assertNotIn('workspace_id', payload['recipe'])
            self.assertNotIn(config.api_key, json.dumps(payload))
            for bad in ('../bad', 'ws-test.example.com', 'https://example.com', 'bad\n'):
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    resolve_settings(path, {'workspaceId': bad})
        with self.assertRaisesRegex(ValueError, '北京'):
            validate_recipe({**config.recipe, 'region': 'singapore'})
        self.assertIn('ws-synthetic.cn-beijing.maas.aliyuncs.com', config.base_url)
        self.assertTrue(config.base_url.endswith('/audio/tts/SpeechSynthesizer'))
        self.assertIn('dashscope.aliyuncs.com', TtsSettings(config.api_key, config.recipe).base_url)
        self.assertIn('/multimodal-generation/', TtsSettings('key', dict(DEFAULT_RECIPE), 'ws-synthetic').base_url)

    def test_new_http_payload_and_complete_audio_with_language_hint(self):
        config = settings()
        config.recipe['language_type'] = 'English'
        audio = wav(1)
        session = Mock()
        session.__enter__ = Mock(return_value=session)
        session.__exit__ = Mock(return_value=False)
        session.post.return_value = Response({'output': {'audio': {'url': 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav'}}})
        session.get.return_value = Response(audio=audio)
        result = synthesize(config, 'Example text.', threading.Event(), session_factory=lambda: session)
        self.assertEqual(result, audio)
        body = session.post.call_args.kwargs['json']
        self.assertEqual(body['input'], {'text': 'Example text.', 'voice': config.recipe['voice'],
            'format': 'wav', 'sample_rate': 24000, 'language_hints': ['en']})
        self.assertNotIn('Authorization', session.get.call_args.kwargs['headers'])

    def test_private_upload_only_sends_key_to_api_and_rejects_untrusted_host(self):
        policy = {'upload_host': 'https://dashscope-file-mgr.oss-cn-beijing.aliyuncs.com', 'upload_dir': 'dashscope-instant/test',
            'oss_access_key_id': 'scoped-id', 'policy': 'scoped-policy', 'signature': 'scoped-signature',
            'x_oss_object_acl': 'private', 'x_oss_forbid_overwrite': 'true'}
        session = Mock()
        session.__enter__ = Mock(return_value=session)
        session.__exit__ = Mock(return_value=False)
        session.get.return_value = Response({'data': policy})
        session.post.return_value = Response()
        url = upload_reference(settings(), wav(6), threading.Event(), session_factory=lambda: session)
        self.assertTrue(url.startswith('oss://dashscope-instant/test/'))
        self.assertEqual(session.get.call_args.kwargs['params']['model'], 'voice-enrollment')
        self.assertNotIn('headers', session.post.call_args.kwargs)
        self.assertEqual(session.post.call_args.kwargs['data']['x-oss-object-acl'], 'private')
        for host in ('https://example.com', 'http://dashscope-file-mgr.oss-cn-beijing.aliyuncs.com',
                     'https://dashscope-file-mgr.oss-cn-beijing.aliyuncs.com.evil.test'):
            policy['upload_host'] = host
            with self.subTest(host=host), self.assertRaisesRegex(ValueError, '地址不受支持'):
                upload_reference(settings(), wav(6), threading.Event(), session_factory=lambda: session)
        self.assertEqual(session.post.call_count, 1)

    def test_clone_is_idempotent_retains_old_record_and_persists_new_id(self):
        with tempfile.TemporaryDirectory() as directory:
            config = settings(voice='')
            request = Mock(return_value={'output': {'voice_id': 'qwen-audio-3.0-tts-flash-mswtest-clone'}})
            upload = Mock(return_value='oss://synthetic/reference.wav')
            controller = QwenVoices(directory, 9000, lambda: SimpleNamespace(ffmpeg=None), request=request, upload=upload)
            old = TtsSettings('synthetic-key', {**DEFAULT_RECIPE, 'model_type': 'VoiceDesign', 'model': 'qwen3-tts-vd-2026-01-26', 'voice': ''})
            controller.manage({'action': 'register', 'name': 'old voice', 'voice': 'old-custom'}, old)
            payload = {'request_key': 'clone-once', 'name': 'new voice', 'filename': 'reference.wav', 'audio_base64': base64.b64encode(wav(6)).decode()}
            op = controller.start(payload, config)
            controller.worker.join(5)
            result = controller.get(op['id'])
            self.assertEqual(result['status'], 'succeeded', result['message'])
            self.assertEqual(controller.start(payload, config)['id'], op['id'])
            self.assertEqual(request.call_count, 1)
            self.assertEqual(upload.call_count, 1)
            body = request.call_args.args[1]
            self.assertEqual(body['model'], 'voice-enrollment')
            self.assertEqual(body['input']['action'], 'create_voice')
            self.assertEqual(body['input']['url'], 'oss://synthetic/reference.wav')
            self.assertNotIn('audio', body['input'])
            self.assertRegex(body['input']['prefix'], r'^msw[a-f0-9]{7}$')
            self.assertEqual(controller.catalog(old)['voices'][0]['voice'], 'old-custom')
            self.assertIn('.', controller.catalog(config)['voices'][0]['voice'])
            self.assertNotIn('audio_base64', json.dumps(result))
            controller.close()

    def test_modern_design_limits_and_response_use_new_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            request = Mock(return_value={'output': {'voice_id': 'qwen-audio-3.0-tts-flash-vd-mswtest',
                'preview_audio': {'data': base64.b64encode(wav(1)).decode()}}})
            controller = QwenVoices(directory, 9000, lambda: None, request=request)
            config = settings('VoiceDesign', '')
            payload = {'request_key': 'design-modern', 'name': 'new voice', 'voice_prompt': 'A calm narrator',
                'preview_text': 'Hello, welcome to the story.'}
            with self.assertRaisesRegex(ValueError, '15–200'):
                controller.start({**payload, 'preview_text': 'short'}, config)
            with self.assertRaisesRegex(ValueError, '1–500'):
                controller.start({**payload, 'voice_prompt': 'x' * 501}, config)
            op = controller.start(payload, config)
            controller.worker.join(5)
            self.assertTrue(controller.get(op['id'])['preview'])
            self.assertEqual(request.call_args.args[1]['input']['action'], 'create_voice')
            controller.close()


if __name__ == '__main__':
    unittest.main()
