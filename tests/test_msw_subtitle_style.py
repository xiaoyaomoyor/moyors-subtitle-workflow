import copy
import unittest

from maw.msw.subtitle_style import normalize_styles, styled_ass
from maw.project import normalize_project


class SubtitleStyleTests(unittest.TestCase):
    def test_style_validation_and_project_roundtrip(self):
        style=normalize_styles({'main':{'font_family':'Microsoft YaHei','background_alpha':.6,'x':.3}})
        project={'segments':[],'preview':{'burn_subtitles':style}}
        self.assertEqual(normalize_project(project)['preview']['burn_subtitles'],style)
        for bad in [{'main':{'font_size':float('nan')}},{'main':{'font_family':'Arial\nStyle: bad'}},{'secondary':{'outline':13}},{'main':{'color':'red'}}]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):normalize_styles(bad)

    def test_tracks_keep_independent_styles_gap_mapping_and_literal_text(self):
        project={'segments':[{'start':1000,'end':3000,'text':r'{\pos(0,0)} main'}],
                 'multi_subtitle':{'enabled':True,'tracks':[{'segments':[{'start':1000,'end':3000,'text':'second\nline'}]}]},
                 'preview':{'burn_subtitles':{'main':{'color':'#ff0000','background_alpha':.5},'secondary':{'color':'#00ff00','font_size':30}}}}
        before=copy.deepcopy(project)
        plan={'intervals':[{'start_ms':1000,'end_ms':3000,'output_start_ms':0}]}
        ass=styled_ass(project,plan,'both',{'width':1920,'height':1080},start_ms=500,end_ms=1000)
        self.assertIn('PlayResX: 1920',ass)
        self.assertIn('Style: main,Arial,48,&H000000ff',ass)
        self.assertIn('Style: secondary,Arial,30,&H0000ff00',ass)
        self.assertIn(r'\{\\pos(0,0)\}',ass)
        self.assertIn('Dialogue: 0,0:00:00.00,0:00:00.50,main-bg',ass)
        self.assertIn(r'second\Nline',ass)
        self.assertEqual(project,before)
        frame=styled_ass(project,plan,'main',{'width':1920,'height':1080},frame_at=3000)
        self.assertNotIn('Dialogue:',frame)

    def test_library_opt_in_snapshot_three_tracks_and_preview_clock(self):
        from maw.ass_styles import normalize_ass_style_library
        library = normalize_ass_style_library({
            'styles': [{'id': 'custom', 'fontName': 'Snapshot Font', 'fontSize': 42}],
            'assProfiles': [{'id': 'motion', 'styleId': 'custom', 'animations': {
                'fad': {'enabled': True, 'inMs': 200, 'outMs': 100},
                'move': {'enabled': True, 'x1': 1, 'y1': 2, 'x2': 3, 'y2': 4}}}],
            'assignments': {'assExportProfileId': 'motion'}})
        cue = {'start': 1000, 'end': 3000, 'text': 'main', 'color': {'name': 'red'}}
        project = {'segments': [cue], 'preview': {'burn_ass_library': library},
            'multi_subtitle': {'enabled': True, 'tracks': [{'segments': [dict(cue, text='second')]}]},
            'overlay_track': {'enabled': True, 'segments': [dict(cue, text='overlay')]},
            'color_palette': [{'name': 'red', 'value': '#123456'}]}
        plan = {'intervals': [{'start_ms': 0, 'end_ms': 4000, 'output_start_ms': 0}]}
        video = {'width': 1920, 'height': 1080}
        legacy = styled_ass(project, plan, 'both', video)
        self.assertIn('Style: main,Arial,48', legacy)
        self.assertNotIn('Snapshot Font', legacy)
        project['preview']['ass_library_exports'] = True
        before = copy.deepcopy(project)
        output = styled_ass(project, plan, 'both', video, frame_at=1500)
        self.assertIn('Style: main,Snapshot Font,42', output)
        self.assertIn('&H00563412', output)
        events = [line for line in output.splitlines() if line.startswith('Dialogue:')]
        self.assertEqual(len(events), 3)
        self.assertTrue(all(',0:00:01.00,0:00:03.00,' in line for line in events))
        self.assertIn(r'\move(', events[0])
        self.assertNotIn(r'\move(', events[1] + events[2])
        self.assertTrue(all(r'\fad(200,100)' in line for line in events))
        self.assertEqual(project, before)
        del project['preview']['burn_ass_library']
        with self.assertRaisesRegex(ValueError, '快照'):
            styled_ass(project, plan, 'both', video)

    def test_overlay_only_mapping_keeps_secondary_slot_and_crops_gaps(self):
        from maw.msw.subtitle_export import mapped_subtitles, burning_cues
        project = {'segments': [], 'overlay_track': {'enabled': True, 'segments': [
            {'start': 500, 'end': 3500, 'text': 'overlay'}]}}
        plan = {'intervals': [{'start_ms': 0, 'end_ms': 1000, 'output_start_ms': 0},
                              {'start_ms': 3000, 'end_ms': 4000, 'output_start_ms': 1000}]}
        groups = mapped_subtitles(project, plan)
        self.assertEqual(groups[:2], [('主字幕', []), ('副字幕', [])])
        self.assertEqual(groups[2][1], [{'start': 500, 'end': 1000, 'text': 'overlay'},
                                      {'start': 1000, 'end': 1500, 'text': 'overlay'}])
        self.assertTrue(burning_cues(project, plan, 'main'))
        self.assertEqual(burning_cues(project, plan, 'none'), [])
        project['overlay_track']['enabled'] = False
        self.assertEqual(mapped_subtitles(project, plan), [('主字幕', [])])
