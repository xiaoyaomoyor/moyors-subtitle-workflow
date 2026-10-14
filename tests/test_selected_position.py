import copy
import unittest

from test_flat_processing import project
from maw.msw import flat_subtitles as flat
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.msw.track_presentation import layout, position_anchor


class SelectedPositionTests(unittest.TestCase):
    def pair(self):
        p = project()
        p['subtitles']['tracks'][1]['style']['slot'] = 'secondary'
        p['subtitles']['cues'].append(dict(id='zh', track_id='translation', content=dict(start=0, end=1000, text='Translation')))
        return flat.bind(p, p['subtitles']['cues'][0]['id'], 'zh', 'pair')

    def test_single_override_keeps_unselected_partner_and_binding(self):
        p = self.pair()
        before = layout(p)
        a = position_anchor(before[0], 1920)
        p['subtitles']['cues'][0]['content']['subtitle_position'] = dict(a, x=a['x']-.2, y=a['y']-.3)
        after = layout(p)
        self.assertAlmostEqual(after[0]['x']-before[0]['x'], -384)
        self.assertAlmostEqual(after[0]['y']-before[0]['y'], -324)
        self.assertEqual(position_anchor(after[1],1920),position_anchor(before[1],1920))
        self.assertEqual(len(p['subtitles']['bindings']),1)
        del p['subtitles']['cues'][0]['content']['subtitle_position']
        self.assertEqual(layout(p),before)

    def test_anchored_roundtrip_keeps_ass_exactly_without_top_anchor_jump(self):
        for alignment in range(1,10):
            with self.subTest(alignment=alignment):
                p=self.pair()
                from maw.project_subtitle_style import builtin_presets
                style=builtin_presets()[0]
                style['main']['alignment']=style['secondary']['alignment']=alignment
                p['preview']={'project_style':style}
                payload=dict(project=p,video=dict(width=1920,height=1080))
                original=preview_ass(payload)
                rows={r['cue_id']:r for r in layout(p)}
                for cue in p['subtitles']['cues']:
                    cue['content']['subtitle_position']=position_anchor(rows[cue['id']],1920)
                flat.validate(p)
                self.assertEqual(preview_ass(payload)['ass'],original['ass'])
                plan=dict(intervals=[dict(start_ms=0,end_ms=43200000,output_start_ms=0)])
                self.assertEqual(styled_ass(p,plan,'both',payload['video']),original['ass'])

    def test_anchor_contract_rejects_invalid_values_and_track_extension(self):
        p=self.pair()
        for bad in [True,0,10,2.5,'2',None]:
            with self.subTest(bad=bad):
                n=copy.deepcopy(p);n['subtitles']['cues'][0]['content']['subtitle_position']=dict(x=.5,y=.5,alignment=bad)
                with self.assertRaises(ValueError):flat.validate(n)
        n=copy.deepcopy(p);n['subtitles']['tracks'][0]['position']=dict(x=.5,y=.5,alignment=2)
        with self.assertRaises(ValueError):flat.validate(n)

    def test_legacy_top_positions_still_render_at_their_original_anchor(self):
        p=self.pair()
        for cue in p['subtitles']['cues']:cue['content']['subtitle_position']=dict(x=.3,y=.2)
        rows=layout(p)
        self.assertEqual(rows[0]['y'],216)
        self.assertIsNone(rows[0]['anchor'])
        self.assertEqual(rows[0]['groupId'],rows[1]['groupId'])
        original=position_anchor(rows[1],1920)
        anchor=position_anchor(rows[0],1920)
        p['subtitles']['cues'][0]['content']['subtitle_position']=dict(anchor,x=.6,base=dict(x=.3,y=.2))
        flat.validate(p)
        self.assertEqual(position_anchor(layout(p)[1],1920),original)
        for bad in [None,True,dict(x=True,y=.2),dict(x=.3,y=.2,alignment=2)]:
            p['subtitles']['cues'][0]['content']['subtitle_position']['base']=bad
            with self.assertRaises(ValueError):flat.validate(p)
