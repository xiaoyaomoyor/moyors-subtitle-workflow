import copy
import unittest

from maw.postprocess import LlmPostprocessRequest, OutputMode, process_llm_snapshot
from maw.resegment_boundaries import normalize_max_chars


class ResegmentBoundaryTests(unittest.TestCase):
    def process(self, segments, complete=None, **options):
        project = {'segments': copy.deepcopy(segments)}
        before = copy.deepcopy(project)
        request = LlmPostprocessRequest(None, None, OutputMode.JSON, 'resegment', '', **options)
        result = process_llm_snapshot(project, request, complete=complete or (
            lambda prompt, cues: {'groups': [{'atom_ids': [a['id'] for c in cues for a in c['items']]}]}))
        self.assertEqual(project, before)
        self.assertEqual(''.join(s['text'] for s in result.project['segments']), ''.join(s['text'] for s in segments))
        return result

    def test_partial_timing_keeps_reliable_words_and_coarse_cue_without_fake_items(self):
        segments = [{'id': 'a', 'start': 0, 'end': 1000, 'text': '甲乙', 'items': [
            {'start': 100, 'end': 400, 'text': '甲'}, {'start': 500, 'end': 900, 'text': '乙'}]},
            {'id': 'b', 'start': 1200, 'end': 2000, 'text': '不猜时间', 'note': 'keep'}]
        result = self.process(segments, resegment_max_chars=1)
        rows = result.project['segments']
        self.assertEqual([(s['start'], s['end']) for s in rows], [(100,400),(500,900),(1200,2000)])
        self.assertEqual([s['text'] for s in rows], ['甲', '乙', '不猜时间'])
        self.assertNotIn('items', rows[-1])
        self.assertEqual(rows[-1]['id'], 'b')
        self.assertIn('超过最大', ''.join(result.warnings))

    def test_decimal_ratio_and_unit_boundaries_cannot_be_split(self):
        for protected in ('16:9', '1.25秒', '20 cm', '20 m', '20 °C', '20℃'):
            text = '测试' + protected + '结束'
            items = [{'text': char, 'start': i*100, 'end': (i+1)*100} for i,char in enumerate(text)]
            result = self.process([{'id':'a','start':0,'end':len(text)*100,'text':text,'items':items}],
                complete=lambda p, cues: {'groups':[{'atom_ids':[a['id']]} for c in cues for a in c['items']]}, resegment_max_chars=2)
            bodies = [s['text'] for s in result.project['segments']]
            self.assertTrue(any(protected in body for body in bodies), bodies)
            self.assertEqual([i for s in result.project['segments'] for i in s['items']], items)

    def test_rewrite_or_partial_coverage_never_outputs_partial_project(self):
        segments = [{'id':'a','start':0,'end':1000,'text':'原文'}]
        for response in ({'groups':[{'id':'c0001','text':'改写'}]}, {'groups':[]}, {'groups':[{'atom_ids':['missing']}]}):
            with self.subTest(response=response), self.assertRaises(ValueError):
                self.process(segments, complete=lambda p,c: response)

    def test_maximum_input_validation(self):
        for value in (True, -1, 1.2, 'abc', 1001):
            with self.assertRaises(ValueError): normalize_max_chars(value)
        for value in ('', None, 0, '0'): self.assertEqual(normalize_max_chars(value),0)
