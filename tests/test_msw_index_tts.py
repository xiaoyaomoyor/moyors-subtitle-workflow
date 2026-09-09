import base64
import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

from index_service_fixture import IndexFixture, wav_bytes
from maw.msw.api import ProcessingAPI
from maw.msw.assets import AssetStore, audio_info
from maw.msw.index_protocol import IndexClient, service_url
from maw.msw.index_tts import DEFAULT_RECIPE, IndexTts, synthesize, validate_recipe
from maw.msw.jobs import JobCancelled
from maw.msw.project_codec import normalize_extension
from maw.msw.tts import TtsService, TtsServiceError


class IndexTtsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.server = IndexFixture()
        self.addCleanup(self.server.close)
        self.controller = IndexTts(self.root, lambda data, suffix: data)
        self.controller.check_service({'service_url': self.server.url})
        self.ref = self.controller.store_reference('reference.wav', wav_bytes())
        self.recipe = {**copy.deepcopy(DEFAULT_RECIPE), 'speaker_ref': self.ref['id']}

    def settings(self, **updates):
        return self.controller.resolve({'recipe': {**self.recipe, **updates}, 'service_url': self.server.url})

    def test_local_preset_rename_delete_preserve_references_and_reject_collisions(self):
        self.controller.action({'action': 'save_preset', 'name': 'Old', 'recipe': self.recipe})
        result = self.controller.action({'action': 'rename_preset', 'name': 'Old', 'new_name': 'New'})
        self.assertEqual(list(result['presets']), ['New'])
        self.assertEqual(result['presets']['New']['speaker_ref'], self.ref['id'])
        for name in [None, [], '', 'x' * 81]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.controller.action({'action': 'rename_preset', 'name': 'New', 'new_name': name})
        result = self.controller.action({'action': 'delete_preset', 'name': 'New'})
        self.assertEqual(result['presets'], {})
        self.assertEqual(len(self.controller.references()), 1)

    def test_all_modes_parameter_order_and_complete_audio(self):
        for mode in ['follow', 'audio', 'vector', 'text']:
            with self.subTest(mode=mode):
                settings = self.settings(emotion_mode=mode, emotion_ref=self.ref['id'], emotion_vector=[.1] * 8,
                                         duration_factor=1.3, emotion_text='Warm', emotion_random=True, top_k=0)
                audio = synthesize(settings, 'Target subtitle', threading.Event())
                self.assertEqual(audio_info(audio)['sample_count'], 2205)
                data = [body['data'] for name, body in self.server.calls if name == 'gen_single'][-1]
                self.assertEqual(len(data), 26)
                self.assertEqual(data[0], self.server.modes[['follow', 'audio', 'vector', 'text'].index(mode)])
                self.assertEqual(data[2:4], ['Target subtitle', 'ZH'])
                self.assertEqual(data[6:14], [.1] * 8)
                self.assertEqual(data[14:18], ['Warm', True, 120, 1.3])
                self.assertEqual(data[20], 0)
                self.assertEqual(data[4] is not None, mode == 'audio')
        self.assertEqual(len(self.server.uploads), 5)

    def test_disabled_text_emotion_fails_before_generation(self):
        self.server.modes = self.server.modes[:3]
        self.controller.check_service({'service_url': self.server.url})
        with self.assertRaisesRegex(ValueError, 'QwenEmotion'):
            self.settings(emotion_mode='text')
        self.assertFalse(any(name == 'gen_single' for name, _ in self.server.calls))

    def test_reference_upload_dedup_integrity_and_traversal(self):
        raw = {'action': 'upload', 'filename': 'owned.wav', 'audio_base64': base64.b64encode(wav_bytes()).decode()}
        self.assertEqual(self.controller.action(raw)['reference']['id'], self.ref['id'])
        self.assertEqual(len(self.controller.references()), 1)
        for value in ['../reference', '', 'ref-' + 'a' * 64]:
            with self.assertRaises(ValueError):
                self.controller.reference(value)
        with self.assertRaises(ValueError):
            self.controller.action({**raw, 'filename': '../owned.wav'})
        path = self.controller.root / 'references' / (self.ref['id'] + '.wav')
        path.write_bytes(wav_bytes()[:-2])
        with self.assertRaisesRegex(ValueError, '不完整'):
            self.settings()

    def test_examples_do_not_apply_text_or_generation_controls(self):
        result = self.controller.action({'action': 'example', 'index': 0, 'service_url': self.server.url})
        self.assertIn('reference', result)
        self.assertNotIn('recipe', result)
        cap = self.controller.public_capability()
        self.assertEqual(len(cap['voices']), 1)
        self.assertEqual(len(cap['emotion_examples']), 1)
        self.assertNotIn('/server-cache', json.dumps(cap))

    def test_server_preset_and_local_preset_preserve_duration_language(self):
        result = self.controller.action({'action': 'server_preset', 'name': 'Fixture preset', 'service_url': self.server.url,
                                         'recipe': {**self.recipe, 'duration_factor': 1.4, 'language_type': 'JA'}})
        self.assertEqual(result['recipe']['emotion_mode'], 'vector')
        self.assertEqual(result['recipe']['duration_factor'], 1.4)
        self.assertEqual(result['recipe']['language_type'], 'JA')
        self.controller.action({'action': 'save_preset', 'name': 'Test', 'recipe': result['recipe']})
        self.controller.save({'service_url': self.server.url, 'recipe': result['recipe']})
        reopened = IndexTts(self.root, lambda data, suffix: data).payload()
        self.assertEqual(reopened['presets']['Test']['duration_factor'], 1.4)
        self.assertEqual(reopened['recipe']['language_type'], 'JA')
        self.assertIsNone(reopened['capability'])

    def test_cancel_targets_only_owned_session_and_discards_result(self):
        cancel = threading.Event()
        self.server.block = True
        errors = []
        settings = self.settings()
        def run():
            try:
                synthesize(settings, 'Cancel me', cancel)
            except Exception as error:
                errors.append(error)
        worker = threading.Thread(target=run)
        worker.start()
        self.assertTrue(self.server.entered.wait(5))
        cancel.set()
        worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertIsInstance(errors[0], JobCancelled)
        self.assertEqual(len(self.server.cancels), 1)
        name, body = self.server.calls[-1]
        self.assertEqual(name, 'gen_single')
        self.assertEqual(self.server.cancels[0]['session_hash'], body['session_hash'])

    def test_server_preset_warning_never_silently_applies_fallback(self):
        self.server.preset_warning = True
        with self.assertRaisesRegex(TtsServiceError, '未应用'):
            self.controller.action({'action': 'server_preset', 'name': 'Fixture preset',
                                    'service_url': self.server.url, 'recipe': self.recipe})

    def test_failures_do_not_resubmit_or_publish_partial_audio(self):
        settings = self.settings()
        self.server.failed = True
        with self.assertRaisesRegex(TtsServiceError, '执行失败') as error:
            synthesize(settings, 'Test', threading.Event())
        self.assertNotIn('traceback', str(error.exception))
        self.server.failed = False
        self.server.bad_audio = True
        with self.assertRaises(ValueError):
            synthesize(settings, 'Test', threading.Event())
        self.assertEqual(sum(name == 'gen_single' for name, _ in self.server.calls), 1)

    def test_recipe_validation_strips_private_connection_and_rejects_invalid_controls(self):
        clean = validate_recipe({**self.recipe, 'service_url': self.server.url, 'apiKey': 'synthetic', 'path': '/private'})
        self.assertNotIn('path', clean)
        self.assertNotIn('service_url', clean)
        self.assertNotIn('apiKey', clean)
        for update in [{'top_k': 1.5}, {'duration_factor': 0}, {'emotion_vector': [0] * 7},
                       {'temperature': float('nan')}, {'emotion_random': 'true'}, {'speaker_ref': '../audio'}]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                validate_recipe({**self.recipe, **update})

    def test_job_uses_pronunciation_and_project_keeps_safe_generation_metadata(self):
        assets = AssetStore(self.root / 'assets')
        job = {'id': 'index-job', 'project_id': 'project', 'snapshot': {'entries': [
            {'key': 'entry', 'id': 'cue-1', 'track_id': None, 'text': '原字幕', 'start': 0, 'end': 1000,
             'pronunciation_override': '发音文本'}]}}
        result = TtsService(assets).run(job, self.settings(), threading.Event(), lambda *_: None)
        self.assertEqual(result['items'][0]['status'], 'ready')
        asset = assets.get('project', result['items'][0]['asset_id'])
        clean = normalize_extension({'schema': 'msw.editor.v1', 'project_id': 'project', 'assets': [asset]})
        generation = clean['assets'][0]['generation']
        self.assertEqual(generation['provider'], 'indextts')
        self.assertEqual(generation['speaker_ref'], self.ref['id'])
        self.assertNotIn(self.server.url, json.dumps(clean))
        self.assertEqual([body['data'][2] for name, body in self.server.calls if name == 'gen_single'], ['发音文本'])

    def test_common_engine_migrates_legacy_and_persists_index_without_qwen_key(self):
        server = SimpleNamespace(server_address=('127.0.0.1', 12345))
        api = ProcessingAPI(server, self.root / 'isolated.env', self.root)
        self.addCleanup(api.close)
        api.yukkuri.save(engine='yukkuri')
        self.assertEqual(api.tts_engine(), 'yukkuri')
        api.tts_engine('indextts')
        self.assertEqual(api.tts_engine(), 'indextts')
        self.assertEqual(api.yukkuri.payload()['engine'], 'yukkuri')

    def test_only_loopback_and_own_file_endpoint(self):
        for url in ['https://127.0.0.1:7860', 'http://example.com', 'http://127.0.0.1:7860/other',
                    'http://user@127.0.0.1:7860', 'file:///tmp/a', 'http://127.0.0.1:7860?x=1']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                service_url(url)
        self.assertEqual(service_url('http://localhost:7860/'), 'http://127.0.0.1:7860')
        with IndexClient(self.server.url) as client:
            for url in ['https://example.com/gradio_api/file=x', self.server.url + '/config',
                        self.server.url + '/gradio_api/file=x?key=abc']:
                with self.assertRaises(ValueError):
                    client.download({'url': url})

    def test_incompatible_api_stops_before_queueing(self):
        self.server.parameters.pop()
        with self.assertRaisesRegex(ValueError, '不兼容'):
            self.controller.check_service({'service_url': self.server.url})


if __name__ == '__main__':
    unittest.main()
