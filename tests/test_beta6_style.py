import copy
import unittest

from maw.ass_styles import normalize_ass_style_library
from maw.project import normalize_project
from maw.msw.subtitle_style import styled_ass


class Beta6SpeakerStyleTests(unittest.TestCase):
    def test_frozen_names_color_only_prefix_and_keep_source(self):
        cue = dict(id='one', start=0, end=2000, text='Body: {literal}\\text\nnext', color={'name': 'red'})
        project = {'segments': [cue], 'overlay_track': {'enabled': True, 'segments': [dict(cue, id='overlay')]},
            'color_palette': [{'name': 'red', 'value': '#123456'}],
            'preview': {'ass_library_exports': True, 'burn_ass_library': normalize_ass_style_library({}),
                'subtitle': {'x': .1, 'y': .76, 'width': .8, 'height': .16, 'ass_color_style': 'speaker'},
                'burn_speaker_labels': {'enabled': True, 'names': {'red': '{Name}\\'}, 'separator': '：'}}}
        normalized = normalize_project(project)
        self.assertEqual(normalized['preview']['subtitle']['ass_color_style'], 'speaker')
        original = copy.deepcopy(project)
        plan = {'intervals': [{'start_ms': 0, 'end_ms': 2000, 'output_start_ms': 0}]}
        output = styled_ass(project, plan, 'main', {'width': 1920, 'height': 1080})
        events = [line for line in output.splitlines() if line.startswith('Dialogue:')]
        self.assertEqual(len(events), 2)
        for event in events:
            self.assertIn(r'{\c&H563412&}\{Name\}\\：{\c&HFFFFFF&}Body:', event)
            self.assertIn(r'\{literal\}\\text\Nnext', event)
        self.assertEqual(project, original)
        project['preview']['burn_speaker_labels']['enabled'] = False
        plain = styled_ass(project, plan, 'main', {'width': 1920, 'height': 1080})
        self.assertNotIn(r'\{Name\}', plain)
        self.assertNotIn(r'\c&H563412', plain)
        project['preview']['burn_speaker_labels']['names']['red'] = 'bad\nlabel'
        with self.assertRaises(ValueError):
            normalize_project(project)
