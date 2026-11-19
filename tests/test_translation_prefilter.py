"""Translation routing and durable policy, independent of a real LLM service."""
import copy
import tempfile
import threading
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from maw.postprocess import LlmPostprocessRequest, OutputMode, process_llm_snapshot
from maw.postprocess_llm import LlmSettings
from maw.postprocess_pipeline import normalize_plan, _run_step, save_postprocess_plan, load_postprocess_plan
from maw.launcher_processing import processing_snapshot
from maw.msw.flat_subtitles import migrate_project, add_track
from maw.msw.jobs import JobManager, translate_snapshot, validate_snapshot


def project(texts, language='', provenance='unknown'):
    return dict(language=language, language_source=provenance,
                segments=[dict(id=f'source-{i}', start=i*1000, end=i*1000+900, text=text)
                          for i, text in enumerate(texts)])


REQUEST = LlmPostprocessRequest(None, None, OutputMode.JSON, 'translate_zh', '')
SETTINGS = LlmSettings('custom', '', 'http://127.0.0.1:1/v1', 'synthetic', 'off')


class TranslationPrefilterTests(unittest.TestCase):
    def run_snapshot(self, source, request=REQUEST):
        sent = []
        def complete(_prompt, cues):
            sent.extend(c['text'] for c in cues)
            return {'groups': [{'id': c['id'], 'text': '译文 ' + c['id']} for c in cues]}
        result = process_llm_snapshot(source, request, complete=complete, allow_translation_noop=True)
        return sent, result

    def test_han_only_japanese_unknown_and_inferred_sources_are_translated(self):
        for language, provenance in [('ja', 'detected'), ('Japanese', 'hint'), ('', 'unknown'),
                                     ('zh', 'inferred'), ('zh', 'unknown')]:
            with self.subTest(language=language, provenance=provenance):
                sent, result = self.run_snapshot(project(['大学生活'], language, provenance))
                self.assertEqual(sent, ['大学生活'])
                self.assertFalse(result.skipped_source_ids)

    def test_entire_batch_vetoes_japanese_or_korean_even_with_chinese_hint(self):
        for other in ['こんにちは', 'ｶﾀｶﾅ', '안녕하세요']:
            source = project(['大学生活', other], 'Chinese', 'hint')
            sent, result = self.run_snapshot(source)
            self.assertEqual(sent, ['大学生活', other])
            self.assertFalse(result.skipped_source_ids)

    def test_trusted_chinese_preserves_word_times_and_untranslated_other_language(self):
        source = project(['你好世界', 'Hola mundo'], 'zh-CN', 'detected')
        source['segments'][0]['items'] = [dict(start=0, end=900, text='你好世界')]
        before = copy.deepcopy(source)
        sent, result = self.run_snapshot(source)
        self.assertEqual(sent, ['Hola mundo'])
        self.assertEqual(result.project['segments'][0], source['segments'][0])
        self.assertEqual(source, before)

    def test_off_switch_sends_chinese_and_symbols_but_preserves_blank(self):
        sent, result = self.run_snapshot(project(['你好世界', '12345', ''], 'zh', 'hint'),
                                         replace(REQUEST, skip_target_language=False))
        self.assertEqual(sent, ['你好世界', '12345'])
        self.assertEqual(result.project['segments'][2]['text'], '')

    def test_latin_script_is_not_proof_of_english(self):
        sent, _ = self.run_snapshot(project(['Hola mundo', 'Bonjour'], 'en', 'hint'),
                                   replace(REQUEST, operation='translate_en'))
        self.assertEqual(sent, ['Hola mundo', 'Bonjour'])

    def test_resume_cache_is_invalidated_by_policy_or_language_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            request = replace(REQUEST, translation_progress_path=Path(directory)/'progress.json')
            source = project(['Hello'], 'zh', 'hint')
            self.assertEqual(self.run_snapshot(source, request)[0], ['Hello'])
            self.assertEqual(self.run_snapshot(source, request)[0], [])
            self.assertEqual(self.run_snapshot(source, replace(request, skip_target_language=False))[0], ['Hello'])
            source['language_source'] = 'unknown'
            self.assertEqual(self.run_snapshot(source, replace(request, skip_target_language=False))[0], ['Hello'])

    def native_snapshot(self, language='ja', provenance='detected'):
        p = migrate_project(project(['大学生活'], language, provenance))
        p = add_track(p, {**copy.deepcopy(p['subtitles']['tracks'][0]), 'id': 'target', 'name': 'Target'})
        cue = p['subtitles']['cues'][0]
        raw = dict(project_id='test-project', project_schema='msw.project.v4', flat_model=p['subtitles'],
                   subtitle_track_id='target', entries=[dict(source={'id': cue['id'], **cue['content']}, target=None)])
        raw['flat_model'].pop('migration', None)
        return p, raw

    def test_editor_uses_native_source_track_not_root_or_destination_language(self):
        for language, provenance, expected in [('ja', 'hint', 1), ('zh', 'unknown', 1), ('zh', 'detected', 0)]:
            _, raw = self.native_snapshot(language, provenance)
            raw.update(source_language=dict(language='zh', language_source='hint'))
            raw['flat_model']['tracks'][1].update(language='zh', language_source='hint')
            with patch('maw.msw.jobs.complete_subtitle_groups', side_effect=lambda _s, _p, cues, **kw:
                       {'groups': [{'id': c['id'], 'text': '译文'} for c in cues]}) as complete:
                result = translate_snapshot(validate_snapshot(raw), 'zh', '', SETTINGS, threading.Event(), lambda *_: None)
            self.assertEqual(complete.call_count, expected)
            self.assertEqual(bool(result['skipped_ids']), not expected)

    def test_launcher_snapshot_keeps_only_selected_track_language_provenance(self):
        p, _ = self.native_snapshot('ja', 'detected')
        p.update(language='zh', language_source='hint')
        source = processing_snapshot(p, p['subtitles']['cues'][0]['track_id'])
        self.assertEqual(source['language'], 'ja')
        self.assertEqual(source['language_source'], 'detected')
        self.assertEqual(self.run_snapshot(source)[0], ['大学生活'])

    def test_old_native_tracks_do_not_borrow_project_confidence(self):
        p, _ = self.native_snapshot('zh', 'hint')
        track = p['subtitles']['tracks'][0]
        del track['language_source']
        p.update(language='zh', language_source='hint')
        source = processing_snapshot(p, track['id'])
        self.assertEqual(source['language_source'], 'unknown')
        self.assertEqual(self.run_snapshot(source)[0], ['大学生活'])

    def test_plan_keeps_false_and_old_plans_default_on(self):
        for value in [False, True]:
            plan = normalize_plan({'steps': [dict(id='translate', skipTargetLanguage=value)]})
            self.assertIs(next(s for s in plan['steps'] if s['id']=='translate')['skipTargetLanguage'], value)
        self.assertTrue(next(s for s in normalize_plan({})['steps'] if s['id']=='translate')['skipTargetLanguage'])

    def test_pipeline_passes_frozen_false_to_shared_translation(self):
        with tempfile.TemporaryDirectory() as directory, patch('maw.postprocess_pipeline.run_llm_postprocess') as run:
            root = Path(directory)
            _run_step(dict(id='translate', target='zh', providerId='custom', skipTargetLanguage=False),
                      project_path=root/'input.mosp', srt_path=root/'input.srt', media_path=root/'input.wav',
                      env_path=root/'isolated.env', ffmpeg_path=None, ocr_runtime_root=None,
                      output_directory=root, cancel_event=threading.Event(), on_event=None, strip_tail_punct='',
                      llm_settings={'translate': dict(apiKey='', baseUrl=SETTINGS.base_url, model='synthetic', reasoningMode='off')})
            self.assertIs(run.call_args.args[0].skip_target_language, False)

    def test_pipeline_policy_round_trips_through_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'isolated.env'
            save_postprocess_plan(path, {'steps': [dict(id='translate', skipTargetLanguage=False)]})
            self.assertIs(next(s for s in load_postprocess_plan(path)['steps'] if s['id']=='translate')['skipTargetLanguage'], False)

    def test_snapshot_validates_switch_and_job_identity_includes_it(self):
        _, raw = self.native_snapshot('zh', 'hint')
        raw['skip_target_language'] = False
        with self.assertRaisesRegex(ValueError, '选项'):
            validate_snapshot({**raw, 'skip_target_language': 'false'})
        with tempfile.TemporaryDirectory() as directory:
            manager = JobManager(Path(directory)/'jobs.sqlite3', translate=lambda *_: {'translations': []})
            try:
                payload = dict(kind='translation', project_id='test-project', request_key='request-test',
                               snapshot=raw, language='zh', prompt='')
                job = manager.submit(payload, SETTINGS)
                saved = manager.get(job['id'], 'test-project')['snapshot']
                self.assertIs(saved['skip_target_language'], False)
                with self.assertRaisesRegex(ValueError, '相同请求'):
                    manager.submit({**payload, 'snapshot': {**raw, 'skip_target_language': True}}, SETTINGS)
                raw['flat_model']['tracks'][0]['language_source'] = 'unknown'
                self.assertEqual(saved['flat_model']['tracks'][0]['language_source'], 'hint')
                with self.assertRaisesRegex(ValueError, '相同请求'):
                    manager.submit(payload, SETTINGS)
            finally:
                manager.close()
                for worker in manager.workers:
                    worker.join(5)
                self.assertTrue(manager.close_complete.wait(5))
