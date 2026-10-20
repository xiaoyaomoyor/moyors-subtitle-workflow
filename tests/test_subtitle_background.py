import copy
import json
import subprocess
import unittest
from pathlib import Path

from maw.msw import subtitle_background as bg, cue_style, flat_subtitles as flat
from maw.msw.track_presentation import layout, position_anchor
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.project_subtitle_style import builtin_presets, normalize_project_style
from tests.test_subtitle_animation import model

ROOT = Path(__file__).resolve().parents[1]


class SubtitleBackgroundTests(unittest.TestCase):
    def project(self, **patch):
        p = flat.migrate_project(dict(segments=[dict(id='a', start=1000, end=5000, text='Long first line\nSecond line')]))
        style = builtin_presets()[0]
        style['main'].update(backgroundShape='rounded', backgroundColor='#c03020', backgroundOpacity=80)
        style['main'].update(patch)
        p['preview'] = dict(project_style=style)
        return p

    def test_validation_presets_inheritance_and_roundtrip(self):
        p = self.project()
        p['subtitles']['cues'][0]['content']['subtitle_style'] = dict(backgroundPaddingY=30)
        flat.validate(p)
        row = layout(p)[0]
        self.assertEqual(row['style']['backgroundShape'], 'rounded')
        self.assertEqual(row['style']['backgroundPaddingY'], 30)
        normalized = normalize_project_style(p['preview']['project_style'])
        for field in bg.DEFAULTS:
            self.assertEqual(normalized['main'][field],p['preview']['project_style']['main'][field])
        for patch in [dict(backgroundShape='bubble'),dict(backgroundOpacity=True),dict(backgroundColor='red'),
                      dict(backgroundPaddingX=-1),dict(backgroundRadius=241),dict(backgroundOpacity=float('nan'))]:
            self.assertFalse(cue_style.valid(patch))
            with self.assertRaises(ValueError): normalize_project_style(dict(p['preview']['project_style'], main=patch))
        self.assertEqual(p, json.loads(json.dumps(p)))

    def test_padding_affects_packing_and_drawing_keeps_all_nine_anchors(self):
        p = self.project()
        before = layout(p)[0]
        p['preview']['project_style']['main']['backgroundPaddingY'] += 20
        after = layout(p)[0]
        self.assertAlmostEqual(after['height']-before['height'], 40)
        for alignment in range(1, 10):
            cue = p['subtitles']['cues'][0]['content']
            cue['subtitle_position'] = dict(x=.4,y=.6,alignment=alignment)
            row = layout(p)[0]
            self.assertEqual(position_anchor(row,1920), cue['subtitle_position'])
            box = bg.bounds(row['style'],row['size'],alignment)
            self.assertAlmostEqual(row['x'],768+box['x'])
            self.assertAlmostEqual(row['y'],648+box['y'])
        p['preview']['project_style']['main']['angle'] = 25
        row=layout(p)[0]
        self.assertEqual(position_anchor(row,1920), cue['subtitle_position'])

    def test_js_python_background_geometry_agrees(self):
        style = self.project(angle=32)['preview']['project_style']['main']
        size = layout(self.project(angle=32))[0]['size']
        script = "const B=require('./web/msw-subtitle-background.js'),p=JSON.parse(process.argv[1]);console.log(JSON.stringify(Array.from({length:9},(_,i)=>B.bounds(p.style,p.size,i+1))))"
        actual=json.loads(subprocess.check_output(['node','-e',script,json.dumps(dict(style=style,size=size))],cwd=ROOT,text=True))
        for i,a in enumerate(actual):
            for k,v in bg.bounds(style,size,i+1).items(): self.assertAlmostEqual(a[k],v)

    def test_background_is_one_full_shape_not_per_glyph_and_shares_export_clock(self):
        p = self.project()
        p['subtitles']['cues'][0]['content']['subtitle_animation'] = model(typewriter=dict(enabled=True,end=100),transform=dict(enabled=True,fromX=-50,toX=100,end=100,easing='linear'))
        before=copy.deepcopy(p)
        video=dict(width=640,height=360)
        ass=preview_ass(dict(project=p,video=video))['ass']
        plan=dict(intervals=[dict(start_ms=0,end_ms=43200000,output_start_ms=0)])
        self.assertEqual(ass,styled_ass(p,plan,'both',video))
        backgrounds=[line for line in ass.splitlines() if line.startswith('Dialogue:') and r'\p1' in line]
        self.assertEqual(len(backgrounds),1)
        self.assertIn(r'\alpha&H33&',backgrounds[0])
        self.assertIn(r'\move(',backgrounds[0])
        self.assertIn(' b ',backgrounds[0])
        self.assertEqual(p,before)

    def test_disabled_empty_and_background_none_do_not_add_vector_events(self):
        p = self.project(backgroundShape='none')
        call=lambda:preview_ass(dict(project=p,video=dict(width=640,height=360)))['ass']
        self.assertNotIn(r'\p1',call())
        p['preview']['project_style']['main']['backgroundShape']='rect'
        p['subtitles']['cues'][0]['content']['disabled']=True
        self.assertNotIn('Dialogue:',call())
        p['subtitles']['cues'][0]['content'].update(disabled=False,text='')
        self.assertNotIn('Dialogue:',call())

    def test_legacy_motion_keeps_background_fill_and_opacity_independent(self):
        p=self.project(scaleX=200,backgroundOpacity=50)
        s=p['preview']['project_style']
        s['animations']['fade'].update(enabled=True,alpha1=255,alpha2=0,alpha3=255)
        s['animations']['t'].update(enabled=True,tags=r'\fscx300\c&H00FF00&\bord20\alpha&H80&')
        row=layout(p)[0]
        tags=bg.legacy_tags(row['style'],row['animations'],100,200)
        self.assertIn(r'\fscx150',tags)
        self.assertIn(r'\alpha&HC0&',tags)
        self.assertIn(r'\fade(255,128,255,',tags)
        self.assertNotIn(r'\c&H00FF00&',tags)
        self.assertNotIn(r'\bord20',tags)
