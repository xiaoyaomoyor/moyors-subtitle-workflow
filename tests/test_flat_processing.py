import copy
import unittest

from maw.msw import flat_subtitles as flat, jobs, asr, tts
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.msw.track_presentation import layout
from maw.project_subtitle_style import builtin_presets


def project():
    p = flat.migrate_project({'segments': [dict(id='a', start=0, end=1000, text='Hello')]})
    p['subtitles'].pop('migration', None)
    p = flat.add_track(p, {**copy.deepcopy(p['subtitles']['tracks'][0]), 'id': 'translation', 'name': 'Translation'})
    return p


def snapshot(p):
    return dict(project_id='project-test', project_schema=flat.SCHEMA, flat_model=p['subtitles'], subtitle_track_id='translation')


class FlatProcessingTests(unittest.TestCase):
    def test_track_group_order_ignores_binding_direction_and_preview_columns(self):
        p = flat.migrate_project({'segments': [dict(id='a', start=1000, end=2000, text='Source')],
            'multi_subtitle': {'enabled': True, 'tracks': [dict(id='zh', segments=[dict(id='z', start=1100, end=2100, text='Translation')])],
                              'bindings': [dict(id='b', track_id='zh', main_segment_ids=['a'], extension_segment_ids=['z'])]}})
        main, secondary = p['subtitles']['tracks']
        secondary['secondary_for'] = main['id']
        flat.normalize_groups(p)
        self.assertEqual(secondary['secondary_for'], main['id'])
        main['style'].update(mode='snapshot', value=copy.deepcopy(builtin_presets()[0]))
        secondary['style'].update(mode='snapshot', value=copy.deepcopy(builtin_presets()[0]))
        source, translation = p['subtitles']['cues']
        for order in ('secondary-above', 'main-above'):
            main['style']['value']['pairLayout'] = dict(order=order, gap=-12)
            expected = {r['cue_id']: (r['x'], r['y'], r['style']) for r in layout(p)}
            self.assertEqual(expected[translation['id']][1] < expected[source['id']][1], order == 'secondary-above')
            for reverse in (False, True):
                for right in (source['id'], translation['id']):
                    candidate = copy.deepcopy(p)
                    if reverse:
                        b = candidate['subtitles']['bindings'][0]
                        b['source_id'], b['target_id'] = b['target_id'], b['source_id']
                        b['start_offset_ms'] *= -1
                        b['end_offset_ms'] *= -1
                    candidate['subtitle_view'] = dict(secondary_cue_ids=[right])
                    before = copy.deepcopy(candidate)
                    self.assertEqual({r['cue_id']: (r['x'], r['y'], r['style']) for r in layout(candidate)}, expected)
                    payload = dict(project=candidate, target='both', video=dict(width=1920, height=1080))
                    preview = preview_ass(payload)
                    plan = dict(intervals=[dict(start_ms=0, end_ms=3000, output_start_ms=0)])
                    self.assertEqual(preview['ass'], styled_ass(candidate, plan, 'both', payload['video']))
                    self.assertEqual(candidate, before)

    def test_translation_and_tts_capture_native_ids(self):
        p = project()
        c = p['subtitles']['cues'][0]
        raw = {**snapshot(p), 'entries': [dict(source={'id': c['id'], **c['content']}, target=None, binding_id=None)]}
        out = jobs.validate_snapshot(raw)
        self.assertEqual(out['project_schema'], flat.SCHEMA)
        self.assertEqual(out['flat_model'], p['subtitles'])
        entry = dict(key='tts-key', id=c['id'], track_id=c['track_id'], **c['content'])
        voice = tts.validate_snapshot({**snapshot(p), 'entries': [entry]})
        self.assertEqual(voice['entries'][0]['subtitle_cue_id'], c['id'])
        self.assertEqual(voice['project_schema'], flat.SCHEMA)
        for bad in [dict(entry, text='changed'), dict(entry, track_id='translation')]:
            with self.assertRaisesRegex(ValueError, '不一致'):
                tts.validate_snapshot({**snapshot(p), 'entries': [bad]})

    def test_asr_target_guard_and_native_model_are_validated(self):
        p = project()
        raw = {**snapshot(p), 'mode': 'whole', 'range': dict(start=0, end=1000), 'targets': [],
               'source': dict(id='media-test', revision='a'*64, duration_ms=1000, audio_index=0)}
        clean = asr.validate_snapshot(raw)
        self.assertEqual(clean['flat_model'], p['subtitles'])
        with self.assertRaisesRegex(ValueError, '不一致'):
            asr.validate_snapshot({**raw, 'targets': [dict(id='bad', start=0, end=1000, text='wrong')]})
        bad = copy.deepcopy(raw)
        bad['flat_model']['tracks'][1]['locked'] = True
        with self.assertRaisesRegex(ValueError, '锁定'):
            asr.validate_snapshot(bad)

    def test_native_renderer_includes_every_enabled_track_and_keeps_independent_styles(self):
        p = project()
        style = builtin_presets()[0]
        p['subtitles']['tracks'][1]['style'] = dict(mode='snapshot', slot='secondary', base='dialogue', value=style)
        p['subtitles']['cues'].append(dict(id='zh', track_id='translation', content=dict(start=0, end=1000, text='译文')))
        annotation = {**copy.deepcopy(p['subtitles']['tracks'][0]), 'id': 'note', 'name': 'Note', 'layout': 'fixed', 'position': dict(x=.2, y=.1)}
        p = flat.add_track(p, annotation)
        p['subtitles']['cues'].append(dict(id='note-cue', track_id='note', content=dict(start=0, end=1000, text='ANNOTATION')))
        before = copy.deepcopy(p)
        payload = dict(project=p, video=dict(width=1920, height=1080))
        result = preview_ass(payload)
        for text in ('Hello', '译文', 'ANNOTATION'):
            self.assertIn(text, result['ass'])
        self.assertEqual(len(result['geometry']), 3)
        for i, row in enumerate(result['geometry']):
            self.assertEqual(row['style'], f'cue-{i}')
            self.assertIn(f'Style: cue-{i},', result['ass'])
            self.assertEqual((row['start'], row['end']), (0, 1000))
            self.assertTrue(row['visible'])
        secondary = preview_ass(dict(payload, target='secondary'))
        self.assertEqual([r['text'] for r in secondary['geometry'] if r['visible']], ['译文'])
        plan = dict(intervals=[dict(start_ms=0, end_ms=43200000, output_start_ms=0)])
        self.assertEqual(result['ass'], styled_ass(p, plan, 'both', payload['video']))
        self.assertEqual(p, before)
        p['subtitles']['tracks'][1]['enabled'] = False
        self.assertNotIn('译文', preview_ass(dict(payload, project=p))['ass'])

    def test_bound_auto_tracks_group_but_fixed_annotations_keep_their_anchor(self):
        p = project()
        p['subtitles']['cues'].append(dict(id='zh', track_id='translation', content=dict(start=0, end=1000, text='译文')))
        p = flat.bind(p, p['subtitles']['cues'][0]['id'], 'zh', 'binding')
        rows = layout(p)
        self.assertEqual(rows[0]['groupId'], rows[1]['groupId'])
        self.assertNotEqual(rows[0]['y'], rows[1]['y'])
        p['subtitles']['tracks'][1].update(layout='fixed', position=dict(x=.5, y=.1))
        rows = layout(p)
        self.assertNotEqual(rows[0]['groupId'], rows[1]['groupId'])
        self.assertAlmostEqual(rows[1]['y'], 108)
        p['subtitles']['tracks'][0].update(layout='fixed', position=dict(x=.5, y=.1))
        rows = layout(p)
        self.assertEqual(rows[0]['groupId'], rows[1]['groupId'])
        self.assertNotEqual(rows[0]['y'], rows[1]['y'])

    def test_video_audio_plan_uses_native_visibility_and_does_not_downgrade(self):
        from maw.msw.audio_plan import compile_plan
        from maw.msw.subtitle_export import burning_cues
        p = project()
        p['subtitles']['cues'].append(dict(id='later', track_id='translation', content=dict(start=2000, end=3000, text='last')))
        before = copy.deepcopy(p)
        plan = compile_plan(p)
        self.assertEqual(plan['source_end_ms'], 3000)
        self.assertEqual([c['text'] for c in burning_cues(p, plan, 'both')], ['Hello', 'last'])
        p['subtitles']['tracks'][1]['enabled'] = False
        self.assertEqual(compile_plan(p)['source_end_ms'], 1000)
        p['subtitles']['tracks'][1]['enabled'] = True
        self.assertEqual(p, before)


if __name__ == '__main__':
    unittest.main()
