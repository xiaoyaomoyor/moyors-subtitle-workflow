import copy
import threading
import unittest
from unittest.mock import patch

from maw.subtitle_punctuation import DEFAULT_TAIL_PUNCT, strip_segment_tails, strip_tail_text, tail_strip_symbols
from maw.postprocess import LlmPostprocessRequest, OutputMode, process_llm_snapshot
from maw.postprocess_pipeline import default_postprocess_plan
from maw.msw.jobs import translate_snapshot


class SubtitlePunctuationTests(unittest.TestCase):
    def test_policy_handles_width_variants_and_explicit_preservation(self):
        plan = default_postprocess_plan()
        self.assertEqual(set(tail_strip_symbols(plan)), set(DEFAULT_TAIL_PUNCT))
        step = plan['steps'][0]
        step['extraSplitPunctuation'] += ['~', '。']
        step['preservePunctuation'] += ['。']
        symbols = tail_strip_symbols(plan)
        self.assertNotIn('.', symbols)
        self.assertNotIn('。', symbols)
        self.assertIn('~', symbols)
        self.assertEqual(strip_tail_text('Price 3.14, U.S. rules.  ', DEFAULT_TAIL_PUNCT), 'Price 3.14, U.S. rules')
        self.assertEqual(strip_tail_text('From the U.S.', DEFAULT_TAIL_PUNCT), 'From the U.S.')
        self.assertEqual(strip_tail_text('句内，逗号。', DEFAULT_TAIL_PUNCT), '句内，逗号')
        self.assertEqual(strip_tail_text('Really?!', tail_strip_symbols(plan)), 'Really?!')

    def test_items_follow_suffix_without_changing_timing(self):
        cues = [{'id': 'a', 'text': 'Hello.  ', 'start': 0, 'end': 900,
                 'items': [{'text': 'Hello', 'start': 0, 'end': 700}, {'text': '.', 'start': 700, 'end': 800},
                           {'text': '  ', 'start': 800, 'end': 900}]}]
        strip_segment_tails(cues, DEFAULT_TAIL_PUNCT)
        self.assertEqual(cues, [{'id': 'a', 'text': 'Hello', 'start': 0, 'end': 900,
                                'items': [{'text': 'Hello', 'start': 0, 'end': 700}]}])
        before = copy.deepcopy(cues)
        strip_segment_tails(cues, '')
        self.assertEqual(cues, before)

    def test_translation_policy_preserves_source_ids_times_and_skipped_cues(self):
        project = {'segments': [{'id': 'source-a', 'start': 0, 'end': 1000, 'text': 'Hello.'},
                                {'id': 'source-b', 'start': 1200, 'end': 2000, 'text': '已经是中文。'}]}
        before = copy.deepcopy(project)
        request = LlmPostprocessRequest(None, None, OutputMode.JSON, 'translate_zh', '',
                                        embed_translations=True, strip_tail_punct=DEFAULT_TAIL_PUNCT)
        result = process_llm_snapshot(project, request, complete=lambda _, cues: {
            'groups': [{'id': c['id'], 'text': '你好。'} for c in cues]})
        self.assertEqual([s['text'] for s in result.project['segments']], ['你好', '已经是中文。'])
        self.assertEqual(project, before)
        self.assertEqual([(s['id'], s['start'], s['end']) for s in result.project['segments']],
                         [('source-a', 0, 1000), ('source-b', 1200, 2000)])

    def test_editor_translation_uses_same_tail_policy(self):
        snapshot = {'entries': [{'source': {'id': 'source-a', 'text': 'Hello.', 'start': 0, 'end': 1000}}]}
        with patch('maw.msw.jobs.complete_subtitle_groups', return_value={'groups': [{'id': 'c0001', 'text': '你好。'}]}):
            result = translate_snapshot(snapshot, 'zh', '', None, threading.Event(), lambda *_: None,
                                        strip_tail_punct=DEFAULT_TAIL_PUNCT)
        self.assertEqual(result['translations'], [{'id': 'source-a', 'text': '你好'}])
