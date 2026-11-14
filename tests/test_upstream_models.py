"""Selective upstream model support without network calls or user credentials."""
import io
import json
import os
from contextlib import redirect_stdout, redirect_stderr
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import generate_subtitle_qwen_api as qwen
from maw import cli
from maw.gui_config import DEFAULT_MODEL_ID, QWEN_MODELS
from maw.gui_workflow import TranscriptionRequest, build_transcribe_command, run_transcription
from maw.qwen_audio import (QWEN_AUDIO_31_MODEL_ID as MODEL, qwen_audio_31_usage,
                           format_qwen_audio_usage, qwen_audio_usage_line)


class Qwen31Tests(unittest.TestCase):
    def setUp(self):
        tmp = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(tmp)
        self.env = self.root / 'isolated.env'
        self.env.write_bytes(b'')
        self.enterContext(patch.dict(os.environ, {'MAW_ENV_FILE': str(self.env),
            'MSW_APP_DATA_ROOT': str(self.root / 'appdata')}, clear=True))
        self.enterContext(patch('maw.local_models.local_model_payload', return_value={}))

    def test_registry_keeps_default_and_exposes_new_capabilities(self):
        self.assertEqual(DEFAULT_MODEL_ID, 'qwen-audio-3.0-asr-flash-filetrans')
        self.assertEqual(QWEN_MODELS[0].id, DEFAULT_MODEL_ID)
        model = next(m for m in QWEN_MODELS if m.id == MODEL)
        self.assertTrue(model.supports_speaker and model.supports_context and model.supports_hotwords
                        and model.supports_vocabulary and model.supports_keep_dialect)
        self.assertTrue(qwen.is_qwen_audio_model(MODEL) and qwen.supports_speaker_diarization(MODEL))

    def test_submit_protocol_and_model_gating(self):
        response = Mock(status_code=200)
        response.json.return_value = {'output': {'task_id': 'test-task'}}
        context = qwen.build_qwen_audio_context('领域词表')
        for model in (MODEL, DEFAULT_MODEL_ID, 'fun-asr', 'qwen3-asr-flash-filetrans'):
            with self.subTest(model=model), patch.object(qwen.requests, 'post', return_value=response) as post:
                qwen.submit_filetrans('https://example.test', 'synthetic-key', 'oss://test', 'zh',
                    True, False, model, enable_speaker=True, hotwords=['台词:50'],
                    vocabulary_id='test-vocab', context=context, keep_dialect=True)
                body = post.call_args.kwargs['json']
                if model == MODEL:
                    self.assertEqual(body['input'], {'file_urls': ['oss://test'], 'context': context})
                    self.assertEqual(body['parameters'], {'channel_id': [0], 'diarization_enabled': True,
                        'language_hints': ['zh'], 'vocabulary_id': 'test-vocab',
                        'vocabulary': {'台词': 50}, 'keep_dialect': True})
                else:
                    self.assertNotIn('keep_dialect', body['parameters'])

    def test_usage_prices_and_unknown_counters(self):
        values = {'input_tokens': 1000000, 'output_tokens': 1000000}
        self.assertAlmostEqual(qwen_audio_31_usage(values, 'beijing')['estimated_cost'], 3.5)
        self.assertAlmostEqual(qwen_audio_31_usage(values, 'singapore')['estimated_cost'], 4.521)
        self.assertIsNone(qwen_audio_31_usage(values, 'unknown')['estimated_cost'])
        self.assertEqual(qwen_audio_31_usage({'input_tokens': 0, 'output_tokens': 0}, 'beijing')['estimated_cost'], 0)
        for invalid in (None, True, -1, 2.5, '10', float('inf'), 2**60):
            self.assertIsNone(qwen_audio_31_usage({'input_tokens': invalid, 'output_tokens': 10}, 'beijing')['estimated_cost'])
        self.assertIsNone(qwen_audio_31_usage({'duration': 100}, 'beijing')['input_tokens'])
        self.assertIn('未知', format_qwen_audio_usage({}, 'beijing'))

    def test_transcribe_uses_token_usage_and_funasr_parser(self):
        usage = {'input_tokens': 1000, 'output_tokens': 120}
        raw = {'transcripts': [{'text': 'Hello.', 'sentences': [{'begin_time': 0, 'end_time': 1000,
            'text': 'Hello.', 'speaker_id': 2, 'words': [{'begin_time': 0, 'end_time': 1000,
                'text': 'Hello', 'punctuation': '.'}]}]}]}
        config = dict(base_url='https://example.test', api_key='synthetic-key', region='singapore',
                      enable_words=True, enable_itn=False, default_language='', poll_interval=0, poll_timeout=1)
        with patch.object(qwen, 'submit_filetrans', return_value='task') as submit, \
                patch.object(qwen, 'poll_task', return_value=('https://example.test/result', usage)), \
                patch.object(qwen, 'download_transcription', return_value=raw), redirect_stdout(io.StringIO()) as out:
            result = qwen.transcribe('unused.wav', 'en', [], config, file_url_override='oss://test',
                                     model=MODEL, keep_dialect=True)
        self.assertTrue(submit.call_args.kwargs['keep_dialect'])
        self.assertEqual(result['usage'], usage)
        self.assertEqual(result['sentences'][0]['start'], 0)
        self.assertEqual(result['sentences'][0]['speaker'], '2')
        self.assertIn('输入 1000 / 输出 120 tokens', out.getvalue())
        self.assertNotIn('计费语音', out.getvalue())

    def test_command_only_forwards_dialect_for_31(self):
        request = TranscriptionRequest(self.root / 'test.wav', self.root / 'test.srt', model=MODEL,
            qwen_keep_dialect=True, qwen_audio_context='context', qwen_audio_hotwords='台词', speaker_colors=True)
        command = build_transcribe_command(request, frozen=False)
        for flag in ('--keep-dialect', '--context', '--hotword', '--speaker-colors'):
            self.assertIn(flag, command)
        self.assertNotIn('--keep-dialect', build_transcribe_command(replace(request, model=DEFAULT_MODEL_ID)))

    def test_cli_rejects_invalid_dialect_before_io(self):
        for args in (['-i', 'absent.wav', '--keep-dialect'],
                     ['-i', 'absent.wav', '--provider', 'openai', '--model', MODEL, '--keep-dialect']):
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
                cli.main(args)
            self.assertEqual(raised.exception.code, 2)
        with patch('sys.argv', ['qwen', 'absent.wav', '--keep-dialect']), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            qwen.main()
        self.assertEqual(raised.exception.code, 2)

    def test_workflow_returns_usage_without_exposing_machine_line(self):
        request = TranscriptionRequest(self.root / 'test.wav', self.root / 'test.srt', model=MODEL,
                                       region='singapore', env_path=self.env)
        request.srt_path.write_text('subtitle', encoding='utf-8')
        request.srt_path.with_suffix('.mosp').write_text('{}', encoding='utf-8')
        process = Mock(returncode=0)
        process.poll.return_value = 0
        # Claimed cost/region on the wire is ignored; compute from trusted region.
        line = qwen_audio_usage_line({'input_tokens': 1000000, 'output_tokens': 0}, 'beijing')
        events = []
        def stream(_process, forward, _cancel):
            forward(line)
            forward('finished')
        with patch('maw.gui_workflow.popen_process_tree', return_value=process), \
                patch('maw.gui_workflow._stream_process', side_effect=stream), \
                patch('maw.gui_workflow.release_process_tree'):
            result = run_transcription(request, on_event=events.append)
        self.assertEqual(events, ['finished'])
        self.assertEqual(result.billing['estimated_cost'], 1.094)
        self.assertNotIn('synthetic-key', json.dumps(result.billing))

    def test_editor_settings_preserve_dialect_and_distinguish_job_recipe(self):
        from maw.msw import asr_config
        raw = {'providerId': 'qwen', 'modelId': MODEL, 'apiKey': 'synthetic-key', 'qwenKeepDialect': True}
        saved = asr_config.save_settings(self.env, raw)
        self.assertTrue(saved['options']['qwenKeepDialect'])
        self.assertNotIn('synthetic-key', json.dumps(saved))
        on = asr_config.resolve_settings(self.env, {**raw, 'qwenKeepDialect': True})
        off = asr_config.resolve_settings(self.env, {**raw, 'qwenKeepDialect': False})
        self.assertTrue(on.request.qwen_keep_dialect)
        self.assertNotEqual(on.recipe, off.recipe)
        old = asr_config.resolve_settings(self.env, {**raw, 'modelId': DEFAULT_MODEL_ID})
        self.assertFalse(old.request.qwen_keep_dialect)
        with self.assertRaises(ValueError):
            asr_config.resolve_settings(self.env, {**raw, 'qwenKeepDialect': 'true'})
