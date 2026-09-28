import copy
import unittest

from maw.msw.project_codec import normalize_extension
from maw.msw.asr import validate_snapshot
from maw.project import normalize_project


class ResultContractTests(unittest.TestCase):
    def test_candidate_namespace_round_trip_and_invalid_values(self):
        ext = {'schema': 'msw.editor.v1', 'project_id': 'p', 'processing_results': [{
            'id': 'batch', 'kind': 'translation', 'number': 1,
            'edits': [{'job_id': 'job', 'index': 350, 'text': 'edited'}],
            'applications': {'secondary': {'revision': 'revision', 'state': {'snapshot': {}}}}}]}
        self.assertEqual(normalize_extension(ext), ext)
        for field, value in [('number', True), ('kind', 'unexpected'), ('edits', [{}]),
                             ('applications', {'unknown': {'revision': 'x'}})]:
            changed = copy.deepcopy(ext)
            changed['processing_results'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                normalize_extension(changed)

    def test_crossing_secondary_snapshot_preserves_metadata_and_review_flag(self):
        cue = {'id': 'secondary', 'start': 1000, 'end': 9000, 'text': 'original',
               'review_required': True, 'color_ref': {'name': 'purple', 'headIdx': 10}}
        raw = {'project_id': 'p', 'source': {'id': 'media', 'revision': 'a'*64, 'duration_ms': 10000},
               'mode': 'range', 'range': {'start': 3000, 'end': 5000}, 'targets': [],
               'secondary': {'track_id': 'secondary-track', 'targets': [cue]}}
        self.assertEqual(validate_snapshot(raw)['secondary']['targets'], [cue])
        self.assertTrue(normalize_project({'segments': [{k:v for k,v in cue.items() if k != 'color_ref'}]})['segments'][0]['review_required'])
        raw['secondary']['track_id'] = []
        with self.assertRaises(ValueError):
            validate_snapshot(raw)
