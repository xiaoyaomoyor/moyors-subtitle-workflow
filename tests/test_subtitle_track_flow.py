import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from maw.msw.subtitle_tracks import migrate_project, TrackIndex
from maw.msw.track_presentation import layout, measured_text, pair_settings
from maw.msw.subtitle_style import styled_ass
from maw.msw.subtitle_preview import preview_ass
from maw.project_subtitle_style import builtin_presets, normalize_project_style
from maw.project import normalize_project
from maw.project_io import write_mosp
from maw.msw.subtitle_export import mapped_subtitles
from maw.msw import asr, jobs


def fixture():
    source=json.loads((Path(__file__).parent/'fixtures/subtitle-tracks.json').read_text(encoding='utf-8'))[0]['project']
    p=migrate_project(source)
    p['subtitle_tracks']['presentation']='fixed'
    p['preview']={'project_style':builtin_presets()[0]}
    p['segments'][1]['disabled']=False
    return p


class TrackFlowTests(unittest.TestCase):
    def test_single_auto_cue_keeps_original_ass_anchor_pixels(self):
        from maw.msw.flat_subtitles import migrate_project as migrate_flat
        ffmpeg=Path(os.environ.get('MSW_TEST_FFMPEG',''))/'ffmpeg.exe'
        if not ffmpeg.is_file():self.skipTest('MSW_TEST_FFMPEG directory required')
        plan={'intervals':[dict(start_ms=0,end_ms=3000,output_start_ms=0)]}
        with tempfile.TemporaryDirectory() as temp:
            for alignment,font,scale,text in [(2,'Arial',100,'Subtitle position test'),
                    (2,'Microsoft YaHei',130,'Subtitle\nposition test'),
                    (1,'Arial',100,'Left'),(3,'Arial',100,'Right'),
                    (5,'Arial',100,'Middle'),(8,'Arial',100,'Top')]:
                with self.subTest(alignment=alignment,font=font,scale=scale):
                    p=migrate_project(dict(segments=[dict(id='cue',start=0,end=3000,text=text,items=[])]))
                    style=builtin_presets()[0]
                    style['main'].update(alignment=alignment,fontName=font,scaleY=scale)
                    p['preview']={'project_style':style}
                    p['subtitle_tracks']['presentation']='legacy'
                    frames=[]
                    for name,project in [('old',p),('flat',migrate_flat(p))]:
                        ass=styled_ass(project,plan,'main',dict(width=1920,height=1080))
                        Path(temp,name+'.ass').write_text(ass,encoding='utf-8')
                        frame=subprocess.run([str(ffmpeg),'-v','error','-f','lavfi','-i',
                            'color=black:s=1920x1080:r=1:d=1','-vf',f'ass={name}.ass',
                            '-frames:v','1','-f','rawvideo','-pix_fmt','gray','pipe:1'],
                            cwd=temp,check=True,capture_output=True).stdout
                        points=[i for i,v in enumerate(frame) if v>128]
                        self.assertTrue(points)
                        frames.append((min(i%1920 for i in points),max(i%1920 for i in points),
                                       min(points)//1920,max(points)//1920))
                    self.assertEqual(*frames)

    def test_legacy_preset_spacing_and_speaker_prefix_match_style_controls(self):
        style=builtin_presets()[1]
        self.assertEqual(pair_settings(style),dict(order='main-above',gap=-7))
        style['main'].update(wrapMode='characters',charsPerLine=3)
        measured=measured_text('abcdef',style['main'],1920,prefix='A: ')
        self.assertEqual(measured['text'],'A: abc\ndef')

    def test_annotation_preset_roundtrip_and_rendering(self):
        p=fixture();style=p['preview']['project_style'];style['annotation']=copy.deepcopy(style)
        style['annotation']['main']['fontSize']=29
        track=TrackIndex(p).track_for(dict(role='main',track_id=None,cue_id='b'));track.update(purpose='annotation',layout='fixed',style_base='annotation')
        normalized=normalize_project(p)
        row=next(r for r in layout(normalized) if r['cue_id']=='b')
        self.assertEqual(row['style']['fontSize'],29)
        self.assertEqual(normalized['preview']['project_style']['annotation'],normalize_project_style(style['annotation']))

    def test_preview_and_burn_share_ass_with_fixed_positions_and_stable_packing(self):
        p=fixture();before=copy.deepcopy(p)
        rows=layout(p)
        main=next(r for r in rows if r['role']=='main' and r['cue_id']=='a')
        second=next(r for r in rows if r['role']=='main' and r['cue_id']=='b')
        self.assertLess(second['y']+second['height'],main['y'])
        for r in rows:self.assertIn('text',r['size'])
        video={'width':1920,'height':1080}
        plan={'intervals':[dict(start_ms=0,end_ms=43200000,output_start_ms=0)]}
        ass=styled_ass(p,plan,'both',video)
        self.assertEqual(preview_ass({'project':p,'target':'both','video':video})['ass'],ass)
        self.assertIn(r'\pos(',ass);self.assertEqual(p,before)

    def test_hidden_disabled_annotation_and_time_mapping(self):
        p=fixture();index=TrackIndex(p)
        track=index.track_for(dict(role='main',track_id=None,cue_id='a'))
        track.update(purpose='annotation',layout='fixed',position=dict(x=.3,y=.15))
        annotation=[r for r in layout(p) if r['subtitle_track_id']==track['id']]
        self.assertAlmostEqual(min(r['y'] for r in annotation),162)
        plan={'intervals':[dict(start_ms=1000,end_ms=2000,output_start_ms=0),dict(start_ms=3000,end_ms=5000,output_start_ms=1000)]}
        cues=mapped_subtitles(p,plan)[0][1]
        self.assertTrue(all(c['subtitle_purpose']=='annotation' and c['subtitle_layout']=='fixed' for c in cues if c['id']=='a'))
        self.assertEqual([(c['start'],c['end']) for c in cues if c['id']=='a'],[(1,1000),(1000,2007)])
        track['enabled']=False
        self.assertNotIn('first',styled_ass(p,plan,'both',dict(width=1920,height=1080)))
        self.assertFalse(any(c['id']=='a' for _,group in mapped_subtitles(p,plan) for c in group))

    def test_pair_order_negative_gap_and_distant_long_text(self):
        p=fixture();style=p['preview']['project_style'];style['pairLayout']=dict(order='secondary-above',gap=-20)
        before=layout(p)
        a=[r for r in before if r['cue_id']=='a'];self.assertLess(next(r['y'] for r in a if r['role']=='extension'),next(r['y'] for r in a if r['role']=='main'))
        style['pairLayout']['gap']=0;normal=layout(p)
        def gap(rows):
            a=[r for r in rows if r['cue_id']=='a'];return max(r['y'] for r in a)-min(r['y'] for r in a)
        self.assertLess(gap(before),gap(normal))
        p['segments'][-1]['text']='Distant '*1000
        after=layout(p)
        self.assertEqual([(r['key'],r['y']) for r in normal if r['cue_id']=='a'],[(r['key'],r['y']) for r in after if r['cue_id']=='a'])

    def test_production_save_roundtrip_and_one_original_backup(self):
        p=fixture()
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'project.mosp';original=b'{"segments": []}\r\n';path.write_bytes(original)
            write_mosp(path,p)
            self.assertEqual(normalize_project(json.loads(path.read_text(encoding='utf-8')))['subtitle_tracks'],p['subtitle_tracks'])
            backups=list(Path(temp).glob('.msw-tracks-backup-*.mosp'));self.assertEqual(len(backups),1)
            self.assertEqual(backups[0].read_bytes(),original);write_mosp(path,p)
            self.assertEqual(len(list(Path(temp).glob('.msw-tracks-backup-*.mosp'))),1)
            with self.assertRaisesRegex(ValueError,'旧版'):write_mosp(path,{'segments':[]})

    def test_usage_is_only_a_label_and_fixed_position_is_independent(self):
        p=fixture();track=p['subtitle_tracks']['tracks'][1];before=layout(p)
        for purpose in ('none','dialogue','source','translation','annotation'):
            track['purpose']=purpose
            self.assertEqual(layout(p),before)
        track.update(layout='fixed',position=dict(x=.4,y=.2))
        self.assertAlmostEqual(min(r['y'] for r in layout(p) if r['subtitle_track_id']==track['id']),216)
        track['layout']='auto'
        self.assertEqual(layout(p),before)

    def test_existing_v3_metadata_upgrade_preserves_render_and_backs_up_original_once(self):
        p=fixture();p['subtitle_tracks']['schema']='msw.subtitle_tracks.v1'
        for track in p['subtitle_tracks']['tracks']:
            for field in ('purpose','layout','style_base'):track.pop(field)
        p['subtitle_tracks']['tracks'][1].update(kind='annotation',position=dict(x=.4,y=.2))
        original=copy.deepcopy(p);before=layout(p);next=migrate_project(p)
        self.assertEqual(layout(next),before);self.assertEqual(p,original)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'old.mosp';raw=json.dumps(p,ensure_ascii=False).encode('utf-8');path.write_bytes(raw)
            write_mosp(path,next);write_mosp(path,next)
            backups=list(Path(temp).glob('.msw-tracks-backup-*.mosp'));self.assertEqual(len(backups),1)
            self.assertEqual(backups[0].read_bytes(),raw)
            with self.assertRaisesRegex(ValueError,'旧版轨道'):write_mosp(path,p)

    def test_job_snapshot_boundaries_preserve_owner_and_simultaneous_sources(self):
        p=fixture();owner=p['subtitle_tracks']['tracks'][0]['id']
        raw=dict(project_id='p',project_schema=p['schema'],subtitle_track_id=owner,mode='whole',range=dict(start=0,end=9000),
                 source=dict(id='media',revision='x',duration_ms=9000),targets=p['segments'])
        self.assertEqual(asr.validate_snapshot(raw)['subtitle_track_id'],owner)
        translation=dict(project_id='p',project_schema=p['schema'],track_id=None,entries=[dict(source=c,target=None,binding_id=None,subtitle_track_id=owner) for c in p['segments']])
        clean=jobs.validate_snapshot(translation)
        self.assertEqual([e['subtitle_track_id'] for e in clean['entries']],[owner]*3)
        del raw['subtitle_track_id']
        with self.assertRaisesRegex(ValueError,'目标字幕轨道'):asr.validate_snapshot(raw)

    def test_real_ffmpeg_preview_and_burn_frames_match(self):
        ffmpeg=Path(os.environ.get('MSW_TEST_FFMPEG',''))/'ffmpeg.exe'
        if not ffmpeg.is_file():self.skipTest('MSW_TEST_FFMPEG directory required')
        p=fixture();video=dict(width=640,height=360)
        plan={'intervals':[dict(start_ms=0,end_ms=43200000,output_start_ms=0)]}
        preview=preview_ass(dict(project=p,target='both',video=video))['ass']
        burn=styled_ass(p,plan,'both',video)
        with tempfile.TemporaryDirectory() as temp:
            outputs=[]
            for name,content in [('preview',preview),('burn',burn)]:
                Path(temp,name+'.ass').write_text(content,encoding='utf-8')
                subprocess.run([str(ffmpeg),'-v','error','-f','lavfi','-i','color=c=0x34465c:s=640x360:r=10:d=5','-vf',f'ass={name}.ass','-ss','3.2','-frames:v','1',name+'.png'],cwd=temp,check=True,capture_output=True)
                outputs.append(Path(temp,name+'.png').read_bytes())
            self.assertEqual(*outputs)


if __name__=='__main__':unittest.main()
