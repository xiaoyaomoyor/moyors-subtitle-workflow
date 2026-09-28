import copy
import io
import json
import tempfile
import threading
import time
import unittest
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from maw.msw.gpt_sovits import GptSovits, DEFAULT_RECIPE, synthesize, validate_recipe, family_of
from maw.msw.jobs import JobCancelled


def wav(seconds=4):
    out=io.BytesIO()
    with wave.open(out,'wb') as f:
        f.setparams((1,2,16000,0,'NONE','not compressed')); f.writeframes(b'\0\0'*int(16000*seconds))
    return out.getvalue()


class GptTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name); self.bundle=root/'bundle'
        folder=self.bundle/'GPT_weights';folder.mkdir(parents=True);(folder/'voice.ckpt').write_bytes(b'PKgpt')
        folder=self.bundle/'SoVITS_weights_v2Pro';folder.mkdir();(folder/'voice.pth').write_bytes(b'05sovits')
        self.c=GptSovits(root,lambda data,suffix:data)
        self.c.services=SimpleNamespace(settings=lambda k:{'directory':str(self.bundle)},snapshot=lambda k:{'configured':False})
        models=self.c.scan_models()['models'];self.ref=self.c.store_reference('speaker.wav',wav())
        self.recipe={**copy.deepcopy(DEFAULT_RECIPE),'gpt_model':next(m['id'] for m in models if m['kind']=='gpt'),
                     'sovits_model':next(m['id'] for m in models if m['kind']=='sovits'),'speaker_ref':self.ref['id'],
                     'prompt_text':'これはテストです。','prompt_lang':'ja','language_type':'zh'}
        self.calls=[];self.fail=False;self.started=threading.Event();self.release=threading.Event();self.release.set()
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*a):pass
            def do_GET(self):
                owner.calls.append(self.path.split('?')[0])
                self.send_response(400 if owner.fail and self.path.startswith('/set_sovits') else 200)
                body=b'{"message":"success"}';self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));owner.calls.append(body)
                owner.started.set();owner.release.wait(5);audio=wav(.2)
                self.send_response(200);self.send_header('Content-Length',str(len(audio)));self.end_headers();self.wfile.write(audio)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=self.server.serve_forever,daemon=True);thread.start()
        self.addCleanup(self.server.server_close);self.addCleanup(self.server.shutdown)
        self.url=f'http://127.0.0.1:{self.server.server_port}'

    def settings(self,**kw):return self.c.resolve({'service_url':self.url,'recipe':{**self.recipe,**kw}})

    def test_cross_language_frozen_recipe_and_complete_wav(self):
        settings=self.settings();self.recipe['prompt_text']='changed'
        audio=synthesize(settings,'你好。',threading.Event())
        self.assertTrue(audio.startswith(b'RIFF'));self.assertEqual(self.calls[:2],['/set_gpt_weights','/set_sovits_weights'])
        body=self.calls[2];self.assertEqual((body['prompt_lang'],body['text_lang']),('ja','zh'))
        self.assertEqual(body['prompt_text'],'これはテストです。');self.assertFalse(body['streaming_mode'])
        self.assertNotIn(str(self.bundle),json.dumps(settings.recipe))

    def test_switch_failure_never_infers(self):
        self.fail=True
        with self.assertRaisesRegex(Exception,'HTTP 400'):synthesize(self.settings(),'text',threading.Event())
        self.assertEqual(len(self.calls),2)

    def test_cancel_and_serial_model_switch(self):
        self.release.clear();cancel=threading.Event();result=[]
        def run():
            try:synthesize(self.settings(),'first',cancel)
            except JobCancelled:result.append('cancelled')
        first=threading.Thread(target=run);first.start();self.assertTrue(self.started.wait(3));cancel.set()
        second=threading.Thread(target=lambda:synthesize(self.settings(),'second',threading.Event()));second.start()
        time.sleep(.15);self.assertEqual(len(self.calls),3)
        self.release.set();first.join(5);second.join(5)
        self.assertEqual(result,['cancelled']);self.assertEqual(len(self.calls),6)

    def test_trim_keeps_original_and_validates_actual_duration(self):
        original=self.c.store_reference('long.wav',wav(12));self.recipe['speaker_ref']=original['id']
        with self.assertRaisesRegex(ValueError,'3–10'):self.settings()
        out=self.c.action({'action':'trim','id':original['id'],'start':1,'end':5})
        self.assertEqual(out['reference']['sample_count'],64000);self.assertEqual(self.c.reference(original['id'])[0]['sample_count'],192000)
        self.recipe['speaker_ref']=out['reference']['id'];self.settings()

    def test_no_prompt_still_needs_reference_and_v3_rejects(self):
        self.settings(no_prompt=True,prompt_text='')
        with self.assertRaises(ValueError):self.settings(no_prompt=True,speaker_ref='')
        rows=self.c.read('models.json',[])
        for row in rows:
            if row['kind']=='sovits':row['family']='v3'
        self.c.write('models.json',rows)
        with self.assertRaisesRegex(ValueError,'V3/V4'):self.settings(no_prompt=True)

    def test_auxiliary_references_and_preset_roundtrip(self):
        aux=self.c.store_reference('aux.wav',wav(3))
        recipe={**self.recipe,'aux_refs':[aux['id']]}
        self.c.action({'action':'save_preset','name':'pair','recipe':recipe})
        self.assertEqual(self.c.payload()['presets']['pair']['aux_refs'],[aux['id']])
        synthesize(self.settings(aux_refs=[aux['id']]),'text',threading.Event())
        self.assertEqual(len(self.calls[-1]['aux_ref_audio_paths']),1)

    def test_changed_model_rejected_and_paths_not_accepted(self):
        (self.bundle/'GPT_weights'/'voice.ckpt').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'更改'):self.settings()
        with self.assertRaises(ValueError):validate_recipe({'gpt_model':'C:/arbitrary.ckpt'})

    def test_family_header_and_validation(self):
        p=self.bundle/'SoVITS_weights_v2Pro'/'voice.pth'
        self.assertEqual(family_of(p,b'05xxx'),'v2Pro');self.assertEqual(family_of(p,b'06xxx'),'v2ProPlus')
        for key,value in [('speed_factor',float('nan')),('seed',1.5),('aux_refs',['bad']),('top_p',0)]:
            with self.subTest(key=key),self.assertRaises(ValueError):validate_recipe({key:value})

if __name__=='__main__':unittest.main()
