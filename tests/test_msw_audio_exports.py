import copy
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from maw.ffmpeg import FfmpegTools
from maw.msw.audio_exports import AudioExports, TERMINAL
from maw.msw.audio_plan import VERSION
from maw.msw.audio_render import check_cancel
from maw.msw.tts import DEFAULT_RECIPE
from test_msw_processing import server_module
from test_msw_audio_render import make_wave


class AudioExportApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {'MSW_APP_DATA_ROOT':str(self.root/'local'), 'MAW_ENV_FILE':str(self.root/'isolated.env')})
        self.env.start()
        self.media = self.root / 'source.wav'
        self.media.write_bytes(make_wave([1000] * 24000))
        self.path = self.root / 'project.mosp'
        project = {'segments':[], 'media':str(self.media), 'msw':{'schema':'msw.editor.v1', 'project_id':'p'}}
        self.path.write_text(json.dumps(project), encoding='utf-8')
        bound = server_module.ServerProject(project,self.path,self.media,None,[],source_media_path=self.media)
        self.server = server_module.EditorServer(('127.0.0.1',0),bound,no_waveform=True,settings_path=self.root/'settings.json')
        self.api = self.server.processing_api
        self.started, self.release = threading.Event(), threading.Event()
        self.release.set()
        self.captured = []

        def renderer(plan, output, ffmpeg, cancel, progress, resolver, **kwargs):
            self.captured.append(copy.deepcopy(plan))
            self.started.set()
            while not self.release.wait(.01):
                check_cancel(cancel)
            check_cancel(cancel)
            progress('mixing', .5)
            output.write_bytes(self.media.read_bytes())
            return {'byte_size':output.stat().st_size, 'sample_count':24000,'sample_rate':24000,'channels':1,'attenuation_db':0,'clipped':False}

        self.manager = AudioExports(self.api, renderer=renderer)
        self.api._exports = self.manager
        self.tool_patch = patch.object(self.manager, 'tools', return_value=FfmpegTools(Path('test-ffmpeg'),Path('test-ffprobe')))
        self.tool_patch.start()
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}/api/msw/'
        asset = self.api.assets.add('p','job',{'key':'cue','id':'cue','track_id':None,'text':'Hello','start':0,'end':1000},DEFAULT_RECIPE,self.media.read_bytes())
        project['msw'].update(assets=[asset],audio_tracks=[{'id':'voice','name':'配音','muted':False,'gain_db':0}],audio_clips=[
            {'id':'clip','asset_id':asset['id'],'track_id':'voice','start_ms':1000,'source_in_sample':0,'source_out_sample':24000,
             'playback_rate':1,'muted':False,'gain_db':0,'label':'Hello'}])
        self.payload = dict(project_id='p',client_token='page-1',request_key='request',plan_schema=VERSION,
                            binding=self.api.context()['binding'],project=copy.deepcopy(project),options={'duration_ms':3000})

    def tearDown(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.assertTrue(self.manager.close_complete.wait(5))
        self.thread.join(3)
        self.tool_patch.stop()
        self.env.stop()
        self.temp.cleanup()

    def call(self, route, body=None, headers=None, binary=False):
        request = Request(self.url + route, data=json.dumps(body).encode() if body is not None else None,
                          headers={'Content-Type':'application/json','X-MSW-Token':self.server.request_token,**(headers or {})})
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, raw if binary and response.status == 200 else json.loads(raw)

    def wait(self, job_id):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            jobs = self.manager.list('p')
            found = next(job for job in jobs if job['id'] == job_id)
            if found['status'] in TERMINAL:
                return found
            time.sleep(.01)
        self.fail('Export did not finish')

    def submit(self, payload=None):
        status, result = self.call('audio-exports',payload or self.payload)
        self.assertEqual(status,202,result)
        return result['job']

    def test_export_snapshot_is_immutable_and_idempotent(self):
        self.release.clear()
        job = self.submit()
        self.assertTrue(self.started.wait(3))
        self.assertEqual(self.submit()['id'],job['id'])
        self.payload['project']['msw']['audio_clips'][0]['start_ms'] = 9000
        self.assertEqual(self.call('audio-exports',self.payload)[0],400)
        self.assertEqual(self.captured[0]['pieces'][0]['output_start_sample'],48000)
        self.release.set()
        result = self.wait(job['id'])
        self.assertEqual(result['status'],'succeeded')
        self.assertEqual(result['client_token'],'page-1')

    def test_scoped_single_use_stream_download_and_origin_guard(self):
        job = self.submit()
        self.assertEqual(self.wait(job['id'])['status'],'succeeded')
        route = f"audio-exports/{job['id']}/download"
        self.assertEqual(self.call(route,{'project_id':'other'})[0],404)
        _, result = self.call(route,{'project_id':'p'})
        download = result['url'].split('/api/msw/')[1]
        self.assertNotIn(self.server.request_token,download)
        self.assertEqual(self.call(download,headers={'Origin':'https://example.com'},binary=True)[0],403)
        status, data = self.call(download,headers={'X-MSW-Token':''},binary=True)
        self.assertEqual(status,200)
        self.assertEqual(data,self.media.read_bytes())
        self.assertEqual(self.call(download,binary=True)[0],403)

    def test_cancel_prevents_result_publication(self):
        self.release.clear()
        job = self.submit()
        self.assertTrue(self.started.wait(3))
        status, _ = self.call(f"audio-exports/{job['id']}/cancel",{'project_id':'p'})
        self.assertEqual(status,200)
        self.assertEqual(self.wait(job['id'])['status'],'cancelled')
        self.assertFalse(self.manager.artifact(job).exists())

    def test_history_cleanup_keeps_a_file_with_an_active_download_grant(self):
        job = self.submit()
        self.wait(job['id'])
        ticket = self.manager.ticket(job['id'],'p')
        with self.manager.lock:
            stored = self.manager.get(job['id'],'p')
            for i in range(22):
                self.manager.write({**stored,'id':f'{i:032x}','request_key':f'retained-{i}'})
            self.manager.prune()
        stream, _ = self.manager.download(ticket)
        with stream:
            self.assertEqual(stream.read(),self.media.read_bytes())

    def test_reject_untrusted_media_binding_properties_and_client_graph(self):
        for changes in [{'binding':'stale'}, {'plan_schema':'new-version'}]:
            self.assertEqual(self.call('audio-exports',{**self.payload,**changes})[0],400)
        altered = copy.deepcopy(self.payload)
        altered['project']['msw']['assets'][0]['sample_rate'] = 48000
        self.assertEqual(self.call('audio-exports',altered)[0],400)
        altered = copy.deepcopy(self.payload)
        altered['options']['mode']='mix'
        altered['project']['media']=str(self.root/'unregistered.wav')
        self.assertEqual(self.call('audio-exports',altered)[0],400)
        self.assertEqual(self.call('audio-exports',self.payload,headers={'X-MSW-Token':''})[0],403)

    def test_unused_or_muted_missing_assets_do_not_block_export(self):
        ext = self.payload['project']['msw']
        missing = {**ext['assets'][0], 'id':'audio-'+'e'*32}
        missing['path'] = missing['path'].replace(ext['assets'][0]['id'],missing['id'])
        ext['assets'].append(missing)
        ext['audio_clips'].append({**ext['audio_clips'][0],'id':'muted','asset_id':missing['id'],'muted':True})
        self.assertEqual(self.wait(self.submit()['id'])['status'],'succeeded')
        ext['audio_clips'][-1]['muted']=False
        self.payload['request_key']='new-request'
        self.assertEqual(self.call('audio-exports',self.payload)[0],400)

    def test_missing_used_asset_fails_and_does_not_create_success_file(self):
        asset = self.payload['project']['msw']['assets'][0]
        path = self.api.assets.resolve('p',asset,self.path)
        path.unlink()
        job = self.submit()
        self.assertEqual(self.wait(job['id'])['status'],'failed')
        self.assertFalse(self.manager.artifact(job).exists())

    def test_mixing_validates_selected_original_stream(self):
        self.payload['options'].update(mode='mix',source_audio_index=2)
        with patch('maw.msw.audio_exports.probe_source',return_value={'duration_ms':3000,'audio_tracks':[{'channels':1}]}):
            result = self.wait(self.submit()['id'])
        self.assertEqual(result['status'],'failed')
        self.assertIn('音轨不存在',result['error'])

    def test_source_media_change_during_queue_is_detected(self):
        self.release.clear()
        first = self.submit()
        self.assertTrue(self.started.wait(3))
        self.payload['request_key']='source'
        self.payload['options']['mode']='mix'
        second = self.submit()
        self.media.write_bytes(make_wave([500] * 48000))
        self.release.set()
        self.wait(first['id'])
        self.assertIn('排队期间发生变化',self.wait(second['id'])['error'])

    def test_restart_marks_interrupted_and_cleans_only_owned_scratch(self):
        job = self.submit()
        self.wait(job['id'])
        scratch = self.manager.root / f"render-{job['id']}-abandoned"
        scratch.mkdir()
        (scratch / 'part.f32').write_bytes(b'scratch')
        unrelated = self.manager.root / 'keep-me'
        unrelated.mkdir()
        (unrelated / 'source.txt').write_text('keep',encoding='utf-8')
        with self.manager.lock:
            stored = self.manager.get(job['id'],'p')
            stored['status']='running'
            self.manager.write(stored)
        self.manager.close()
        self.assertTrue(self.manager.close_complete.wait(5))
        replacement = AudioExports(self.api)
        try:
            self.assertEqual(replacement.list('p')[0]['status'],'interrupted')
            self.assertFalse(scratch.exists())
            self.assertFalse(replacement.artifact(job).exists())
            self.assertTrue((unrelated/'source.txt').is_file())
        finally:
            replacement.close()
            self.assertTrue(replacement.close_complete.wait(5))
