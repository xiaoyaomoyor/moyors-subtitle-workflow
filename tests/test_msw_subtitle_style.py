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
                 'multi_subtitle':{'tracks':[{'segments':[{'start':1000,'end':3000,'text':'second\nline'}]}]},
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
