import copy
import json
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from maw.msw import track_presentation as presentation
from maw.msw.flat_subtitles import migrate_project
from maw.msw.subtitle_preview import preview_ass
from maw.msw.subtitle_style import styled_ass
from maw.project_subtitle_style import builtin_presets


class PreviewEfficiencyTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'frontend projection requires Node')
    def test_projected_fixed_notes_and_overlap_chains_match_full_export_geometry(self):
        project = migrate_project({'segments': [dict(id=f'c{i}',start=i*1000,end=i*1000+1500,text=f'Text {i}') for i in range(30)]})
        main=project['subtitles']['tracks'][0]
        note=dict(copy.deepcopy(main),id='note',name='Note',layout='fixed',position=dict(x=.5,y=.1))
        project['subtitles']['tracks'].append(note)
        project['subtitles']['cues'].append(dict(id='long-note',track_id='note',content=dict(start=0,end=600000,text='Long note')))
        # A separated late group must not be pulled in via the annotation.
        project['subtitles']['cues'].append(dict(id='late',track_id=main['id'],content=dict(start=400000,end=401000,text='Later')))
        source="const b=require('./web/msw-production-project.js');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(b.toProject(b.fromProject(JSON.parse(s)),{previewWindow:{start:10000,end:11000}}))));"
        result=subprocess.run(['node','-e',source],input=json.dumps(project),text=True,encoding='utf-8',capture_output=True,check=True,cwd=Path(__file__).resolve().parents[1])
        cropped=json.loads(result.stdout)
        self.assertEqual(len(cropped['subtitles']['cues']),31)
        full={r['cue_id']:r for r in presentation.layout(project)}
        for r in presentation.layout(cropped):
            expected=full[r['cue_id']]
            for field in ('x','y','width','height','style','animations','motion'):
                self.assertEqual(r[field],expected[field],(r['cue_id'],field))

    def test_preview_uses_one_layout_and_matches_export_after_each_change(self):
        project = migrate_project({'segments': [dict(id='a', start=0, end=2000, text='First'),
                                                 dict(id='b', start=2000, end=4000, text='Second')]})
        video = dict(width=640, height=360)
        plan = dict(intervals=[dict(start_ms=0, end_ms=43200000, output_start_ms=0)])
        for overrides in ({}, {'fontSize': 92, 'primaryColor': '#12ab34'},
                          {'backgroundShape': 'rounded', 'backgroundRadius': 14}):
            project['subtitles']['cues'][0]['content']['subtitle_style'] = overrides
            before = copy.deepcopy(project)
            with patch.object(presentation, 'layout', wraps=presentation.layout) as layout:
                result = preview_ass(dict(project=project, video=video))
                self.assertEqual(layout.call_count, 1)
            self.assertEqual(result['ass'], styled_ass(project, plan, 'both', video))
            self.assertEqual(project, before)

    def test_measurement_cache_reuses_unchanged_cues_but_not_changed_inputs(self):
        presentation._cached_measurement.cache_clear()
        style = builtin_presets()[0]['main']
        with patch.object(presentation, '_measure_text', wraps=presentation._measure_text) as measure:
            original = presentation.measured_text('Text 中文', style, 1920)
            repeated = presentation.measured_text('Text 中文', copy.deepcopy(style), 1920)
            self.assertEqual(original, repeated)
            self.assertEqual(measure.call_count, 1)
            repeated['width'] = -1
            self.assertEqual(presentation.measured_text('Text 中文', style, 1920), original)
            for text, value, width, prefix in [('Changed', style, 1920, ''),
                    ('Text 中文', dict(style, fontSize=88), 1920, ''),
                    ('Text 中文', style, 1280, ''), ('Text 中文', style, 1920, 'Speaker: ')]:
                presentation.measured_text(text, value, width, prefix=prefix)
            self.assertEqual(measure.call_count, 5)

    def test_track_style_is_resolved_once_and_locked_or_disabled_state_is_not_cached(self):
        project = migrate_project({'segments': [dict(id=str(i), start=i*2000, end=i*2000+1000, text='Text') for i in range(12)]})
        with patch.object(presentation, 'normalize_project_style', wraps=presentation.normalize_project_style) as normalize:
            self.assertEqual(len(presentation.layout(project)), 12)
            self.assertEqual(normalize.call_count, 1)
        project['subtitles']['tracks'][0]['enabled'] = False
        self.assertEqual(presentation.layout(project), [])
