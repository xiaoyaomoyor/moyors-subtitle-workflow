import copy
import json
import tempfile
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch

from maw.launcher_processing import native_project
from maw.postprocess import LlmPostprocessRequest, OutputMode, process_llm_snapshot, run_llm_postprocess
from maw.postprocess_pipeline import PostprocessPipelineError, run_postprocess_pipeline
from maw.postprocess_llm import LlmSettings, llm_request_summary


def request(**kwargs):
    return LlmPostprocessRequest(None, None, OutputMode.JSON, 'proofread',
                                'Keep the style humorous. Translate to Chinese.', **kwargs)


def project(*texts):
    return {'language': 'en', 'segments': [
        {'id': f'main-{i}', 'start': i * 1000, 'end': (i + 1) * 1000, 'text': text}
        for i, text in enumerate(texts)
    ]}


class ProofreadSafetyTests(unittest.TestCase):
    def test_correction_preserves_identity_timing_metadata_and_word_times(self):
        original = project('Helo world', '', 'Next line')
        original['segments'][0].update(speaker='speaker-1', items=[
            {'start': 0, 'end': 400, 'text': 'Helo'},
            {'start': 400, 'end': 1000, 'text': ' world'}])
        before = copy.deepcopy(original)
        def complete(prompt, cues):
            self.assertIn('原语言', prompt)
            self.assertIn('不得合并、拆分', prompt)
            self.assertNotIn('start', json.dumps(cues))
            self.assertEqual([c['id'] for c in cues], ['c0001', 'c0003'])
            return {'groups': [{'id': c['id'], 'source_text': c['text'],
                                'text': c['text'].replace('Helo', 'Hello'),
                                'start': 999999, 'end': 9999999} for c in cues]}
        result = process_llm_snapshot(original, request(task_prompt='Please rewrite everything.'), complete=complete)
        self.assertEqual(original, before)
        for old, new in zip(original['segments'], result.project['segments']):
            self.assertEqual((new['id'], new['start'], new['end']), (old['id'], old['start'], old['end']))
        self.assertEqual(result.project['segments'][0]['speaker'], 'speaker-1')
        self.assertEqual(''.join(i['text'] for i in result.project['segments'][0]['items']), 'Hello world')
        self.assertEqual(result.project['segments'][1], original['segments'][1])
        self.assertEqual(result.project['language'], 'en')

    def test_obvious_language_changes_rejected_without_retry(self):
        for source, output in [('Welcome to our adventure.', '欢迎来到我们的冒险'),
                               ('欢迎来到我们的冒险', 'Welcome to our adventure.'),
                               ('Это наше приключение', 'This is our adventure'),
                               ('안녕하세요 여러분', 'Hello everybody')]:
            with self.subTest(source=source):
                complete = Mock(return_value={'groups': [{'id': 'c0001', 'text': output}]})
                with self.assertRaisesRegex(ValueError, '疑似被翻译'):
                    process_llm_snapshot(project(source), request(), complete=complete)
                complete.assert_called_once()

    def test_short_utterances_rejected_as_a_batch(self):
        response = {'groups': [{'id': 'c0001', 'text': '不'}, {'id': 'c0002', 'text': '是'}]}
        with self.assertRaisesRegex(ValueError, '整批字幕'):
            process_llm_snapshot(project('No', 'Yes'), request(), complete=lambda *_: response)

    def test_existing_mixed_language_names_and_same_script_corrections_allowed(self):
        pairs = [('Play Minecraft with 小明.', 'Play Minecraft with 小明!'),
                 ('今天我们玩 Minecraft 游戏', '今天我们玩 Minecraft 游戏。'),
                 ('Café déjà vu', 'Café, déjà vu.'), ('これは冒険てす', 'これは冒険です'),
                 ('Li', '李'), ('123?!', '123!')]
        for source, output in pairs:
            with self.subTest(source=source):
                result = process_llm_snapshot(project(source), request(), complete=lambda *_: {
                    'groups': [{'source_ids': ['c0001'], 'text': output}]})
                self.assertEqual(result.project['segments'][0]['text'], output)

    def test_structure_changes_never_publish_a_partial_result(self):
        good = [{'id': 'c0001', 'text': 'Hello'}, {'id': 'c0002', 'text': 'World'}]
        cases = [None, {}, [], [good[0]], good + [good[1]], list(reversed(good)),
                 [good[0], good[0]], [{'source_ids': ['c0001', 'c0002'], 'text': 'Hello world'}],
                 [good[0], {'id': 'unknown', 'text': 'World'}],
                 [good[0], {'id': 'c0002', 'text': ''}],
                 [good[0], {'id': 'c0002', 'source_ids': ['c0001'], 'text': 'World'}],
                 [good[0], {'id': 'c0002', 'source_text': 'wrong original', 'text': 'World'}],
                 [good[0], None]]
        for groups in cases:
            with self.subTest(groups=groups):
                with self.assertRaisesRegex(ValueError, '未写入校对结果'):
                    process_llm_snapshot(project('Hello', 'World'), request(), complete=lambda *_: {'groups': groups})

    def test_all_blank_cues_preserved_without_calling_model(self):
        complete = Mock(side_effect=AssertionError('must not call'))
        result = process_llm_snapshot(project('', ' \n'), request(), complete=complete)
        self.assertEqual([s['text'] for s in result.project['segments']], ['', ' \n'])
        complete.assert_not_called()

    def test_later_batch_failure_writes_no_output_and_keeps_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mosp'
            original = json.dumps(project(*(['Hello world'] * 41)))
            source.write_text(original, encoding='utf-8')
            calls = []
            def complete(prompt, cues):
                calls.append(cues)
                return {'groups': [{'id': c['id'], 'text': c['text'] if len(calls) == 1 else '你好世界'} for c in cues]}
            with self.assertRaisesRegex(ValueError, '第 2 批校对结果无效'):
                run_llm_postprocess(LlmPostprocessRequest(source, None, OutputMode.JSON, 'proofread', ''), complete=complete)
            self.assertEqual(source.read_text(encoding='utf-8'), original)
            self.assertEqual(list(root.iterdir()), [source])
            self.assertEqual(len(calls), 2)


