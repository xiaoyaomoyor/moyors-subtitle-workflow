"""MSW metadata must survive the beta.6 manuscript boundary fixes."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from maw.postprocess import OutputMode
from maw.postprocess_io import read_project
from maw.postprocess_match import ScriptMatchRequest, run_script_match


class MatchCompatibilityTests(unittest.TestCase):
    def test_extras_keep_ids_and_other_tracks_after_regrouping(self):
        for timed in (False, True):
            with self.subTest(timed=timed), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                cues = [dict(id=key, start=i*1000, end=(i+1)*1000, text=text)
                        for i, (key, text) in enumerate([
                            ('first', '第一句文稿'), ('main-matched-001', '额外录音内容'),
                            ('last', '第二句文稿')])]
                cues[0]['color'] = dict(name='red', value='#ff0000', start=0, end=1000)
                cues[1]['color_ref'] = dict(headIdx=0)
                if timed:
                    for cue in cues:
                        cue['items'] = [dict(start=cue['start'], end=cue['end'], text=cue['text'])]
                extension = dict(schema='msw.editor.v1', project_id='project-match',
                                 future={'keep': [1, 2]}, applied_results=['job-original'])
                overlay = dict(enabled=True, segments=[dict(id='overlay', start=0, end=3000, text='叠加')])
                project = dict(segments=cues, msw=extension, overlay_track=overlay,
                               multi_subtitle=dict(schema='moy.asr.multi_subtitle.v1', enabled=True,
                                   tracks=[dict(id='translated', name='译文', segments=[
                                       dict(id='sub', start=0, end=1000, text='译文')])],
                                   bindings=[dict(id='binding', track_id='translated',
                                       main_segment_ids=['first'], extension_segment_ids=['sub'])]))
                original = root/'source.mosp'
                original.write_text(json.dumps(project, ensure_ascii=False), encoding='utf-8')
                script = root/'script.txt'
                script.write_text('第一句文稿。\n第二句文稿。', encoding='utf-8')
                artifact = run_script_match(ScriptMatchRequest(original, None, script, OutputMode.JSON))
                result = read_project(artifact.project_path)
                self.assertEqual([cue['text'] for cue in result['segments']],
                                 ['第一句文稿', '额外录音内容', '第二句文稿'])
                self.assertEqual(result['segments'][1]['id'], 'main-matched-001')
                self.assertEqual(len({cue['id'] for cue in result['segments']}), 3)
                self.assertEqual(result['msw'], extension)
                self.assertEqual(result['overlay_track']['segments'][0]['text'], '叠加')
                self.assertEqual(result['multi_subtitle']['tracks'][0]['segments'][0]['text'], '译文')
                extra = result['segments'][1]
                owner = result['segments'][extra['color_ref']['headIdx']] if 'color_ref' in extra else extra
                self.assertEqual(owner['color']['name'], 'red')
                self.assertNotIn('_match_source_id', json.dumps(result))
                self.assertEqual(json.loads(original.read_text(encoding='utf-8')), project)

    def test_changed_main_cue_detaches_binding_without_losing_translation(self):
        from maw.postprocess_match import _normalize_matched_project
        source = dict(segments=[dict(id='main', start=0, end=1000, text='原文')],
                      multi_subtitle=dict(enabled=True, tracks=[dict(id='sub-track', segments=[
                          dict(id='sub', start=0, end=1000, text='译文')])],
                          bindings=[dict(id='binding', track_id='sub-track', main_segment_ids=['main'], extension_segment_ids=['sub'])]))
        changed = copy.deepcopy(source)
        changed['segments'][0]['text'] = '修正文稿'
        result = _normalize_matched_project(source, changed)
        self.assertEqual(result['multi_subtitle']['bindings'], [])
        self.assertEqual(result['multi_subtitle']['tracks'][0]['segments'][0]['text'], '译文')
