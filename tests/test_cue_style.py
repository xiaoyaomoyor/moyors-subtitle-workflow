import copy
import json
import unittest

import test_selected_position as position_tests
from maw.msw import flat_subtitles as flat
from maw.msw import cue_style
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.msw.track_presentation import layout
from maw.speaker import COLOR_PALETTE


class CueStyleTests(unittest.TestCase):
    def test_multiline_alignment_preserves_geometry_and_matches_export(self):
        from maw.project_subtitle_style import normalize_project_style, builtin_presets
        from maw.msw import subtitle_animation as animation
        p = position_tests.SelectedPositionTests().pair()
        cue = p['subtitles']['cues'][0]['content']
        cue['text'] = 'MMMMMMMMMM\nMM'
        cue['subtitle_position'] = dict(x=.4, y=.6, alignment=2)
        cue['subtitle_style'] = dict(backgroundShape='rounded', backgroundRadius=12)
        geometry = layout(p)[0]
        before = copy.deepcopy(p)
        for align, tag in [('left', r'\an1'), ('center', r'\an2'), ('right', r'\an3')]:
            for animated in (False, True):
                cue['subtitle_style']['textAlign'] = align
                if animated:
                    cue['subtitle_animation'] = animation.normalize(dict(schema=animation.SCHEMA, effects={'transform':dict(animation.DEFINITIONS['transform'],enabled=True,fromScale=100,toScale=150)}))
                else:
                    cue.pop('subtitle_animation', None)
                flat.validate(p)
                row = layout(p)[0]
                for field in ('x','y','width','height'):
                    self.assertEqual(row[field],geometry[field])
                self.assertEqual(cue['subtitle_position'],before['subtitles']['cues'][0]['content']['subtitle_position'])
                video = dict(width=1920,height=1080)
                ass = preview_ass(dict(project=p,video=video))['ass']
                self.assertIn(tag,ass)
                plan = dict(intervals=[dict(start_ms=0,end_ms=43200000,output_start_ms=0)])
                self.assertEqual(styled_ass(p,plan,'both',video),ass)
                style = builtin_presets()[0];style['main']['textAlign']=align
                self.assertEqual(normalize_project_style(style)['main']['textAlign'],align)

    def test_partial_override_measured_and_rendered_without_touching_partner(self):
        p = position_tests.SelectedPositionTests().pair()
        before = copy.deepcopy(p)
        content = p['subtitles']['cues'][0]['content']
        content['subtitle_style'] = dict(fontSize=80, primaryColor='#12ab34', wrapMode='characters', charsPerLine=4)
        content['subtitle_style_preset'] = 'saved-preset'
        content['color'] = dict(name=COLOR_PALETTE[0][0])
        content['subtitle_position'] = dict(x=.3, y=.7, alignment=2)
        flat.validate(p)
        rows = layout(p)
        a = next(r for r in rows if r['cue_id'] == p['subtitles']['cues'][0]['id'])
        self.assertEqual(a['style']['fontSize'],80)
        self.assertEqual(a['style']['primaryColor'],'#12ab34')
        self.assertIn('\n', a['size']['text'])
        self.assertEqual(p['subtitles']['cues'][1],before['subtitles']['cues'][1])
        self.assertEqual(p['subtitles']['bindings'],before['subtitles']['bindings'])
        video=dict(width=1920,height=1080)
        ass=preview_ass(dict(project=p,video=video))['ass']
        self.assertIn(',80,',ass)
        self.assertIn('34AB12',ass.upper())
        plan=dict(intervals=[dict(start_ms=0,end_ms=43200000,output_start_ms=0)])
        self.assertEqual(styled_ass(p,plan,'both',video),ass)
        reloaded=json.loads(json.dumps(p));flat.validate(reloaded)
        self.assertEqual(layout(reloaded),layout(p))
        without=copy.deepcopy(p);del without['subtitles']['cues'][0]['content']['subtitle_style']['primaryColor']
        self.assertNotEqual(preview_ass(dict(project=without,video=video))['ass'],ass)

    def test_contract_rejects_bad_overrides(self):
        for value in (None, [], dict(fontSize=True), dict(fontSize=513), dict(charsPerLine=1.5),
                      dict(primaryColor='red'), dict(fontName='bad\nStyle:evil'), dict(alignment=8), dict(animations={}),
                      dict(textAlign='justify'), dict(textAlign=None)):
            with self.subTest(value=value):
                self.assertFalse(cue_style.valid(value))
                p=position_tests.SelectedPositionTests().pair();p['subtitles']['cues'][0]['content']['subtitle_style']=value
                with self.assertRaises(ValueError):flat.validate(p)
