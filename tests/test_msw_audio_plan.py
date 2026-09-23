import copy
import json
from pathlib import Path
import unittest

from maw.msw.audio_plan import compile_plan, monitor_gains

FIXTURES = json.loads((Path(__file__).parent / 'fixtures' / 'msw_audio_render.json').read_text(encoding='utf-8'))


class AudioPlanTests(unittest.TestCase):
    def test_overlay_only_export_duration_and_disabled_track(self):
        project = {'segments': [], 'overlay_track': {'enabled': True, 'segments': [
            {'start': 100, 'end': 2500, 'text': 'overlay'}]}}
        self.assertEqual(compile_plan(project)['source_end_ms'], 2500)
        project['overlay_track']['enabled'] = False
        with self.assertRaises(ValueError):
            compile_plan(project)

    def test_shared_monitor_levels(self):
        for c in json.loads((Path(__file__).parent/'fixtures/msw_monitor.json').read_text()):
            with self.subTest(c=c):
                monitor={k:c[k] for k in ['mode','volume','muted','source_gain_db']}
                source,voice,source_mute,voice_mute=monitor_gains(dict(monitor=monitor,source_gain_db=2,voice_gain_db=-3))
                self.assertAlmostEqual(source,c['source']);self.assertAlmostEqual(voice,c['voice'])
                self.assertEqual((source_mute,voice_mute),(c['silent_source'],c['silent_voice']))

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
