import asyncio
import tempfile
import threading
import time
from pathlib import Path
import unittest
from unittest.mock import patch

from maw.msw.edge_tts import EdgeTts, Settings, DEFAULT_RECIPE, validate_recipe, synthesize, guarded
from maw.msw.jobs import JobCancelled
from test_msw_gpt_sovits import wav


class EdgeTests(unittest.TestCase):
    def test_job_manager_accepts_edge_identity_and_keeps_secondary_source(self):
        from maw.msw.assets import AssetStore
        from maw.msw.jobs import JobManager, TERMINAL
        from maw.msw.tts import TtsService
        assets=AssetStore(Path(self.temp.name)/'assets')
        manager=JobManager(Path(self.temp.name)/'jobs.sqlite3',tts=TtsService(assets))
        def close():
            manager.close()
            self.assertTrue(manager.close_complete.wait(5))
        self.addCleanup(close)
        snapshot={'project_id':'test','entries':[{'key':'entry','id':'cue','track_id':'secondary','text':'Hello','start':0,'end':1000}]}
        with patch('maw.msw.edge_tts.synthesize',return_value=wav(.2)):
            job=manager.submit({'kind':'tts','project_id':'test','request_key':'one','snapshot':snapshot},Settings(DEFAULT_RECIPE,120,self.c))
            deadline=time.monotonic()+4
            while time.monotonic()<deadline:
                result=manager.get(job['id'],'test')
                if result['status'] in TERMINAL:break
                time.sleep(.01)
            self.assertEqual(result['status'],'succeeded')
        asset=assets.list('test')['assets'][0]
        self.assertEqual(asset['source_ref']['track_id'],'secondary')

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.converted=[]
        def convert(data,suffix,**kw):self.converted.append((data,suffix));return wav(.2)
        self.c=EdgeTts(self.temp.name,convert)

    def test_units_language_and_frozen_settings(self):
        r=validate_recipe({'voice':'ja-JP-NanamiNeural','language_type':'zh-CN','rate':-10,'pitch':20})
        self.assertEqual(r['language_type'],'ja-JP')
        with patch('maw.msw.edge_tts.dependency',return_value={'ready':True}):s=self.c.resolve({'recipe':r})
        r['rate']=50;self.assertEqual(s.recipe['rate'],-10)
        for key,value in [('voice','bad'),('pitch',200),('volume',float('nan')),('rate',True)]:
            with self.subTest(key=key),self.assertRaises(ValueError):validate_recipe({key:value})

    def test_full_stream_then_convert_and_no_timing_requirement(self):
        calls=[]
        class Client:
            def __init__(self,*a,**kw):calls.append((a,kw))
            async def stream(self):
                yield {'type':'audio','data':b'first'}
                yield {'type':'SentenceBoundary','offset':1}
                yield {'type':'audio','data':b'last'}
        with patch('edge_tts.Communicate',Client):
            audio=synthesize(Settings(dict(DEFAULT_RECIPE,rate=-25,pitch=5),30,self.c),'hello',threading.Event())
        self.assertTrue(audio.startswith(b'RIFF'));self.assertEqual(self.converted,[(b'firstlast','.mp3')])
        self.assertEqual(calls[0][1]['rate'],'-25%');self.assertEqual(calls[0][1]['pitch'],'+5Hz')

    def test_disconnect_does_not_convert_partial_audio(self):
        class Client:
            def __init__(self,*a,**kw):pass
            async def stream(self):
                yield {'type':'audio','data':b'partial'}
                raise ConnectionError()
        with patch('edge_tts.Communicate',Client),self.assertRaisesRegex(Exception,'连接中断'):
            synthesize(Settings(DEFAULT_RECIPE,30,self.c),'hello',threading.Event())
        self.assertEqual(self.converted,[])

    def test_cancel_closes_stream(self):
        cancel=threading.Event();closed=[]
        async def task():
            try:
                cancel.set();await asyncio.sleep(30)
            finally:closed.append(True)
        with self.assertRaises(JobCancelled):asyncio.run(guarded(task(),cancel,threading.Event(),5))
        self.assertEqual(closed,[True])

    def test_cache_preserved_on_failure_and_refresh_validates_voices(self):
        async def catalog():return [{'ShortName':'en-US-JennyNeural','Gender':'Female'}]
        with patch('edge_tts.list_voices',catalog),patch('maw.msw.edge_tts.dependency',return_value={'ready':True}):
            out=self.c.action({'action':'refresh'})
        self.assertEqual(out['voices'][0]['language'],'en-US')
        async def fail():raise OSError()
        with patch('edge_tts.list_voices',fail),patch('maw.msw.edge_tts.dependency',return_value={'ready':True}),self.assertRaises(Exception):
            self.c.action({'action':'refresh'})
        self.assertEqual(self.c.payload()['voices'],out['voices'])

    def test_conversion_failure_is_not_success(self):
        class Client:
            def __init__(self,*a,**kw):pass
            async def stream(self):yield {'type':'audio','data':b'mp3'}
        self.c.converter=lambda *a,**kw: (_ for _ in ()).throw(ValueError('conversion failed'))
        with patch('edge_tts.Communicate',Client),self.assertRaisesRegex(ValueError,'conversion failed'):
            synthesize(Settings(DEFAULT_RECIPE,30,self.c),'hello',threading.Event())

if __name__=='__main__':unittest.main()
