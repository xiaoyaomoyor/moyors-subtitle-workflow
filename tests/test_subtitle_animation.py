import copy
import json
import subprocess
import unittest
from pathlib import Path

from maw.msw import subtitle_animation as animation, flat_subtitles as flat
from maw.msw.subtitle_style import styled_ass
from maw.msw.subtitle_preview import preview_ass
from maw.msw.track_presentation import layout
from maw.project_subtitle_style import builtin_presets, normalize_project_style

ROOT = Path(__file__).resolve().parents[1]


def model(**effects):
    return animation.normalize(dict(schema=animation.SCHEMA, effects={key: {**animation.DEFINITIONS[key], **patch} for key, patch in effects.items()}))


class SubtitleAnimationTests(unittest.TestCase):
    def test_authoring_modes_four_point_fade_and_percentage_cycle(self):
        a=model(fade=dict(enabled=True,start=10,end=90,**{'in':20,'out':10}),
                blink=dict(enabled=True,period=20,periodUnit='percent',opacity=40),
                typewriter=dict(enabled=True),
                curves=dict(enabled=True,channels={'opacity':[dict(time=0,value=70,easing='linear')]}))
        for mode in ('presets','custom'):
            a['mode']=mode
            self.assertTrue(animation.valid(a))
            self.assertEqual(animation.normalize(a),a)
            times=[0,100,200,400,600,700,1000,1600,1750,1900,2000]
            script="const A=require('./web/msw-subtitle-animation.js'),a=JSON.parse(process.argv[1]);console.log(JSON.stringify(JSON.parse(process.argv[2]).map(t=>A.sample(a,t,2000,10))))"
            actual=json.loads(subprocess.check_output(['node','-e',script,json.dumps(a),json.dumps(times)],cwd=ROOT,text=True))
            for left,right in zip([animation.sample(a,t,2000,10) for t in times],actual):
                for key in left:self.assertAlmostEqual(left[key],right[key],places=8)
            p=self.project(a);flat.validate(p)
            result=preview_ass(dict(project=p,video=dict(width=640,height=360)))
            plan=dict(intervals=[dict(start_ms=0,end_ms=43200000,output_start_ms=0)])
            self.assertEqual(result['ass'],styled_ass(p,plan,'both',dict(width=640,height=360)))
            if mode=='custom':
                self.assertEqual(animation.boundaries(a,2000,10),[0,2000])
                self.assertEqual(animation.sample(a,50,2000,10)['revealed'],10)
            else:
                cuts=animation.boundaries(a,2000,10)
                for t in [200,600,1600,1800]:self.assertIn(t,cuts)
        for update in [dict(start=90,end=10),dict(start=0,end=10),dict(start=True,end=100)]:
            bad=copy.deepcopy(a);bad['effects']['fade'].update(update);self.assertFalse(animation.valid(bad))

    def project(self, motion):
        p=flat.migrate_project(dict(segments=[dict(id='a',start=1000,end=5000,text='ABCD')]))
        p['subtitles']['cues'][0]['content']['subtitle_animation']=motion
        return p

    def test_python_and_browser_clock_match(self):
        a=model(fade=dict(enabled=True),typewriter=dict(enabled=True),blink=dict(enabled=True),transform=dict(enabled=True,fromX=-50,toRotation=10))
        times=[0,100,300,400,599,600,750,1000,1800,2000]
        expected=[animation.sample(a,t,2000,10) for t in times]
        script="const a=require('./web/msw-subtitle-animation.js');const p=JSON.parse(process.argv[1]);console.log(JSON.stringify(p.times.map(t=>a.sample(p.a,t,2000,10))))"
        actual=json.loads(subprocess.check_output(['node','-e',script,json.dumps(dict(a=a,times=times))],cwd=ROOT,text=True))
        for left,right in zip(expected,actual):
            for key in left:self.assertAlmostEqual(left[key],right[key],places=8)

    def test_validation_and_style_preset_roundtrip(self):
        a=model(fade=dict(enabled=True));p=self.project(a);flat.validate(p)
        style=builtin_presets()[0];style['secondary']['animation']=a
        self.assertEqual(normalize_project_style(style)['secondary']['animation'],a)
        for field,value in [('in',101),('enabled',1),('unit','frames'),('extra',2)]:
            bad=copy.deepcopy(a);bad['effects']['fade'][field]=value
            self.assertFalse(animation.valid(bad));p['subtitles']['cues'][0]['content']['subtitle_animation']=bad
            with self.assertRaises(ValueError):flat.validate(p)

    def test_effect_inheritance_and_render_identity(self):
        p=self.project(dict(schema=animation.SCHEMA,effects={'fade':dict(animation.DEFINITIONS['fade'],enabled=False)}))
        style=builtin_presets()[0];style['main']['animation']=model(fade=dict(enabled=True),transform=dict(enabled=True))
        p['preview']=dict(project_style=style)
        row=layout(p)[0];self.assertFalse(row['motion']['effects']['fade']['enabled']);self.assertTrue(row['motion']['effects']['transform']['enabled'])
        result=preview_ass(dict(project=p,video=dict(width=640,height=360)))
        plan=dict(intervals=[dict(start_ms=0,end_ms=43200000,output_start_ms=0)])
        self.assertEqual(result['ass'],styled_ass(p,plan,'both',dict(width=640,height=360)))
        self.assertEqual(p,json.loads(json.dumps(p)))

    def test_clipping_and_gap_removal_continue_source_animation(self):
        p=self.project(model(typewriter=dict(enabled=True,end=100)))
        video=dict(width=640,height=360)
        full=dict(intervals=[dict(start_ms=0,end_ms=6000,output_start_ms=0)])
        clipped=styled_ass(p,full,'both',video,start_ms=3500,end_ms=4500)
        events=[line for line in clipped.splitlines() if line.startswith('Dialogue:')]
        self.assertTrue(events);self.assertIn('AB{\\alpha&HFF&',events[0])
        removed=dict(intervals=[dict(start_ms=0,end_ms=2000,output_start_ms=0),dict(start_ms=3500,end_ms=6000,output_start_ms=2000)])
        ass=styled_ass(p,removed,'both',video)
        after=[line for line in ass.splitlines() if line.startswith('Dialogue:') and ',0:00:02.00,' in line]
        self.assertTrue(after);self.assertIn('AB{\\alpha&HFF&',after[0])

    def test_typewriter_has_full_text_geometry_and_limits_pathological_effects(self):
        p=self.project(model(typewriter=dict(enabled=True,end=100)))
        before=layout(p)[0];p['subtitles']['cues'][0]['content'].pop('subtitle_animation');after=layout(p)[0]
        for key in ('x','y','width','height'):self.assertEqual(before[key],after[key])
        with self.assertRaisesRegex(ValueError,'过多'):
            animation.boundaries(model(blink=dict(enabled=True,period=80)),12*3600000,10)

    def test_inherited_legacy_animation_is_preserved_until_new_effects_are_used(self):
        p=self.project(model());p['subtitles']['cues'][0]['content'].pop('subtitle_animation')
        style=builtin_presets()[0];style['animations']['fad'].update(enabled=True,inMs=200,outMs=300);p['preview']=dict(project_style=style)
        args=dict(project=p,video=dict(width=640,height=360))
        self.assertIn('\\fad(200,300)',preview_ass(args)['ass'])
        p['subtitles']['cues'][0]['content']['subtitle_animation']=model()
        self.assertNotIn('\\fad(',preview_ass(args)['ass'])

    def test_keyframes_share_browser_evaluation_and_compile_all_boundaries(self):
        a=model(curves=dict(enabled=True,channels={
            'x':[dict(time=0,value=-80,easing='smooth'),dict(time=40,value=80,easing='hold'),dict(time=80,value=0,easing='linear')],
            'scale':[dict(time=0,value=80,easing='linear'),dict(time=100,value=120,easing='smooth')],
            'opacity':[dict(time=0,value=50,easing='linear')]}),fade=dict(enabled=True),transform=dict(enabled=True))
        times=[0,1,400,799,800,1000,1599,1600,2000]
        script="const A=require('./web/msw-subtitle-animation.js'),a=JSON.parse(process.argv[1]);console.log(JSON.stringify(JSON.parse(process.argv[2]).map(t=>A.sample(a,t,2000))))"
        actual=json.loads(subprocess.check_output(['node','-e',script,json.dumps(a),json.dumps(times)],cwd=ROOT,text=True))
        for left,right in zip([animation.sample(a,t,2000) for t in times],actual):
            for key in left:self.assertAlmostEqual(left[key],right[key],places=8)
        cuts=animation.boundaries(a,2000,4)
        self.assertIn(800,cuts);self.assertIn(1600,cuts);self.assertIn(40,cuts)
        p=self.project(a);flat.validate(p)
        self.assertIn('\\move(',preview_ass(dict(project=p,video=dict(width=640,height=360)))['ass'])
        for points in ([],[dict(time=0,value=0,easing='invalid')],[dict(time=0,value=True,easing='linear')],
                       [dict(time=0,value=0,easing='linear')]*2):
            bad=copy.deepcopy(a);bad['effects']['curves']['channels']['x']=points
            self.assertFalse(animation.valid(bad))
