import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from maw.msw import asr_config
from maw.gui_workflow import build_transcribe_command
from maw.openai_asr_capabilities import model_for_endpoint, validate_options


class DoubaoEditorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / 'isolated.env'
        self.env.write_text('VOLC_API_KEY=synthetic-doubao-key\nVOLC_ASR_RESOURCE_ID=volc.bigasr.auc_idle\n', encoding='utf-8')
        environ = patch.dict(os.environ, {'MAW_ENV_FILE': str(self.env), 'MSW_APP_DATA_ROOT': str(self.root/'data')})
        environ.start(); self.addCleanup(environ.stop)

    def test_saved_resource_hotwords_and_speaker_reach_the_shared_command_and_recipe(self):
        config = asr_config.catalog(self.env)
        provider = next(p for p in config['providers'] if p['id'] == 'doubao')
        self.assertEqual(provider['models'][0]['id'], 'volc.bigasr.auc_idle')
        settings = asr_config.resolve_settings(self.env, {'providerId': 'doubao',
            'doubaoHotwords': 'MSW\n字幕编辑\nMSW\n', 'speakerColors': True, 'language': 'zh'})
        self.assertEqual(settings.model, 'volc.bigasr.auc_idle')
        self.assertEqual(settings.recipe['doubao_hotwords'], ('MSW', '字幕编辑'))
        self.assertNotIn('synthetic-doubao-key', json.dumps(settings.recipe))
        command = build_transcribe_command(settings.request)
        self.assertTrue(any('generate_subtitle_doubao_api.py' in item for item in command))
        self.assertEqual(command.count('--hotword'), 2)
        self.assertIn('--speaker-colors', command)
        self.assertIn('volc.bigasr.auc_idle', command)

    def test_call_defaults_and_environment_can_be_saved_without_media(self):
        asr_config.save_settings(self.env, {'providerId':'doubao', 'apiKey':'replacement-synthetic'}, section='environment')
        asr_config.save_settings(self.env, {'providerId':'doubao', 'modelId':'volc.bigasr.auc',
            'doubaoHotwords':'专用词'}, section='call')
        saved = asr_config.catalog(self.env)
        self.assertEqual(saved['options']['doubaoHotwords'], '专用词')
        self.assertEqual(saved['options']['modelId'], 'volc.bigasr.auc')
        self.assertNotIn('replacement-synthetic', json.dumps(saved))

    def test_cli_refuses_text_without_timestamps(self):
        import generate_subtitle_doubao_api as cli
        source = self.root / 'source.wav'; source.write_bytes(b'synthetic')
        with patch('sys.argv', ['doubao', str(source), '-o', str(self.root/'out.srt'), '--json', '--no-html']), \
                patch.object(cli, '_resolve_media_tool', return_value='ffmpeg'), \
                patch.object(cli, 'get_duration_sec', return_value=10), \
                patch.object(cli, 'extract_audio_ogg'), \
                patch.object(cli, 'transcribe', return_value={'text':'unanchored', 'items':[]}):
            with self.assertRaisesRegex(RuntimeError, '时间戳'):
                cli.main()
        self.assertFalse((self.root/'out.srt').exists())


class OpenaiCapabilityTests(unittest.TestCase):
    def test_openrouter_root_uses_api_path_without_rewriting_custom_hosts(self):
        from generate_subtitle_openai_api import normalize_base_url
        for url in ('https://openrouter.ai', 'https://openrouter.ai/v1', 'https://openrouter.ai/api/v1'):
            self.assertEqual(normalize_base_url(url), 'https://openrouter.ai/api/v1')
        self.assertEqual(normalize_base_url('https://custom.test'), 'https://custom.test/v1')

    def test_prefix_only_for_recognized_domain_and_presets(self):
        self.assertEqual(model_for_endpoint('https://openrouter.ai/api/v1', 'whisper-1'), 'openai/whisper-1')
        for url in ('https://openrouter.ai.example/v1', 'https://proxy.test/openrouter.ai'):
            self.assertEqual(model_for_endpoint(url, 'whisper-1'), 'whisper-1')
        self.assertEqual(model_for_endpoint('https://openrouter.ai/api/v1', 'whisper-1', preset=False), 'whisper-1')
        self.assertEqual(model_for_endpoint('https://openrouter.ai/api/v1', 'vendor/private'), 'vendor/private')

    def test_official_text_models_rejected_before_network(self):
        for model in ('gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'):
            with self.subTest(model=model), self.assertRaisesRegex(ValueError, '时间戳'):
                validate_options('https://api.openai.com/v1', model)
        self.assertFalse(validate_options('https://api.openai.com/v1', 'whisper-1', 'context'))
        self.assertTrue(validate_options('https://api.openai.com/v1', 'gpt-4o-transcribe-diarize'))
        with self.assertRaisesRegex(ValueError, 'Prompt'):
            validate_options('https://api.openai.com/v1', 'gpt-4o-transcribe-diarize', 'unsupported')

    def test_request_format_and_parameters_match_model(self):
        import generate_subtitle_openai_api as cli
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'sample.wav'; source.write_bytes(b'synthetic')
            response = unittest.mock.Mock(ok=True)
            response.json.return_value = {'text': 'hello', 'segments': [{'start': 0, 'end': 1, 'text': 'hello', 'speaker': 'A'}]}
            cases = [('https://api.openai.com/v1', 'whisper-1', 'context', (), False),
                     ('https://api.openai.com/v1', 'gpt-4o-transcribe-diarize', '', (), True),
                     ('https://proxy.test/v1', 'vendor/private', 'context', ('MSW',), False)]
            for url, model, prompt, keywords, diarize in cases:
                with self.subTest(model=model), patch.object(cli.requests, 'post', return_value=response) as post:
                    result = cli.request_transcription(source, base_url=url, api_key='synthetic', model=model,
                        language='zh', prompt=prompt, keywords=keywords, diarize=diarize)
                    data = post.call_args.kwargs['data']
                    self.assertIn(('model', model), data)
                    self.assertIn(('response_format', 'diarized_json' if diarize else 'verbose_json'), data)
                    self.assertEqual(any(k == 'timestamp_granularities[]' for k, _ in data), model == 'whisper-1')
                    if diarize:
                        self.assertIn(('chunking_strategy', 'auto'), data)
                    self.assertTrue(result)

    def test_editor_recipe_preserves_parameters_without_secrets(self):
        with tempfile.TemporaryDirectory() as temp:
            env = Path(temp) / 'isolated.env'
            env.write_text('MAW_OPENAI_ASR_API_KEY=synthetic\n', encoding='utf-8')
            settings = asr_config.resolve_settings(env, {'providerId':'openai', 'modelId':'custom-asr',
                'openaiModel':'vendor/private', 'openaiBaseUrl':'https://proxy.test/v1',
                'openaiPrompt':'context', 'openaiKeywords':'MSW\nMSW\nsubtitle', 'openaiDiarize':False})
            self.assertEqual(settings.recipe['openai_keywords'], ('MSW', 'subtitle'))
            self.assertEqual(settings.recipe['openai_prompt'], 'context')
            self.assertNotIn('synthetic', json.dumps(settings.recipe))
            cmd = build_transcribe_command(settings.request)
            self.assertEqual(cmd.count('--keyword'), 2)
            self.assertIn('--prompt', cmd)
