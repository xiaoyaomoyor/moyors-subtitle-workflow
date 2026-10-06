import copy
import json
import tempfile
import unittest
import shutil
import subprocess
from unittest.mock import patch
from pathlib import Path

from maw.project import normalize_project
from maw.project_subtitle_style import (builtin_presets, normalize_project_style,
    preserve_style_source, save_presets, load_presets)
from maw.msw.subtitle_style import styled_ass
from maw.msw.subtitle_preview import preview_ass, font_file
from maw.msw.subtitle_layers import migrate_project


class ProjectSubtitleStyleTests(unittest.TestCase):
    def test_default_spacing_matches_frontend_and_other_presets_keep_geometry(self):
        script="const fs=require('fs'),vm=require('vm');const c={window:{}};for(const f of ['gap-remove-core','editor-utils','msw-project-style'])vm.runInNewContext(fs.readFileSync('web/'+f+'.js','utf8'),c);process.stdout.write(JSON.stringify(c.window.MSWProjectStyle.presets()));"
        browser=json.loads(subprocess.check_output(['node','-e',script],cwd=Path(__file__).resolve().parents[1],text=True,encoding='utf-8'))
        backend=builtin_presets()
        self.assertEqual(backend[0]['pairLayout'],{'order':'main-above','gap':0})
        for a,b in zip(browser,backend):
            self.assertEqual(a.get('pairLayout'),b.get('pairLayout'))
            self.assertEqual([a[r]['marginV'] for r in ('main','secondary')],[b[r]['marginV'] for r in ('main','secondary')])
        self.assertEqual(backend[1]['main']['marginV'],108)

    def test_old_srt_slot_is_imported_without_modifying_its_library(self):
        from maw.ass_styles import default_ass_style_library
        old=default_ass_style_library()
        next(s for s in old['styles'] if s['id']=='default')['fontSize']=20
        before=copy.deepcopy(old)
        with tempfile.TemporaryDirectory() as folder, patch('maw.project_subtitle_style.presets_path',return_value=Path(folder)/'new.json'), patch('maw.ass_styles.load_ass_style_library',return_value=old):
            imported=load_presets()['presets']
        srt=next(s for s in imported if s['id']=='legacy-srt-burn')
        self.assertEqual(srt['main']['fontSize'],75)
        self.assertEqual(old,before)
        with self.assertRaisesRegex(ValueError,'版本不受支持'):
            save_presets({'version':99,'presets':[]})

    @unittest.skipUnless(shutil.which('node'), 'Node.js is required for cross-runtime verification')
    def test_portable_legacy_ass_matches_burn_background_and_multilayer_positions(self):
        project=normalize_project(migrate_project({'segments':[
            {'id':'a','start':0,'end':2000,'text':'中文 {text}\\path'},
            {'id':'b','start':500,'end':1500,'text':'overlap'}],
            'preview':{'project_style':dict(builtin_presets()[0],legacyBurn={
                'main':{'background_alpha':.4,'x':.3,'width':.5}})}}))
        project['preview']['project_style'].pop('pairLayout',None)
        plan={'intervals':[{'start_ms':0,'end_ms':12000,'output_start_ms':0}]}
        script="""const fs=require('node:fs'),vm=require('node:vm');const c={window:{},TextEncoder,TextDecoder,Uint8Array};
for(const f of ['gap-remove-core','editor-utils','msw-project-style','msw-subtitle-presentation'])vm.runInNewContext(fs.readFileSync('web/'+f+'.js','utf8'),c);
process.stdout.write(c.window.MSWProjectStyle.buildLegacyAss(JSON.parse(fs.readFileSync(0,'utf8'))));"""
        def rows(text):
            return [line.lower() for line in text.splitlines() if line.startswith(('Style:', 'Dialogue:'))]
        for paired in (False,True):
            if paired:
                project['preview']['project_style']['pairLayout']={'order':'secondary-above','gap':-12}
                project['multi_subtitle']={'enabled':True,'tracks':[{'id':'sub','segments':[{'id':'s','start':100,'end':1800,'text':'Translation'}]}]}
            expected=styled_ass(project,plan,'both',{'width':1920,'height':1080})
            actual=subprocess.run(['node','-e',script],input=json.dumps(project),encoding='utf-8',capture_output=True,
                check=True,cwd=Path(__file__).resolve().parents[1]).stdout
            self.assertEqual(rows(actual),rows(expected))

    def test_preview_and_burn_share_exact_ass(self):
        style=builtin_presets()[1]
        style['animations']['fad'].update(enabled=True,inMs=120,outMs=200)
        project={'segments':[{'start':0,'end':2000,'text':'中文 sample'}],
            'multi_subtitle':{'enabled':True,'tracks':[{'segments':[{'start':0,'end':2000,'text':'second'}]}]},
            'preview':{'project_style':style}}
        before=copy.deepcopy(project)
        video={'width':1280,'height':720}
        result=preview_ass({'project':project,'target':'both','video':video})
        self.assertEqual(result['layoutVersion'],1)
        plan={'intervals':[{'start_ms':0,'end_ms':12*3600*1000,'output_start_ms':0}]}
        self.assertEqual(result['ass'],styled_ass(normalize_project(project),plan,'both',video))
        self.assertIn(r'\fad(120,200)',result['ass'])
        self.assertIn('PlayResY: 1080',result['ass'])
        self.assertEqual(project,before)

    def test_project_roundtrip_does_not_depend_on_library(self):
        project=normalize_project({'segments':[],'preview':{'project_style':builtin_presets()[0]}})
        self.assertEqual(project['preview']['project_style']['main']['fontSize'],48)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'presets.json'
            preset=copy.deepcopy(builtin_presets()[0]);preset['id']='custom'
            save_presets({'presets':[preset]},path)
            preset['main']['fontSize']=100
            save_presets({'presets':[preset]},path)
            self.assertEqual(load_presets(path)['presets'][0]['main']['fontSize'],100)
            self.assertEqual(project['preview']['project_style']['main']['fontSize'],48)

    def test_custom_style_and_pair_layout_roundtrip_and_validation(self):
        style=copy.deepcopy(builtin_presets()[0]);style['pairLayout']={'order':'secondary-above','gap':-12}
        project=normalize_project({'segments':[],'preview':{'project_style':builtin_presets()[1], 'project_style_custom':style,'project_style_selection':'large'}})
        self.assertEqual(project['preview']['project_style_custom']['pairLayout'],style['pairLayout'])
        self.assertEqual(project['preview']['project_style_selection'],'large')
        for bad in ({'order':'sideways','gap':12},{'order':'main-above','gap':241},{'order':'main-above','gap':-241},{'order':'main-above','gap':True}):
            with self.subTest(bad=bad),self.assertRaises(ValueError):normalize_project_style(dict(style,pairLayout=bad))

    def test_pair_layout_is_used_by_preview_and_burn_in_manual_overlap_mode(self):
        from tests.test_subtitle_layers_dg import bilingual
        style=copy.deepcopy(builtin_presets()[0]);style['pairLayout']={'order':'secondary-above','gap':24}
        project=bilingual();project['preview']={'project_style':style};project['subtitle_layers']['presentation']={'mode':'manual','gap':12}
        project=normalize_project(project)
        video={'width':1920,'height':1080};plan={'intervals':[{'start_ms':0,'end_ms':12*3600*1000,'output_start_ms':0}]}
        output=styled_ass(project,plan,'both',video)
        self.assertEqual(preview_ass({'project':project,'target':'both','video':video})['ass'],output)
        events=[line.split(',') for line in output.splitlines() if line.startswith('Dialogue:')]
        main=next(e for e in events if e[3].startswith('main'));secondary=next(e for e in events if e[3]=='secondary')
        self.assertGreater(int(secondary[7]),int(main[7]))

    def test_legacy_burn_preserves_background_and_position(self):
        project={'segments':[{'start':0,'end':1000,'text':'old'}],
            'preview':{'burn_subtitles':{'main':{'x':.25,'width':.4,'background_alpha':.4}}}}
        plan={'intervals':[{'start_ms':0,'end_ms':2000,'output_start_ms':0}]}
        old=styled_ass(project,plan,'main',{'width':640,'height':360})
        project['preview']['project_style']=dict(builtin_presets()[0],legacyBurn=project['preview']['burn_subtitles'])
        # Old snapshots have no explicit pairing; migration must retain that.
        project['preview']['project_style'].pop('pairLayout',None)
        self.assertEqual(old,styled_ass(project,plan,'main',{'width':640,'height':360}))

    def test_first_migration_keeps_original_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'project.mosp'
            original=json.dumps({'schema':'msw.project.v2','segments':[]}).encode()
            target.write_bytes(original)
            updated={'preview':{'project_style':builtin_presets()[0]}}
            backup=preserve_style_source(target,updated)
            self.assertEqual(backup.read_bytes(),original)
            self.assertEqual(preserve_style_source(target,updated),backup)
            target.write_text(json.dumps(updated),encoding='utf-8')
            self.assertIsNone(preserve_style_source(target,updated))
            self.assertEqual(backup.read_bytes(),original)

    def test_invalid_preview_and_font_handles_are_rejected(self):
        for raw in [None,{},dict(builtin_presets()[0],schema='unknown'),dict(builtin_presets()[0],main=[] )]:
            with self.assertRaises(ValueError):normalize_project_style(raw)
        with self.assertRaises(ValueError):font_file('../../private')
        with self.assertRaises(ValueError):preview_ass({'project':{'segments':[]},'target':'both','video':{'width':999999,'height':720}})
