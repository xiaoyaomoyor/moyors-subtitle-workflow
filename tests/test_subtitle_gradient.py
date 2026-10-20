import json
import subprocess
import unittest
from pathlib import Path
from maw.msw import subtitle_gradient as g, subtitle_animation as a, flat_subtitles as flat
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.project_subtitle_style import builtin_presets, normalize_project_style

ROOT=Path(__file__).resolve().parents[1]


class SubtitleGradientTests(unittest.TestCase):
    style=dict(gradientMode='characters',gradientStart='#ff0000',gradientEnd='#00ff00')

    def test_js_python_colors_validation_and_preset_roundtrip(self):
        script="const G=require('./web/msw-subtitle-gradient.js'),s=JSON.parse(process.argv[1]);console.log(JSON.stringify(Array.from({length:7},(_,i)=>G.color(s,i,7))))"
        actual=json.loads(subprocess.check_output(['node','-e',script,json.dumps(self.style)],cwd=ROOT,text=True))
        self.assertEqual(actual,[g.color(self.style,i,7) for i in range(7)])
        self.assertFalse(g.valid(dict(gradientEnd='#fff')))
        self.assertFalse(g.valid(dict(gradientMode='spatial')))
        style=builtin_presets()[0];style['main'].update(self.style)
        for key,value in self.style.items():
            self.assertEqual(normalize_project_style(style)['main'][key],value)

    def test_graphemes_whitespace_and_ass_escaping(self):
        result=g.ass('A\u0301 \n字',self.style)
        self.assertEqual(result,r'{\1c&H0000ff&}Á \N{\1c&H00ff00&}字')
        self.assertIn(r'\{',g.ass('{',self.style))
        self.assertEqual(g.color(self.style,0,1),'#ff0000')

    def test_gradient_typewriter_has_stable_color_and_export_identity(self):
        p=flat.migrate_project(dict(segments=[dict(id='a',start=0,end=2000,text='ABCD')]))
        cue=p['subtitles']['cues'][0]['content'];cue['subtitle_style']=self.style
        motion=a.normalize(dict(schema=a.SCHEMA,effects={'typewriter':dict(a.DEFINITIONS['typewriter'],enabled=True,end=100)}))
        cue['subtitle_animation']=motion;flat.validate(p)
        plan=dict(intervals=[dict(start_ms=0,end_ms=4000,output_start_ms=0)])
        video=dict(width=640,height=360)
        rendered=styled_ass(p,plan,'both',video)
        self.assertEqual(rendered,preview_ass(dict(project=p,video=video))['ass'])
        events=[s for s in rendered.splitlines() if s.startswith('Dialogue:')]
        self.assertGreater(len(events),1)
        for event in events:
            self.assertIn(r'{\1c&H0000ff&}A',event);self.assertIn(r'{\1c&H00ff00&}D',event)
        cue.pop('subtitle_animation')
        self.assertEqual(len([s for s in styled_ass(p,plan,'both',video).splitlines() if s.startswith('Dialogue:')]),1)
