"""Synthetic production boundaries for unified subtitle layers."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from maw.msw.subtitle_layers import migrate_project, preserve_upgrade_source
from maw.project_io import write_mosp
from maw.msw.subtitle_presentation import presentation
from maw.msw.subtitle_style import normalize_styles, styled_ass
from maw.msw.subtitle_export import mapped_subtitles
from maw.msw.jobs import validate_snapshot, translate_snapshot
from tests.test_msw_processing import SETTINGS, server_module

ROOT = Path(__file__).resolve().parents[1]

def bilingual():
    source = next(f['project'] for f in json.loads((ROOT/'tests/fixtures/subtitle-layers.json').read_text(encoding='utf-8')) if f['name']=='bound-bilingual')
    return migrate_project(source)

class ProductionLayersTests(unittest.TestCase):
    def test_pair_order_spacing_and_single_track_positions_match_browser(self):
        script="require('./web/msw-subtitle-presentation.js');const p=JSON.parse(process.argv[1]);const s=JSON.parse(process.argv[2]);process.stdout.write(JSON.stringify([...MSWSubtitlePresentation.layout(p,s,process.argv[3]).offsets]));"
        styles=normalize_styles()
        for mode in ('auto', 'manual'):
            for order in ('main-above', 'secondary-above'):
                project=bilingual();project['preview']={'project_style':{'pairLayout':{'order':order,'gap':24}}}
                project['subtitle_layers']['presentation']={'mode':mode,'gap':12}
                project['multi_subtitle']['tracks'][0]['segments'][0]['text']='two\nlines'
                full=presentation(project,styles)
                for target in ('both', 'main', 'secondary'):
                    with self.subTest(mode=mode,order=order,target=target):
                        actual=json.loads(subprocess.check_output(['node','-e',script,json.dumps(project),json.dumps(styles),target],cwd=ROOT,text=True,encoding='utf-8'))
                        expected=presentation(project,styles,target)
                        for key,value in actual:self.assertAlmostEqual(value['offset'],expected[tuple(json.loads(key))])
                        self.assertEqual(expected,{key:value for key,value in full.items() if target=='both' or key[0]==target})

    def test_first_upgrade_backup_exact_bytes_and_no_silent_downgrade(self):
        with tempfile.TemporaryDirectory() as raw:
            target=Path(raw)/'lesson.mosp'
            old=b'{"segments": [], "schema": "moy.asr.project.v1"}\n'
            target.write_bytes(old)
            project=bilingual()
            write_mosp(target,project)
            backup=target.with_name('lesson.v1-backup.mosp')
            self.assertEqual(backup.read_bytes(),old)
            self.assertEqual(json.loads(target.read_text(encoding='utf-8'))['segments'],project['segments'])
            write_mosp(target,project)
            self.assertEqual(len(list(Path(raw).glob('*.v1-backup*.mosp'))),1)
            with self.assertRaisesRegex(ValueError,'旧版结构'):
                write_mosp(target,{'segments':[]})
            self.assertEqual(json.loads(target.read_text(encoding='utf-8'))['schema'],'msw.project.v2')
            # A collision never replaces a previous backup.
            target.write_bytes(old+b' ')
            write_mosp(target,project)
            self.assertEqual(backup.read_bytes(),old)
            self.assertEqual(len(list(Path(raw).glob('*.v1-backup*.mosp'))),2)

    def test_backup_and_replace_failures_preserve_original(self):
        with tempfile.TemporaryDirectory() as raw:
            target=Path(raw)/'lesson.mosp';old=b'{"segments":[]}'
            target.write_bytes(old)
            with patch('maw.msw.subtitle_layers.preserve_upgrade_source',side_effect=OSError('backup unavailable')):
                with self.assertRaises(OSError):write_mosp(target,bilingual())
            self.assertEqual(target.read_bytes(),old)
            with patch('os.replace',side_effect=OSError('write interrupted')):
                with self.assertRaises(OSError):write_mosp(target,bilingual())
            self.assertEqual(target.read_bytes(),old)
            self.assertEqual(target.with_name('lesson.v1-backup.mosp').read_bytes(),old)

    def test_server_upgrade_backup_and_v2_reload(self):
        with tempfile.TemporaryDirectory() as raw:
            target=Path(raw)/'lesson.mosp';old=b'{"segments":[]}'
            target.write_bytes(old)
            project=bilingual()
            server_module.write_project_json(target,project)
            self.assertEqual(target.with_name('lesson.v1-backup.mosp').read_bytes(),old)
            self.assertEqual(json.loads(target.read_text(encoding='utf-8'))['multi_subtitle'],project['multi_subtitle'])

    def test_bound_layout_browser_python_parity_and_hidden_disabled(self):
        project=bilingual();styles=normalize_styles()
        before=copy.deepcopy(project)
        script="require('./web/msw-subtitle-presentation.js');const p=JSON.parse(process.argv[1]);const s=JSON.parse(process.argv[2]);process.stdout.write(JSON.stringify([...MSWSubtitlePresentation.layout(p,s).offsets]));"
        actual=json.loads(subprocess.check_output(['node','-e',script,json.dumps(project),json.dumps(styles)],cwd=ROOT,text=True,encoding='utf-8'))
        expected=presentation(project,styles)
        self.assertEqual({tuple(json.loads(k)):v['offset'] for k,v in actual},expected)
        self.assertEqual(len(expected),4)
        self.assertEqual(project,before)
        project['segments'][0]['disabled']=True
        project['subtitle_layers']['legacy_overlay']={'visible':False,'cue_ids':[project['segments'][1]['id']]}
        plan={'intervals':[{'start_ms':0,'end_ms':10000,'output_start_ms':0}]}
        self.assertEqual(mapped_subtitles(project,plan)[0][1],[])

    def test_four_visible_ass_events_and_halfopen_frame(self):
        project=bilingual();plan={'intervals':[{'start_ms':0,'end_ms':10000,'output_start_ms':0}]}
        output=styled_ass(project,plan,'both',{'width':1920,'height':1080},frame_at=2500)
        events=[r.split(',') for r in output.splitlines() if r.startswith('Dialogue:')]
        self.assertEqual(len(events),4)
        self.assertEqual(len({r[7] for r in events}),4)
        end=max(c['end'] for c in project['segments']+project['multi_subtitle']['tracks'][0]['segments'])
        self.assertNotIn('Dialogue:',styled_ass(project,plan,'both',{'width':1920,'height':1080},frame_at=end))

    def test_translation_service_preserves_overlapping_source_ids(self):
        project=bilingual()
        snapshot={'project_id':'project-test','project_schema':project['schema'],'track_id':None,'entries':[{'source':c,'target':None,'binding_id':None} for c in project['segments']]}
        checked=validate_snapshot(snapshot)
        def complete(settings,prompt,cues):
            return {'groups':[{'source_ids':[c['id']],'text':'Translation '+c['text']} for c in cues]}
        with patch('maw.msw.jobs.complete_subtitle_groups',side_effect=complete):
            result=translate_snapshot(checked,'en','',SETTINGS,threading.Event(),lambda *_:None)
        self.assertEqual([r['id'] for r in result['translations']],[c['id'] for c in project['segments']])