class ProofreadPipelineTests(unittest.TestCase):
    def test_valid_native_proofread_then_translate_preserves_corrected_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mosp'
            original = native_project(project('Helo world', 'Our adventure begins'))
            source.write_text(json.dumps(original), encoding='utf-8')
            media = root / 'clip.mp4'
            media.write_bytes(b'media')
            env = root / 'empty.env'
            env.write_text('', encoding='utf-8')
            plan = {'enabled': True, 'retainIntermediate': True, 'steps': [
                {'id': 'proofread', 'enabled': True, 'providerId': 'custom'},
                {'id': 'translate', 'enabled': True, 'providerId': 'zhipu', 'target': 'zh'}]}
            settings = {p: {'apiKey': 'test', 'baseUrl': 'https://example.test', 'model': p + '-model', 'verified': '1'}
                        for p in ('custom', 'zhipu')}
            def complete(settings, prompt, cues):
                if settings.provider_id == 'custom':
                    texts = [c['text'].replace('Helo', 'Hello') for c in cues]
                else:
                    self.assertEqual([c['text'] for c in cues], ['Hello world', 'Our adventure begins'])
                    texts = ['你好世界', '我们的冒险开始了']
                return {'groups': [{'id': c['id'], 'source_text': c['text'], 'text': text} for c, text in zip(cues, texts)]}
            with patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=complete) as llm:
                result = run_postprocess_pipeline(plan, project_path=source, srt_path=root / 'source.srt', media_path=media,
                    env_path=env, ffmpeg_path=None, cancel_event=Event(), llm_settings=settings)
            self.assertEqual(llm.call_count, 2)
            saved = json.loads(result.project_path.read_text(encoding='utf-8'))
            source_id = original['subtitles']['tracks'][0]['id']
            source_cues = [c for c in saved['subtitles']['cues'] if c['track_id'] == source_id]
            translated = [c for c in saved['subtitles']['cues'] if c['track_id'] != source_id]
            self.assertEqual([c['content']['text'] for c in source_cues], ['Hello world', 'Our adventure begins'])
            self.assertEqual([c['id'] for c in source_cues], [c['id'] for c in original['subtitles']['cues']])
            self.assertEqual([c['content']['text'] for c in translated], ['你好世界', '我们的冒险开始了'])
            self.assertEqual(len(saved['subtitles']['bindings']), 2)
            self.assertEqual(json.loads(source.read_text(encoding='utf-8')), original)
            manifest = json.loads((result.run_directory / 'manifest.json').read_text(encoding='utf-8'))
            self.assertEqual([s['llmRequest']['model'] for s in manifest['steps']], ['custom-model', 'zhipu-model'])

    def test_failed_proofread_retains_original_even_when_cleanup_enabled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mosp'
            original = native_project(project('Hello world', 'Our adventure begins'))
            source.write_text(json.dumps(original), encoding='utf-8')
            media = root / 'clip.mp4'
            media.write_bytes(b'media')
            env = root / 'empty.env'
            env.write_text('', encoding='utf-8')
            events = []
            plan = {'enabled': True, 'retainIntermediate': False, 'steps': [
                {'id': 'proofread', 'enabled': True, 'providerId': 'custom'},
                {'id': 'translate', 'enabled': True, 'providerId': 'zhipu', 'target': 'zh'}]}
            settings = {
                'custom': {'apiKey': 'test-secret', 'baseUrl': 'https://generativelanguage.googleapis.com/v1beta/openai/',
                           'model': 'models/gemini-test', 'reasoningMode': 'low', 'verified': '1'},
                'zhipu': {'apiKey': 'test-secret', 'baseUrl': 'https://example.test', 'model': 'translate-test', 'verified': '1'}}
            def complete(settings, prompt, cues):
                self.assertEqual(settings.model, 'models/gemini-test')
                return {'groups': [{'id': c['id'], 'text': '你好世界'} for c in cues]}
            with patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=complete) as llm:
                with self.assertRaises(PostprocessPipelineError) as caught:
                    run_postprocess_pipeline(plan, project_path=source, srt_path=root / 'source.srt', media_path=media,
                        env_path=env, ffmpeg_path=None, cancel_event=Event(), on_event=events.append, llm_settings=settings)
            self.assertEqual(caught.exception.failed_step, 'proofread')
            llm.assert_called_once()
            run = caught.exception.run_directory
            manifest = json.loads((run / 'manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(manifest['status'], 'failed')
            preserved = json.loads(Path(manifest['initialProjectPath']).read_text(encoding='utf-8'))
            self.assertEqual(preserved['subtitles'], original['subtitles'])
            self.assertEqual(json.loads(source.read_text(encoding='utf-8')), original)
            self.assertNotIn('finalProjectPath', manifest)
            self.assertEqual(manifest['steps'][1]['status'], 'pending')
            summary = {'providerId': 'custom', 'model': 'gemini-test', 'reasoningMode': 'low'}
            self.assertEqual(manifest['steps'][0]['llmRequest'], summary)
            self.assertIn({'stage': 'llm_request', 'step': 'proofread', **summary}, events)
            audit = json.dumps([manifest, events])
            self.assertNotIn('test-secret', audit)
            self.assertNotIn('generativelanguage.googleapis.com', audit)

    def test_model_audit_uses_request_name_and_redacts_secrets(self):
        summary = llm_request_summary(LlmSettings('custom', 'sk-hidden',
            'https://generativelanguage.googleapis.com/v1beta/openai/', 'models/gemini-test\nsk-hidden', 'low'))
        self.assertTrue(summary['model'].startswith('gemini-test'))
        self.assertNotIn('sk-hidden', summary['model'])
        self.assertNotIn('\n', summary['model'])
