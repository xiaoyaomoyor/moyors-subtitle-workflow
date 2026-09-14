import copy
import json
from pathlib import Path
import unittest

from maw.project import normalize_project, ProjectValidationFailed
from maw.project_io import serialize_mosp


class SubtitleAssetTests(unittest.TestCase):
    def project(self):
        project = json.loads((Path(__file__).parent / 'fixtures/msw_beta1_legacy_project.json').read_text(encoding='utf-8'))
        project['segments'] = []
        project.pop('multi_subtitle')
        project['msw']['subtitle_assets'] = [{'id': 'subtitle-1', 'kind': 'subtitle', 'batch_id': 'batch-1',
            'source_id': 'legacy-beta1', 'source_cue_id': 'main-1', 'track_id': None, 'created_at': 1789350000000,
            'original_start': 1000, 'start': 0, 'end': 1000, 'text': '独立素材',
            'items': [{'start': 0, 'end': 1000, 'text': '独立素材'}]}]
        project['msw']['asset_batches'] = [{'id': 'batch-1', 'kind': 'copy', 'created_at': 1789350000000}]
        return project

    def test_empty_timeline_serialization_round_trip(self):
        project = self.project()
        expected = copy.deepcopy(project['msw'])
        loaded = normalize_project(json.loads(serialize_mosp(project)))
        self.assertEqual(loaded['msw'], expected)
        self.assertEqual(loaded['segments'], [])

    def test_invalid_assets_and_batches_are_rejected(self):
        for patch in ({'end': 0}, {'start': True}, {'track_id': 4}, {'items': [{'start': 0, 'end': 1001, 'text': '越界'}]}):
            with self.subTest(patch=patch):
                project = self.project()
                project['msw']['subtitle_assets'][0].update(patch)
                with self.assertRaises(ProjectValidationFailed):
                    normalize_project(project)
        project = self.project()
        project['msw']['asset_batches'] = []
        with self.assertRaises(ProjectValidationFailed):
            normalize_project(project)
