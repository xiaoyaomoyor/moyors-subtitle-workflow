import json
import subprocess
import unittest
from copy import deepcopy
from pathlib import Path

from maw.msw import inline_markup as markup, flat_subtitles as flat, subtitle_animation as motion
from maw.msw.track_presentation import layout, fixed_ass
from maw.msw.subtitle_export import mapped_subtitles
from maw.project_subtitle_style import builtin_presets


class InlineMarkupTests(unittest.TestCase):
    def project(self, text='普通 **重点** //斜体// %%弱化%% __线__ ~~删~~ ++大++ --小--'):
        p=flat.migrate_project(dict(segments=[dict(id='a',start=0,end=3000,text=text,items=[])]))
        p['preview']=dict(inline_markup=True,project_style=builtin_presets()[0])
        return p

    def render(self,p):
        return fixed_ass(p,dict(intervals=[dict(start_ms=0,end_ms=3000,output_start_ms=0)]),'both',dict(width=1920,height=1080))

    def test_parser_matches_browser(self):
        examples=['**重点** //斜体// %%弱%%','**a //b// c**','孤** *a* ***三***','http://a https://b',
                  r'\**字\** **重点**',r'{\pos(1,2)}',r'C:\video\a','**__跨\n行__**','++👩‍💻++','** **']
        script="const m=require('./web/msw-inline-markup.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(x=>m.parse(x).runs))));"
        js=json.loads(subprocess.check_output(['node','-e',script],input=json.dumps(examples),text=True,encoding='utf-8',cwd=Path(__file__).resolve().parents[1]))
        self.assertEqual([markup.parse(s)['runs'] for s in examples],js)
        self.assertEqual(markup.plain(examples[0]),'重点 斜体 弱')

    def test_render_inherits_base_styles_and_leaves_source_untouched(self):
        p=self.project('//斜体//正常 **重点** %%弱化%%');before=deepcopy(p)
        p['preview']['project_style']['main']['underline']=True
        result=self.render(p)
        self.assertIn(r'\i1\u1',result);self.assertIn(r'\i0\u1',result)
        self.assertIn(r'\1c&H00aaff&',result);self.assertIn(r'\1c&H999999&',result)
        self.assertNotIn('//斜体//',result);self.assertNotIn('**重点**',result)
        self.assertEqual(p['subtitles'],before['subtitles'])
        p['preview']['inline_markup']=False
        self.assertIn('//斜体//正常 **重点** %%弱化%%',self.render(p))
        p['preview']['inline_markup']='yes'
        with self.assertRaisesRegex(ValueError,'句内样式'):flat.validate(p)

    def test_visible_wrapping_size_background_and_plain_exports(self):
        p=self.project('甲**乙丙**丁')
        p['preview']['project_style']['main'].update(wrapMode='characters',charsPerLine=2,backgroundShape='rounded')
        row=layout(p)[0]
        self.assertEqual(row['size']['text'],'甲乙\n丙丁')
        self.assertEqual(len(row['size']['inlineMarks']),5)
        normal=self.project('甲乙\n丙丁');normal['preview']['project_style']['main'].update(backgroundShape='rounded')
        self.assertGreater(row['size']['height'],layout(normal)[0]['size']['height'])
        plan=dict(intervals=[dict(start_ms=0,end_ms=3000,output_start_ms=0)])
        self.assertEqual(mapped_subtitles(p,plan,plain_text=True)[0][1][0]['text'],'甲乙丙丁')
        self.assertEqual(mapped_subtitles(p,plan)[0][1][0]['text'],'甲**乙丙**丁')

    def test_animation_gradient_and_safe_literal_text(self):
        p=self.project('甲 //乙// **丙** {\\pos(1,2)}')
        style=p['preview']['project_style']['main'];style.update(gradientMode='characters',outlineOpacity=25,shadowOpacity=50)
        animation=motion.normalize(dict(schema=motion.SCHEMA,effects={key:{**motion.DEFINITIONS[key],'enabled':True} for key in ('typewriter','wave')}))
        p['subtitles']['cues'][0]['content']['subtitle_animation']=animation
        result=self.render(p)
        self.assertIn(r'\i1',result);self.assertIn(r'\i0',result)
        self.assertIn(r'\1c&H00aaff&',result)
        self.assertNotIn('**',result);self.assertNotIn('//',result)
        self.assertTrue(r'\{\\pos(1,2)\}' in self.render(self.project(r'{\pos(1,2)}')))
        self.assertIn(r'\3a&H',result)


if __name__=='__main__':unittest.main()
