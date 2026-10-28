import copy
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from maw.msw import subtitle_animation as animation
from maw.msw.subtitle_style import styled_ass
from maw.msw.subtitle_preview import preview_ass
from maw.project_subtitle_style import builtin_presets
from test_subtitle_animation import model
import test_subtitle_animation as fixtures

ROOT = Path(__file__).resolve().parents[1]


class SubtitleWaveTests(unittest.TestCase):
    def test_opaque_ass_box_stays_whole_while_letters_wave(self):
        folder = os.environ.get('MSW_TEST_FFMPEG','')
        ffmpeg = str(Path(folder)/'ffmpeg.exe') if folder else shutil.which('ffmpeg')
        if not ffmpeg or not Path(ffmpeg).is_file():
            self.skipTest('FFmpeg unavailable')
        from PIL import Image
        a = model(wave=dict(enabled=True,amplitude=48))
        p = fixtures.SubtitleAnimationTests().project(a)
        p['subtitles']['cues'][0]['content'].update(text='WAVE WAVE',start=0,end=2000,
            subtitle_style=dict(fontName='Arial',fontSize=96,primaryColor='#ff0000',outlineColor='#00ff00',borderStyle=3,outline=8,shadow=0))
        bounds=[]
        with tempfile.TemporaryDirectory() as temporary:
            for i, enabled in enumerate((False,True)):
                p['subtitles']['cues'][0]['content']['subtitle_animation']['effects']['wave']['enabled']=enabled
                ass=styled_ass(p,dict(intervals=[dict(start_ms=0,end_ms=2000,output_start_ms=0)]),'both',dict(width=640,height=360))
                Path(temporary,'caption.ass').write_text(ass,encoding='utf-8')
                image=Path(temporary,f'{i}.png')
                subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=2',
                                '-vf','ass=caption.ass','-ss','0.4','-frames:v','1',str(image)],cwd=temporary,check=True,capture_output=True)
                with Image.open(image) as im:
                    im=im.convert('RGB')
                    points=[(x,y) for y in range(im.height) for x in range(im.width) if (lambda c:c[1]>100 and c[1]>2*c[0] and c[1]>2*c[2])(im.getpixel((x,y)))]
                    bounds.append([min(x for x,y in points),max(x for x,y in points),min(y for x,y in points),max(y for x,y in points)])
        self.assertEqual(bounds[0],bounds[1])

    def test_contract_phase_and_anchored_timing_match_browser(self):
        a = model(wave=dict(enabled=True,unit='ms',start=100,end=200,endAnchor='end',period=1000,periodUnit='ms'))
        saved = copy.deepcopy(a)
        cases = [[d,t,i] for d in (200,1500,7000) for t in (0,100,150,300,600,1200,6900) for i in (0,1,4,8)]
        script = "const A=require('./web/msw-subtitle-animation.js'),a=JSON.parse(process.argv[1]);console.log(JSON.stringify(JSON.parse(process.argv[2]).map(([d,t,i])=>A.waveOffset(a.effects.wave,t,d,i))))"
        values = json.loads(subprocess.check_output(['node','-e',script,json.dumps(a),json.dumps(cases)],cwd=ROOT,text=True))
        for (duration,elapsed,index), value in zip(cases, values):
            self.assertAlmostEqual(animation.wave_offset(a['effects']['wave'],elapsed,duration,index),value,places=8)
        self.assertEqual(a,saved)
        for key, value in [('amplitude',121),('amplitude',-1),('wavelength',0),('period',199),('direction','up')]:
            bad = copy.deepcopy(a)
            bad['effects']['wave'][key] = value
            self.assertFalse(animation.valid(bad))

    def test_masks_preserve_spaces_newlines_fonts_and_graphemes(self):
        a = model(wave=dict(enabled=True))
        text = 'A e\u0301\n中👨\u200d👩\u200d👧'
        style = builtin_presets()[0]['main']
        events = list(animation.fragments(a,text,style,2000,400,440,960,900,2))
        self.assertEqual(len(events),4)
        for _,_,tags,body in events:
            plain = re.sub(r'\{[^}]*\}', '', body)
            self.assertEqual(plain, text.replace('\n',r'\N'))
            self.assertIn(r'\move(', tags)
            self.assertEqual(body.count(r'\alpha&HFF&'),4)
        # Both lines restart the wave phase; same first-character displacement.
        self.assertEqual(events[0][2],events[2][2])
        self.assertEqual(events[1][2],events[3][2])
        zero = copy.deepcopy(a)
        zero['effects']['wave']['amplitude'] = 0
        self.assertEqual(len(list(animation.fragments(zero,text,style,2000,400,440,960,900,2))),1)

    def test_typewriter_gradient_background_and_custom_compose(self):
        a = model(wave=dict(enabled=True),typewriter=dict(enabled=True,end=100,custom=True),
                  curves=dict(enabled=True,channels={'opacity':[dict(time=0,value=50,easing='linear')]}))
        a['mode'] = 'custom'
        style = {**builtin_presets()[0]['main'], 'gradientMode':'characters','gradientStart':'#ff0000','gradientEnd':'#00ff00'}
        events = list(animation.fragments(a,'ABCD',style,2000,1000,1040,960,900,2))
        self.assertEqual(len(events),2)
        self.assertIn(r'\alpha&H80&',events[0][3])
        self.assertIn(r'\1c&H0000ff&',events[0][3])
        self.assertIn(r'\1c&H00ff00&',events[0][3])
        bg = list(animation.fragments(a,'ABCD',style,2000,1000,1040,960,900,7,drawing='m 0 0 l 10 10'))
        self.assertEqual(len(bg),1)
        self.assertIn(r'\pos(960,900)',bg[0][2])
        self.assertTrue(a['effects']['wave']['enabled'])

    def test_preview_export_clipped_clock_and_complexity_limit(self):
        a = model(wave=dict(enabled=True))
        p = fixtures.SubtitleAnimationTests().project(a)
        video = dict(width=640,height=360)
        plan = dict(intervals=[dict(start_ms=0,end_ms=6000,output_start_ms=0)])
        self.assertEqual(preview_ass(dict(project=p,video=video))['ass'],styled_ass(p,plan,'both',video))
        full = styled_ass(p,plan,'both',video)
        trim = styled_ass(p,plan,'both',video,start_ms=1520,end_ms=2000)
        whole = next(line.split(',,',1)[1] for line in full.splitlines() if line.startswith('Dialogue:') and line.split(',')[1]=='0:00:01.52')
        part = next(line.split(',,',1)[1] for line in trim.splitlines() if line.startswith('Dialogue:'))
        self.assertEqual(whole,part)
        style = builtin_presets()[0]['main']
        with self.assertRaisesRegex(ValueError,'波动生成片段过多'):
            list(animation.fragments(a,'x'*129,style,2000,0,2000,960,900,2))
        # Typical sentence: bounded output, no full-project processing needed.
        start = time.perf_counter()
        events = list(animation.fragments(a,'Wave text with spaces and words',style,3000,0,3000,960,900,2))
        self.assertLess(len(events),3000)
        self.assertLess(time.perf_counter()-start,3)


if __name__ == '__main__':
    unittest.main()
