import copy
import unittest

from maw.msw.flat_subtitles import migrate_project, validate
from maw.msw.speaker_palette import validate as validate_palette
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.msw.track_presentation import layout
from maw.msw import subtitle_animation as animation
from maw.speaker import apply_speaker_colors, inherit_speaker_color


class SpeakerPaletteTests(unittest.TestCase):
    def test_localized_names_follow_physical_track_in_preview_and_export(self):
        from maw.msw.speaker_palette import display_name
        p = self.project()
        row = p['preview']['speaker_palette']['rows'][0]
        row.update(name='Erwyn', names={'en': 'Erwyn', 'zh-hans': '艾尔文', 'zh-hant': '艾爾文'}, mode='speaker')
        a = p['subtitles']['tracks'][0]
        a['language'] = 'en-US'
        b = copy.deepcopy(a)
        b.update(id='chinese', language='zh', display_number=2)
        p['subtitles']['tracks'].append(b)
        cue = copy.deepcopy(p['subtitles']['cues'][0])
        cue.update(id='translated', track_id=b['id'])
        cue['content']['text'] = '你好'
        p['subtitles']['cues'].append(cue)
        source_id = p['subtitles']['cues'][0]['id']
        p['subtitles']['bindings'] = [dict(id='bound', source_id=source_id, target_id=cue['id'], start_offset_ms=0, end_offset_ms=0)]
        video = dict(width=640, height=360)
        plan = dict(intervals=[dict(start_ms=0, end_ms=2000, output_start_ms=0)])
        before = copy.deepcopy(p)
        expected = {source_id: 'Erwyn / ', cue['id']: '艾尔文 / '}
        self.assertEqual({r['cue_id']: r['prefix'] for r in layout(p)}, expected)
        preview = preview_ass(dict(project=p, video=video))['ass']
        self.assertEqual(preview, styled_ass(p, plan, 'both', video))
        self.assertIn('艾尔文 / ', preview)
        self.assertIn('Erwyn / ', preview)
        self.assertEqual(p, before)
        p['subtitles']['cues'][0]['track_id'], cue['track_id'] = b['id'], a['id']
        self.assertEqual({r['cue_id']: r['prefix'] for r in layout(p)}, {source_id: '艾尔文 / ', cue['id']: 'Erwyn / '})
        self.assertEqual(display_name(row, 'zh-TW'), '艾爾文')
        self.assertEqual(display_name(row, 'de'), 'Erwyn')
        p['preview']['speaker_label_export'] = False
        self.assertNotIn('艾尔文 / ', styled_ass(p, plan, 'both', video))

    def test_names_validation_and_legacy_language_migration(self):
        for names in [[], {'en': ''}, {'zh': '非规范语言'}, {'en': 'bad\n'}, {'en': 1}, {'bad_key': 'name'}]:
            p = self.project()
            p['preview']['speaker_palette']['rows'][0]['names'] = names
            with self.assertRaises(ValueError):
                validate(p)
        p = migrate_project({'language': 'en', 'segments': [dict(start=0, end=1000, text='Hi')]})
        self.assertEqual(p['subtitles']['tracks'][0]['language'], 'en')
        p['subtitles']['tracks'][0]['language'] = []
        with self.assertRaises(ValueError):
            validate(p)

    def test_track_changes_yield_to_speaker_defaults_and_manual_cue_style(self):
        from maw.project_subtitle_style import builtin_presets
        project = self.project()
        speaker = project['preview']['speaker_palette']['rows'][0]
        speaker.update(mode='stroke', color='#66bb6a', style={'fontSize': 72})
        cue = project['subtitles']['cues'][0]['content']
        for size, color in [(40, '#ff0000'), (90, '#0000ff')]:
            style = builtin_presets()[0]
            style['main'].update(fontSize=size, outlineColor=color)
            track = project['subtitles']['tracks'][0]
            track['style'].update(mode='snapshot', value=style)
            inherited = layout(project)[0]['style']
            self.assertEqual((inherited['fontSize'], inherited['outlineColor']), (72, '#66bb6a'))
            cue['subtitle_style'] = {'fontSize': 55, 'outlineColor': '#abcdef'}
            manual = layout(project)[0]['style']
            self.assertEqual((manual['fontSize'], manual['outlineColor']), (55, '#abcdef'))
            video = dict(width=640, height=360)
            plan = dict(intervals=[dict(start_ms=0, end_ms=2000, output_start_ms=0)])
            self.assertEqual(preview_ass(dict(project=project, video=video))['ass'], styled_ass(project, plan, 'both', video))
            del cue['subtitle_style']

    def project(self):
        project = migrate_project({'segments': [dict(id='a', start=0, end=2000, text='Text', color={'name': 'speaker-9', 'start': 0, 'end': 2000})]})
        project['preview'] = {'speaker_palette': {'version': 1, 'rows': [dict(id='speaker-9', name='Alice', color='#123456', mode='none', separator=' / ')]}}
        return project

    def test_modes_and_names_share_preview_export_and_respect_cue_override(self):
        video = dict(width=640, height=360)
        plan = dict(intervals=[dict(start_ms=0, end_ms=2000, output_start_ms=0)])
        for mode in ['none', 'text', 'stroke', 'background', 'speaker']:
            with self.subTest(mode=mode):
                project=self.project();project['preview']['speaker_palette']['rows'][0]['mode']=mode
                before=copy.deepcopy(project)
                result=preview_ass(dict(project=project,video=video))
                self.assertEqual(project,before)
                self.assertEqual(result['ass'],styled_ass(project,plan,'both',video))
                if mode=='none':self.assertNotIn('563412',result['ass'])
                else:self.assertIn('563412',result['ass'])
                self.assertEqual('Alice / ' in result['ass'],mode=='speaker')
                if mode=='background':self.assertIn(r'\p1',result['ass'])
                project['preview']['speaker_label_export']=False
                self.assertNotIn('Alice / ',preview_ass(dict(project=project,video=video))['ass'])
                project['preview']['speaker_label_export']=True
                self.assertIn('Alice / ',preview_ass(dict(project=project,video=video))['ass'])
        project=self.project();project['preview']['speaker_palette']['rows'][0]['mode']='text'
        project['subtitles']['cues'][0]['content']['subtitle_style']={'primaryColor':'#abcdef'}
        self.assertIn('EFCDAB',preview_ass(dict(project=project,video=video))['ass'])

    def test_new_speakers_do_not_share_identity_after_five_and_translation_keeps_it(self):
        cues=[dict(start=i*1000,end=i*1000+900,text='Text',speaker=str(i)) for i in range(12)]
        report=apply_speaker_colors(cues)
        self.assertFalse(report['overflow'])
        self.assertEqual(len({c['color']['name'] for c in cues}),12)
        target=dict(start=0,end=900,text='译文');inherit_speaker_color(cues[8],target)
        self.assertEqual(target['color']['name'],'speaker-9')

    def test_validation_rejects_duplicate_ids_invalid_modes_and_unsafe_names(self):
        for patch in [{'name':''},{'name':'a\n'},{'color':'red'},{'mode':'unknown'},{'separator':'\t'}]:
            p=self.project();p['preview']['speaker_palette']['rows'][0].update(patch)
            with self.assertRaises(ValueError):validate(p)
        palette=self.project()['preview']['speaker_palette'];palette['rows']*=2
        with self.assertRaises(ValueError):validate_palette(palette)

    def test_asr_color_above_five_renders_before_editor_creates_table(self):
        p=self.project();del p['preview']['speaker_palette']
        p['subtitles']['cues'][0]['content']['color']['value']='#123456'
        self.assertIn('563412',preview_ass(dict(project=p,video=dict(width=640,height=360)))['ass'])

    def test_speaker_style_and_animation_apply_across_tracks_and_survive_roundtrip(self):
        import json
        p=self.project();row=p['preview']['speaker_palette']['rows'][0]
        row['style']={'fontSize':72,'primaryColor':'#abcdef','latinFontName':'Arial'}
        row['animation']={'schema':animation.SCHEMA,'effects':{'fade':{**animation.DEFINITIONS['fade'],'enabled':True}}}
        track=copy.deepcopy(p['subtitles']['tracks'][0]);track['id']='extra';track['display_number']=2
        p['subtitles']['tracks'].append(track)
        cue=copy.deepcopy(p['subtitles']['cues'][0]);cue.update(id='b',track_id='extra')
        cue['content']['subtitle_style']={'fontSize':55};p['subtitles']['cues'].append(cue)
        p=json.loads(json.dumps(p));validate(p)
        entries=layout(p)
        self.assertEqual(sorted(r['style']['fontSize'] for r in entries),[55,72])
        self.assertTrue(all(r['style']['primaryColor']=='#abcdef' and r['motion']['effects']['fade']['enabled'] for r in entries))
        video=dict(width=640,height=360);plan=dict(intervals=[dict(start_ms=0,end_ms=2000,output_start_ms=0)])
        self.assertEqual(preview_ass(dict(project=p,video=video,plan=plan))['ass'],styled_ass(p,plan,'both',video))
        self.assertIn('Arial',preview_ass(dict(project=p,video=video))['ass'])
        p['preview']['speaker_labels_visible']=True
        self.assertIn('Alice / ',preview_ass(dict(project=p,video=video))['ass'])
        p['preview']['speaker_label_export']=False
        self.assertNotIn('Alice / ',preview_ass(dict(project=p,video=video))['ass'])
        p['preview']['speaker_palette']['rows'][0]['style']['fontSize']=-1
        with self.assertRaises(ValueError):validate(p)
