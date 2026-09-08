import copy
import json
from pathlib import Path
import unittest

from maw.msw.audio_plan import compile_plan

FIXTURES = json.loads((Path(__file__).parent / 'fixtures' / 'msw_audio_render.json').read_text(encoding='utf-8'))


class AudioPlanTests(unittest.TestCase):
    def test_shared_browser_server_fixtures(self):
        for fixture in FIXTURES:
            with self.subTest(fixture=fixture['name']):
                original = copy.deepcopy(fixture['project'])
                self.assertEqual(compile_plan(original, fixture['options']), fixture['expected'])
                self.assertEqual(original, fixture['project'])

    def test_reject_invalid_options_and_empty_range(self):
        for changes in [dict(start_ms=8000), dict(start_ms=-1), dict(duration_ms=float('inf')),
                        dict(voice_gain_db=13), dict(source_audio_index=-1), dict(remove_gaps=1)]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                compile_plan(FIXTURES[0]['project'], {**FIXTURES[0]['options'], **changes})
        with self.assertRaises(ValueError):
            compile_plan(dict(segments=[]))

    def test_overlapping_and_unused_assets_do_not_change_clip_placement(self):
        project = copy.deepcopy(FIXTURES[0]['project'])
        project['msw']['audio_clips'].append({**project['msw']['audio_clips'][0], 'id': 'other', 'muted': True})
        self.assertEqual(compile_plan(project, FIXTURES[0]['options']), FIXTURES[0]['expected'])
        project['msw']['audio_clips'][-1]['muted'] = False
        plan = compile_plan(project, FIXTURES[0]['options'])
        self.assertEqual(len(plan['pieces']), 4)
        self.assertEqual(plan['sample_count'], 240000)
