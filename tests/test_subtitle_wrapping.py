import copy
import json
from pathlib import Path
import unittest

from maw.project_subtitle_style import builtin_presets, normalize_project_style
from maw.subtitle_wrapping import wrap_text
from maw.project import normalize_project
from maw.msw.subtitle_layers import migrate_project
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.msw.subtitle_export import mapped_subtitles, srt


class SubtitleWrappingTests(unittest.TestCase):
    def test_shared_character_cases_and_automatic_passthrough(self):
        cases=json.loads((Path(__file__).parent/'fixtures/subtitle-wrapping.json').read_text(encoding='utf-8'))
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(wrap_text(case['text'],{'wrapMode':'characters','charsPerLine':case['count']}),case['expected'])
                self.assertEqual(wrap_text(case['text'],{'wrapMode':'auto'}),case['text'])

    def test_invalid_wrapping_values_rejected(self):
        for key, values in [('wrapMode',[None,1,'words']),('charsPerLine',[0,201,1.5,True,None,'20'])]:
            for value in values:
                with self.subTest(key=key,value=value), self.assertRaises(ValueError):
                    style=builtin_presets()[0];style['main'][key]=value;normalize_project_style(style)

    def test_wrapping_roundtrip_preview_and_burn_preserve_source_and_srt(self):
        for legacy in (False,True):
            with self.subTest(legacy=legacy):
                style=builtin_presets()[0]
                style['main'].update(wrapMode='characters',charsPerLine=3)
                style['secondary'].update(wrapMode='characters',charsPerLine=2)
                if legacy:style['legacyBurn']={}
                project=normalize_project(migrate_project({'segments':[dict(id='m',start=0,end=1000,text='ABCDEF')],
                    'multi_subtitle':{'enabled':True,'tracks':[{'id':'s','segments':[dict(id='s1',start=0,end=1000,text='甲乙丙丁')]}]},
                    'preview':{'project_style':style}}))
                before=copy.deepcopy(project)
                plan={'intervals':[{'start_ms':0,'end_ms':12*3600*1000,'output_start_ms':0}]}
                video={'width':1920,'height':1080}
                output=styled_ass(project,plan,'both',video)
                self.assertEqual(preview_ass({'project':project,'target':'both','video':video})['ass'],output)
                self.assertIn(r'ABC\NDEF',output);self.assertIn(r'甲乙\N丙丁',output)
                self.assertIn('ABCDEF',srt(mapped_subtitles(project,plan)[0][1]))
                self.assertEqual(project,before)
                self.assertEqual(normalize_project(json.loads(json.dumps(project)))['preview']['project_style'],project['preview']['project_style'])
