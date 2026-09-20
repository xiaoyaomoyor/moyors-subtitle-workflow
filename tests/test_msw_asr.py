import copy
import json
import os
from pathlib import Path
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

from test_msw_media_service import MediaServiceTests
from maw.gui_config import DEFAULT_MODEL_ID
from maw.gui_workflow import build_transcribe_command
from maw.msw import asr_config
from maw.msw.asr import AsrService, validate_snapshot, map_candidates
from maw.msw.jobs import JobManager, TERMINAL


class AsrTests(unittest.TestCase):
    def test_candidate_color_references_keep_palette_name(self):
        project = {'segments': [
            {'start':0,'end':100,'text':'head','color':{'name':'yellow','value':'#c4a019','start':0,'end':400}},
            {'start':100,'end':400,'text':'member','color_ref':{'name':'yellow','headIdx':0}}]}
        result = map_candidates(project, {'start':1000,'end':1500}, 'job')
        self.assertEqual(result[1]['color_ref'], {'name':'yellow','headIdx':0})

    def test_application_provenance_schema(self):
        from maw.msw.project_codec import normalize_extension
        value = {'schema':'msw.editor.v1','project_id':'p','asr_stale_subtitles':{'ext':{'cue':'job'}},
            'asr_applications':{'job':{'source_id':'media','source_revision':'a'*64,'audio_index':0,
                'range':{'start':0,'end':1000},'provider':'qwen','model':'fun-asr','removed_count':1,'added_count':2}}}
        self.assertEqual(normalize_extension(value), value)
        for key, bad in [('audio_index',True),('range',{'start':0,'end':1.5}),('source_revision','invalid'),('added_count',-1)]:
            changed=copy.deepcopy(value);changed['asr_applications']['job'][key]=bad
            with self.subTest(key=key), self.assertRaises(ValueError):normalize_extension(changed)
        value['asr_stale_subtitles']['ext']['cue']={}
        with self.assertRaises(ValueError):normalize_extension(value)

    def test_candidate_groups_and_words_use_source_time_after_clipping(self):
        project={'segments':[
            {'start':0,'end':100,'text':'head','color':{'start':0,'end':900,'color':'#ff0000'}},
            {'start':100,'end':400,'text':'next','color_ref':{'headIdx':0},
             'items':[{'start':100,'end':400,'text':'next'}]},
            {'start':600,'end':900,'text':'outside','color_ref':{'headIdx':0}}]}
        result=map_candidates(project,{'start':1000,'end':1500},'job')
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]['color']['start'],1000)
        self.assertEqual(result[0]['color']['end'],1400)
        self.assertEqual(result[1]['color_ref'],{'headIdx':0})
        self.assertEqual(result[1]['items'][0]['start'],1100)

    def setUp(self):
        MediaServiceTests.setUp(self)
        self.env_path = self.root / 'isolated.env'; self.env_path.write_bytes(b'')
        self.api.env_path = self.env_path; self.api.media = self.media
        self.managers = []; self.calls = []
        self.environment = patch.dict(os.environ, {'DASHSCOPE_API_KEY':'synthetic-asr-key',
            'SONIOX_API_KEY':'synthetic-soniox-key', 'MAW_OPENAI_ASR_API_KEY':'synthetic-openai-key',
            'MSW_OPENAI_ASR_API_KEY':'synthetic-openai-key'})
        self.environment.start()
        self.service = AsrService(self.api, transcribe=self.transcribe)
        self.record = self.media.register(self.source, 'temporary', metadata={'duration_ms':2000,
            'audio_tracks':[{'audio_index':0,'channels':1,'title':'','language':''}]})
        self.media.bind({**self.scope,'media_id':self.record['id']})
        public = self.media.public(self.record)
        self.snapshot = {'project_id':'temporary', 'mode':'range', 'range':{'start':1000,'end':1500},
            'source':{**{key:public[key] for key in ('id','revision','reference','name','audio_index')},'duration_ms':2000}, 'targets':[]}

    def tearDown(self):
        for manager in self.managers:
            manager.close(); self.assertTrue(manager.close_complete.wait(10))
        self.environment.stop(); MediaServiceTests.tearDown(self)

    def transcribe(self, request, *, cancel_event, on_event):
        self.calls.append(request)
        with wave.open(str(request.media_path),'rb') as source:
            self.assertEqual(source.getnframes(),8000)
            self.assertEqual(source.getframerate(),16000)
        output = request.srt_path.with_suffix('.mosp')
        output.write_text(json.dumps({'segments':[{'start':10,'end':200,'text':'hello',
            'items':[{'start':10,'end':100,'text':'he'},{'start':100,'end':200,'text':'llo'}]}]}),encoding='utf-8')
        request.srt_path.write_bytes(b'')
        return SimpleNamespace(json_path=output)

    def test_conflicting_source_track_blocks_asr_before_any_transcription(self):
        self.media.records[self.record['id']]['track_conflict'] = True
        with self.assertRaisesRegex(ValueError, '音轨'):
            self.service.source(self.snapshot)
        self.assertEqual(self.calls, [])

    def settings(self, **options):
        return asr_config.resolve_settings(self.env_path, {'providerId':'qwen','modelId':DEFAULT_MODEL_ID,**options},self.source)

    def manager(self):
        manager=JobManager(self.root/'asr.sqlite3',asr=self.service);self.managers.append(manager);return manager

    def payload(self,key='request'):
        return {**self.scope,'kind':'asr','request_key':key,'snapshot':copy.deepcopy(self.snapshot)}

    def wait(self,manager,job):
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            result=manager.get(job['id'],'temporary')
            if result['status'] in TERMINAL:return result
            time.sleep(.02)
        self.fail('ASR task did not finish')

    def test_qwen_range_uses_real_ffmpeg_and_offsets_words_once_without_postprocessing(self):
        if not self.tools.complete:self.skipTest('FFmpeg required')
        snapshot,_=self.service.prepare(self.payload())
        manager=self.manager(); settings=self.settings(language='zh',qwenAudioContext='Names',qwenAudioHotwords='MSW')
        payload={**self.payload(),'snapshot':snapshot}
        job=manager.submit(payload,settings);self.assertEqual(manager.submit(payload,settings)['id'],job['id'])
        result=self.wait(manager,job);self.assertEqual(result['status'],'succeeded',result)
        cue=result['result']['segments'][0];self.assertEqual((cue['start'],cue['end']),(1010,1200))
        self.assertEqual([(x['start'],x['end']) for x in cue['items']],[(1010,1100),(1100,1200)])
        request=self.calls[0];self.assertFalse(request.generate_html);self.assertFalse(request.generate_waveform)
        self.assertIsNone(request.postprocess_plan);self.assertEqual(request.audio_track,0)
        command=build_transcribe_command(request);self.assertNotIn('--with-waveform',command);self.assertNotIn(settings.api_key,command)
        self.assertFalse(request.media_path.exists())
        raw=' '.join(row[0] for row in manager.db.execute('SELECT payload FROM jobs'))
        self.assertNotIn('synthetic-asr-key',raw)
        self.assertEqual(result['recipe']['qwen_audio_context'],'Names')

    def test_clip_asr_extracts_samples_and_maps_to_timeline_without_source_media(self):
        if not self.tools.complete: self.skipTest('FFmpeg required')
        asset = {'id':'audio-'+'1'*32, 'sha256':'a'*64, 'sample_count':32000, 'sample_rate':16000}
        self.api.asset_reference = lambda project, identity: (asset if identity == asset['id'] else None, None)
        self.api.assets = SimpleNamespace(resolve=lambda *args: self.source)
        self.snapshot = {'project_id':'temporary', 'mode':'clips', 'batch_id':'batch-clip',
            'range':{'start':5000,'end':5500}, 'targets':[], 'source':{'kind':'clip','id':asset['id'],
            'revision':asset['sha256'],'duration_ms':2000,'audio_index':0,'name':'clip',
            'clip':{'id':'clip-1','asset_id':asset['id'],'start_ms':5000,'source_in_sample':16000,
                    'source_out_sample':24000,'playback_rate':1}}}
        self.media.records.clear()
        snapshot, _ = self.service.prepare(self.payload())
        manager=self.manager();job=manager.submit({**self.payload(),'snapshot':snapshot},self.settings())
        result=self.wait(manager,job)
        self.assertEqual(result['status'],'succeeded',result)
        self.assertEqual(result['result']['segments'][0]['start'],5010)
        self.assertEqual(result['snapshot']['batch_id'],'batch-clip')
        bad=copy.deepcopy(snapshot);bad['source']['clip']['source_out_sample']=40000
        with self.assertRaises(ValueError): self.service.source(bad)
        bad=copy.deepcopy(snapshot);bad['source']['revision']='changed'
        with self.assertRaises(ValueError): self.service.source(bad)

    def test_catalog_shares_existing_keys_without_returning_secrets_and_validates_models(self):
        catalog=asr_config.catalog(self.env_path)
        self.assertEqual({p['id'] for p in catalog['providers']},{'qwen','soniox','openai','doubao'})
        self.assertNotIn('synthetic-',json.dumps(catalog))
        for provider,model in [('qwen','fun-asr'),('soniox','stt-async-v5'),('openai','whisper-1')]:
            settings=self.settings(providerId=provider,modelId=model,openaiBaseUrl='http://127.0.0.1:1/v1')
            self.assertEqual(settings.provider_id,provider)
            command=build_transcribe_command(settings.request)
            self.assertIn('--json',command);self.assertNotIn('--with-waveform',command)
        for options in [{'providerId':'local'},{'modelId':'unknown'}, {'providerId':'openai','modelId':'whisper-1','openaiBaseUrl':'https://key@example.com'},
                        {'maxLen':'10','minLen':'20'}, {'qwenAudioContext':'x'*401}]:
            with self.assertRaises(ValueError if options.get('providerId') else Exception):self.settings(**options)

    def test_boundaries_versions_and_scope_are_rejected_before_recognition(self):
        invalid=copy.deepcopy(self.snapshot);invalid['targets']=[{'id':'old','start':900,'end':1400,'text':'Outside'}]
        with self.assertRaisesRegex(ValueError,'切穿'):validate_snapshot(invalid)
        for span in [{'start':True,'end':1500},{'start':1000,'end':3000},{'start':0,'end':0}]:
            invalid=copy.deepcopy(self.snapshot);invalid['range']=span
            with self.assertRaises(ValueError):validate_snapshot(invalid)
        invalid=copy.deepcopy(self.snapshot);invalid['source']['revision']='stale'
        with self.assertRaises(ValueError):self.service.source(invalid)
        wrong={**self.payload(),'project_id':'other'}
        with self.assertRaises(ValueError):self.service.prepare(wrong)
        self.source.write_bytes(self.source.read_bytes()+b'changed')
        with self.assertRaises(ValueError):self.service.source(self.snapshot)
        self.assertEqual(self.calls,[])

    def test_environment_save_needs_no_media_but_jobs_still_validate_source(self):
        options = {'providerId':'qwen','modelId':DEFAULT_MODEL_ID,'language':'en','maxLen':'20','minLen':'5'}
        result = asr_config.save_settings(self.env_path, options)
        self.assertEqual(result['options']['language'], 'en')
        self.assertNotIn('synthetic-', json.dumps(result))
        self.assertEqual(self.calls, [])
        with self.assertRaisesRegex(ValueError, 'Media file does not exist'):
            asr_config.resolve_settings(self.env_path, options, self.root / 'missing.wav')
        with self.assertRaises(ValueError):
            asr_config.save_settings(self.env_path, {**options, 'maxLen':'2'})
        self.assertEqual(asr_config.catalog(self.env_path)['options']['maxLen'], '20')

    def test_environment_and_call_defaults_save_independently(self):
        call = {'providerId':'qwen','modelId':'fun-asr','language':'en'}
        asr_config.save_settings(self.env_path, call, section='call')
        result = asr_config.save_settings(self.env_path, {'providerId':'openai',
            'openaiBaseUrl':'http://127.0.0.1:1234/v1','modelId':'custom-asr','language':'zh'}, section='environment')
        self.assertEqual(result['options']['providerId'], 'qwen')
        self.assertEqual(result['options']['language'], 'en')
        self.assertEqual(result['options']['openaiBaseUrl'], 'http://127.0.0.1:1234/v1')
        result = asr_config.save_settings(self.env_path, {**call,'language':'zh',
            'openaiBaseUrl':'https://ignored.invalid','apiKey':'ignored-synthetic'}, section='call')
        self.assertEqual(result['options']['openaiBaseUrl'], 'http://127.0.0.1:1234/v1')
        self.assertNotIn('ignored-synthetic', self.env_path.read_text(encoding='utf-8'))
        # Legacy options must not override subsequently saved connections.
        asr_config.save_settings(self.env_path, {**call,'workspaceId':'legacy'})
        result = asr_config.save_settings(self.env_path, {'providerId':'qwen','workspaceId':'updated'}, section='environment')
        self.assertEqual(result['options']['workspaceId'], 'updated')

    def test_empty_result_and_outside_candidates_never_invent_subtitles(self):
        self.assertEqual(map_candidates({'segments':[]},self.snapshot['range'],'job'),[])
        result=map_candidates({'segments':[{'start':400,'end':600,'text':'tail'},{'start':600,'end':800,'text':'outside'}]},self.snapshot['range'],'job')
        self.assertEqual([(s['start'],s['end']) for s in result],[(1400,1500)])

    def test_cancelled_job_is_not_applied_and_persistent_result_can_be_reopened(self):
        entered=threading.Event()
        def block(job,settings,cancel,progress):
            entered.set();cancel.wait(5);return {'segments':[]}
        self.service.run=block
        manager=self.manager();settings=self.settings();job=manager.submit(self.payload(),settings)
        self.assertTrue(entered.wait(3));manager.cancel(job['id'],'temporary');self.assertEqual(self.wait(manager,job)['status'],'cancelled')
        self.service.run=lambda *args:{'segments':[]}
        second=manager.submit(self.payload('second'),settings);self.assertEqual(self.wait(manager,second)['status'],'succeeded')
        manager.close();self.assertTrue(manager.close_complete.wait(5));self.managers.remove(manager)
        reopened=self.manager();self.assertEqual(reopened.get(second['id'],'temporary')['result'],{'segments':[]})

    def test_saved_config_uses_existing_launcher_fields_and_does_not_store_credentials_in_options(self):
        asr_config.save_settings(self.env_path,{'providerId':'qwen','modelId':'fun-asr','apiKey':'new-synthetic-key','language':'en'},self.source)
        stored=self.env_path.read_text(encoding='utf-8')
        self.assertIn('DASHSCOPE_API_KEY=new-synthetic-key',stored)
        options=asr_config.catalog(self.env_path)['options'];self.assertNotIn('apiKey',options)
        self.assertEqual(options['modelId'],'fun-asr')
