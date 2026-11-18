import copy
import unittest

from maw.msw.review_markers import SCHEMA, validate
from maw.msw.flat_subtitles import migrate_project
from maw.project import normalize_project


class ReviewMarkersTest(unittest.TestCase):
    def sample(self):
        return {'schema': SCHEMA, 'items': [{'id': 'r', 'start_ms': 1000, 'end_ms': 2000,
                'name': '核对', 'note': '备注', 'color': '#e7b35a', 'status': 'pending',
                'cue_ids': ['deleted'], 'track_id': 'deleted'}]}

    def test_normalization_retains_independent_notes(self):
        p = migrate_project({'segments': [{'id': 'a', 'start': 0, 'end': 3000, 'text': 'hello'}]})
        before = copy.deepcopy(p['subtitles'])
        p['review_markers'] = self.sample()
        p['review_markers']['items'][0]['text_color'] = '#123aBC'
        result = normalize_project(p)
        self.assertEqual(result['review_markers'], p['review_markers'])
        self.assertEqual(result['subtitles'], before)

    def test_legacy_marker_color_is_not_rewritten(self):
        p = {'segments': [], 'review_markers': self.sample()}
        before = copy.deepcopy(p['review_markers'])
        self.assertEqual(normalize_project(p)['review_markers'], before)
        self.assertEqual(migrate_project(p)['review_markers'], before)

    def test_invalid_data_is_rejected_without_coercion(self):
        for patch in ({'start_ms': True}, {'start_ms': -1}, {'end_ms': 1000}, {'end_ms': None},
                      {'status': 'done'}, {'color': ['#e7b35a']}, {'cue_ids': ['a', 'a']},
                      {'note': '😀' * 1001}, {'text_color': None}, {'text_color': ''},
                      {'text_color': '#fff'}, {'text_color': '#ffffff80'},
                      {'text_color': ['#ffffff']}, {'text_color': 'red'}):
            value = self.sample()
            value['items'][0].update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate(value)
        value = self.sample()
        value['items'] *= 2
        with self.assertRaises(ValueError):
            validate(value)
