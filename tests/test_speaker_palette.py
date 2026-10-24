import copy
import unittest

from maw.msw.flat_subtitles import migrate_project, validate
from maw.msw.speaker_palette import validate as validate_palette
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.speaker import apply_speaker_colors, inherit_speaker_color


class SpeakerPaletteTests(unittest.TestCase):
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
