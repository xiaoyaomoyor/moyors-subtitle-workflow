import copy
import unittest

from maw.msw.flat_subtitles import migrate_project, normalize_groups, validate
from maw.msw.track_presentation import layout
from maw.project_subtitle_style import builtin_presets, normalize_project_style


class PairMarginTests(unittest.TestCase):
    def test_manual_margin_preserves_partner_and_other_group(self):
        for order in ('main-above', 'secondary-above'):
            for slot in ('main', 'secondary'):
                with self.subTest(order=order, slot=slot):
                    p = migrate_project(dict(segments=[dict(id='a', start=0, end=3000, text='a')],
                        multi_subtitle=dict(enabled=True, tracks=[dict(id='zh', segments=[dict(id='b', start=0, end=3000, text='b')])],
                            bindings=[dict(track_id='zh', main_segment_ids=['a'], extension_segment_ids=['b'])])))
                    m, s = p['subtitles']['tracks']
                    s['secondary_for'] = m['id']
                    style = builtin_presets()[0]
                    style['pairLayout'] = dict(order=order, gap=12)
                    for t in (m, s):
                        t['style'].update(mode='snapshot', value=copy.deepcopy(style))
                    p['subtitles']['tracks'] += [dict(copy.deepcopy(m), id='m2'), dict(copy.deepcopy(s), id='s2', secondary_for='m2')]
                    p['subtitles']['cues'] += [dict(id='a2', track_id='m2', content=dict(start=0, end=3000, text='a2')),
                        dict(id='b2', track_id='s2', content=dict(start=0, end=3000, text='b2'))]
                    p['subtitles']['bindings'].append(dict(id='pair2', source_id='b2', target_id='a2', start_offset_ms=0, end_offset_ms=0))
                    normalize_groups(p)
                    before = {r['cue']['text']: r['y'] for r in layout(p)}
                    style['pairLayout']['marginBase'] = {r: style[r]['marginV'] for r in ('main', 'secondary')}
                    style[slot]['marginV'] -= 20
                    for t in p['subtitles']['tracks'][2:]:
                        t['style']['value'] = normalize_project_style(style)
                    validate(p)
                    after = {r['cue']['text']: r['y'] for r in layout(p)}
                    for key in before:
                        self.assertAlmostEqual(after[key]-before[key], 20 if key==('a2' if slot=='main' else 'b2') else 0)
                    # Explicit cue anchors still take precedence over the track.
                    cue = next(c for c in p['subtitles']['cues'] if c['id']==('a2' if slot=='main' else 'b2'))
                    cue['content']['subtitle_position'] = dict(x=.5, y=.5, alignment=2)
                    anchored = next(r for r in layout(p) if r['cue']['text']==cue['content']['text'])
                    self.assertAlmostEqual(anchored['y']+anchored['height'], 540)

    def test_margin_base_validation_and_roundtrip(self):
        style = builtin_presets()[0]
        for bad in (None, {}, {'main':0,'secondary':True}, {'main':-1,'secondary':0}, {'main':0,'secondary':float('nan')}, {'main':0,'secondary':0,'other':1}):
            style['pairLayout']['marginBase'] = bad
            with self.assertRaises(ValueError):
                normalize_project_style(style)
        style['pairLayout']['marginBase'] = dict(main=96, secondary=48)
        self.assertEqual(normalize_project_style(style)['pairLayout']['marginBase'], dict(main=96, secondary=48))
