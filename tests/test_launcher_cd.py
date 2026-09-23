"""C/D integration contracts: actual subtitle content, preservation and cache identity."""
import copy
import base64
import hashlib
import json
import shutil
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

from maw import launcher_queue as queue, media_cache, quapeaks, mopeaks
from maw.gui_web import LauncherApi, LauncherPaths
from maw.postprocess_io import SubtitleArtifact, read_project, render_srt, write_derived_project
from maw.postprocess_pipeline import run_postprocess_pipeline, normalize_plan
from maw.waveform import media_signature, extract_waveform
from tests.test_media_cache import _make_tone
from tests.test_launcher_r4 import _complex_project
from maw.msw.assets import audio_info
from maw.project import normalize_project


class LauncherCDTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.env = self.root / 'isolated.env'
        self.env.write_text('', encoding='utf-8')
        self.media = self.root / 'tone.wav'
        _make_tone(self.media, seconds=0.2)
        self.source = self.root / 'source.mosp'
        self.data = {'media': str(self.media), 'segments': [{'id': 'main-1', 'start': 0, 'end': 200, 'text': 'Original', 'color': {'value': '#abcdef'}}],
                     'multi_subtitle': {'schema': 'moy.asr.multi_subtitle.v1', 'enabled': True, 'tracks': [{'id': 'manual', 'role':'extension', 'split_mode':'word', 'segments': [{'id': 'sub-1', 'start': 0, 'end': 200, 'text': 'Keep secondary'}]}], 'bindings': []},
                     'audio_patches': [{'id': 'patch', 'tts_recipe': {'provider': 'test'}}],
                     'subtitle_assets': [{'text': 'Keep asset'}], 'future_extension': {'keep': True}}
        self.source.write_text(json.dumps(self.data), encoding='utf-8')
        self.srt = self.root / 'source.srt'
        self.srt.write_text(render_srt(self.data), encoding='utf-8')
        self.tools = SimpleNamespace(ffmpeg=None, ffprobe=None)
        self.settings = {'deepseek': {'apiKey': 'test-only', 'baseUrl': 'https://example.test', 'model': 'test', 'verified': '1'}}

    def translate(self, request, **kwargs):
        data = read_project(request.project_path)
        for segment in data['segments']:
            segment['text'] = '译文'
        target = request.output_directory / 'translated.mosp'
        write_derived_project(data, target, request.project_path)
        srt = target.with_suffix('.srt')
        srt.write_text(render_srt(data), encoding='utf-8')
        return SubtitleArtifact(request.project_path, request.srt_path, target, srt)

    def plan(self, mode='secondary', **output):
        return {'enabled': True, 'outputSemantics': 'separate-v2', 'outputSrtPath': str(self.root / 'out' / 'result.srt'),
                'exportSrt': True, 'exportTranslatedSrt': True, 'exportBilingualSrt': True, **output,
                'steps': [{'id': 'translate', 'enabled': True, 'providerId': 'deepseek', 'target': 'zh',
                           'mergeBilingual': mode == 'bilingual', 'embedTranslations': mode == 'backfill', 'bilingualLineOrder': 'original_first'}]}

    def execute(self, plan, **resume):
        with patch('maw.postprocess_pipeline.run_llm_postprocess', side_effect=self.translate):
            return run_postprocess_pipeline(plan, media_path=self.media, project_path=self.source,
                srt_path=self.srt, env_path=self.env, ffmpeg_path=None, cancel_event=Event(), llm_settings=self.settings, **resume)

    def test_three_translation_modes_keep_original_and_raw_translation_separate(self):
        for mode in ('secondary', 'backfill', 'bilingual'):
            with self.subTest(mode=mode):
                result = self.execute(self.plan(mode))
                self.assertIn('Original', result.srt_path.read_text(encoding='utf-8'))
                self.assertNotIn('译文', result.srt_path.read_text(encoding='utf-8'))
                self.assertIn('译文', result.translated_srt_path.read_text(encoding='utf-8'))
                self.assertNotIn('Original', result.translated_srt_path.read_text(encoding='utf-8'))
                data = read_project(result.project_path)
                self.assertEqual(data['segments'][0]['text'], {'secondary':'Original','backfill':'译文','bilingual':'Original\n译文'}[mode])
                for key in ('audio_patches','subtitle_assets','future_extension'):
                    self.assertEqual(data[key], self.data[key])
                self.assertEqual(data['multi_subtitle']['tracks'][0], self.data['multi_subtitle']['tracks'][0])
                if mode == 'bilingual':
                    self.assertIn('Original\n译文', result.bilingual_srt_path.read_text(encoding='utf-8'))
                else:
                    self.assertIsNone(result.bilingual_srt_path)
        self.assertEqual(json.loads(self.source.read_text()), self.data)

    def test_independent_output_switches_and_bilingual_order(self):
        plan = self.plan('bilingual', exportSrt=False, exportTranslatedSrt=False)
        plan['steps'][0]['bilingualLineOrder'] = 'translation_first'
        result = self.execute(plan)
        self.assertIsNone(result.srt_path)
        self.assertIsNone(result.translated_srt_path)
        self.assertIn('译文\nOriginal', result.bilingual_srt_path.read_text(encoding='utf-8'))

    def test_existing_output_renames_whole_group(self):
        destination = self.root / 'out'
        destination.mkdir()
        previous = destination / 'result.translated.srt'
        previous.write_text('keep', encoding='utf-8')
        result = self.execute(self.plan())
        self.assertEqual(result.project_path.stem, 'result-1')
        self.assertEqual(result.srt_path.stem, 'result-1')
        self.assertEqual(previous.read_text(), 'keep')

    def test_resume_completed_translation_uses_original_snapshot(self):
        plan = self.plan('bilingual', retainIntermediate=True)
        first = self.execute(plan)
        manifest = json.loads((first.run_directory / 'manifest.json').read_text(encoding='utf-8'))
        last = manifest['steps'][-1]
        result = self.execute(plan, resume_directory=first.run_directory, resume_from=1,
                              resume_project_path=Path(last['projectPath']), resume_srt_path=Path(last['srtPath']))
        self.assertIn('Original', result.srt_path.read_text(encoding='utf-8'))
        self.assertNotIn('译文', result.srt_path.read_text(encoding='utf-8'))
        self.assertIn('译文', result.translated_srt_path.read_text(encoding='utf-8'))

    def test_ocr_model_and_output_draft_survive_normalization(self):
        result = normalize_plan({'steps': [{'id': 'ocr', 'modelId': 'custom'}], 'outputDraft': {'directory': 'saved', 'srtOnly': True, 'apiKey': 'discard'}})
        self.assertEqual(next(s for s in result['steps'] if s['id'] == 'ocr')['modelId'], 'custom')
        self.assertEqual(result['outputDraft'], {'directory': 'saved', 'srtOnly': True})

    def test_queue_only_bilingual_srt_does_not_publish_project(self):
        plan = {'version': 2, 'tasks': [{'id':'one','path':str(self.source)}], 'modules': {'postprocess':['translate']},
                'postprocess': self.plan('bilingual'), 'output': {'directory':str(self.root/'only'),'srtOnly':True,'exportSrt':False,'exportTranslatedSrt':False,'exportBilingualSrt':True}}
        with patch.object(queue, 'validate_plan', side_effect=lambda p, **kw: (normalize_plan(p), [])), patch.object(queue, 'snapshot_postprocess_llm_settings', return_value=self.settings):
            tasks, errors = queue.prepare_queue(plan, env_path=self.env, tools=self.tools, request_builder=lambda p: None)
        self.assertFalse(errors)
        with patch('maw.postprocess_pipeline.run_llm_postprocess', side_effect=self.translate):
            result = queue.run_task(tasks[0], env_path=self.env, tools=self.tools, cancel=Event(), emit=lambda e: None)
        self.assertFalse(result['projectPath'])
        self.assertTrue(Path(result['bilingualSrtPath']).is_file())
        self.assertFalse(list((self.root/'only').rglob('*.mosp')))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is required')
    def test_real_waveform_cache_reuse_track_identity_and_failed_rebuild(self):
        payload = extract_waveform(self.media)
        data = {**self.data, 'waveform':payload, 'spectral':{'schema':quapeaks.SPECTRAL_SCHEMA, 'source':media_signature(self.media),'audio_track':0,'peak_count':1}}
        with patch.object(quapeaks, 'generate_for_media', return_value=None), patch.object(media_cache, 'embed_waveform', side_effect=AssertionError('must reuse')):
            result = media_cache.embed_media_caches(data, self.media, reuse_existing=True)
        self.assertEqual(result.project['spectral'], data['spectral'])
        self.assertEqual(result.project['future_extension'], data['future_extension'])
        with patch.object(quapeaks, 'generate_for_media', return_value=None), patch.object(media_cache, 'embed_waveform', return_value=SimpleNamespace(project={**self.data}, error=ValueError('failure'))):
            result = media_cache.embed_media_caches(data, self.media, reuse_existing=True, force_rebuild=True)
        self.assertEqual(result.project['waveform'], payload)
        self.assertIsNotNone(result.waveform_error)
        with patch.object(quapeaks, 'generate_for_media', return_value=None), patch.object(media_cache, 'load_or_extract_waveform', return_value=({**payload,'audio_track':1},True)) as loader:
            result = media_cache.embed_media_caches(data, self.media, reuse_existing=True, audio_track=1)
        self.assertIsNone(loader.call_args.args[0])
        self.assertNotIn('spectral', result.project)

    def test_cancelled_cache_request_does_not_decode(self):
        cancel = Event(); cancel.set()
        with patch.object(media_cache, 'embed_waveform') as decode, self.assertRaises(media_cache.MediaCacheCancelled):
            media_cache.embed_media_caches(self.data, self.media, reuse_existing=True, cancel_event=cancel)
        decode.assert_not_called()

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is required')
    def test_force_rebuild_replaces_a_valid_but_unwanted_fallback_cache(self):
        payload = extract_waveform(self.media)
        silent = {**payload, 'data': base64.b64encode(bytes(len(base64.b64decode(payload['data'])))).decode('ascii')}
        mopeaks.save_mopeaks(silent, self.media)
        with patch.object(quapeaks, 'generate_for_media', return_value=None):
            result = media_cache.embed_media_caches(self.data, self.media, reuse_existing=True, force_rebuild=True)
        self.assertNotEqual(result.project['waveform']['data'], silent['data'])
        self.assertEqual(mopeaks.load_mopeaks(self.media)['data'], payload['data'])

    def test_srt_only_rejects_blank_placeholder_cues(self):
        self.data['segments'][0]['text'] = ' '
        self.source.write_text(json.dumps(self.data), encoding='utf-8')
        plan = {'version':2,'tasks':[{'id':'one','path':str(self.source)}],'modules':{},'output':{'srtOnly':True}}
        tasks, errors = queue.prepare_queue(plan, env_path=self.env, tools=self.tools, request_builder=lambda p: None)
        self.assertFalse(tasks)
        self.assertEqual(errors[0]['module'], 'output')

    def test_waveform_tool_rejects_subtitles_and_missing_media(self):
        api = LauncherApi(paths=LauncherPaths(root=self.root, env_path=self.env, launcher_html=self.root/'index.html', recent_metadata=self.root/'recent.json', project_registry=self.root/'registry.json'))
        with patch('maw.gui_web._postprocess_ffmpeg_tools', return_value=self.tools):
            result = api.start_waveform_tool({'path':str(self.srt)})
        self.assertFalse(result['ok'])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is required')
    def test_waveform_tool_real_media_preserves_complex_project_and_asset_bytes(self):
        data = _complex_project(self.root)
        data['media'] = str(self.media)
        asset = data['msw']['assets'][0]
        audio = self.media.read_bytes()
        asset.update(audio_info(audio))
        asset['sha256'] = hashlib.sha256(audio).hexdigest()
        data['msw']['audio_clips'][0]['source_out_sample'] = asset['sample_count']
        audio_path = self.root / asset['path']
        audio_path.parent.mkdir(parents=True)
        audio_path.write_bytes(audio)
        self.source.write_text(json.dumps(data), encoding='utf-8')
        original_bytes = self.source.read_bytes()
        expected = normalize_project(data)
        paths = LauncherPaths(root=self.root, env_path=self.env, launcher_html=self.root/'index.html', recent_metadata=self.root/'recent.json', project_registry=self.root/'registry.json')
        api = LauncherApi(paths=paths)
        events = []
        api._emit = events.append
        with patch('maw.gui_web._postprocess_ffmpeg_tools', return_value=self.tools):
            result = api.start_waveform_tool({'path':str(self.source),'directory':str(self.root/'wave'),'spectral':True})
            self.assertTrue(result['ok'], result)
            api.waveform_worker.join(15)
        self.assertFalse(api.waveform_worker.is_alive())
        terminal = events[-1]
        self.assertEqual(terminal['status'], 'completed', terminal)
        target = Path(terminal['projectPath'])
        output = read_project(target)
        for key in ('msw','multi_subtitle','segments','time_selection','workspace','custom_future_extension'):
            self.assertEqual(output[key], expected[key])
        self.assertEqual((target.parent / asset['path']).read_bytes(), audio)
        self.assertEqual(self.source.read_bytes(), original_bytes)
        self.assertTrue(paths.project_registry.exists())
        self.assertFalse(api.cancel_waveform_tool({'taskId':'old'})['cancelled'])

    def test_custom_original_path_is_independent_and_never_overwrites_source(self):
        for post in ([], ['replace']):
            with self.subTest(post=post):
                plan = {'version':2,'tasks':[{'id':'one','path':str(self.source)}],
                        'modules':{'postprocess':post}, 'output':{'directory':str(self.root/'projects'),'srtPath':str(self.srt)},
                        'postprocess':{'steps':[{'id':'replace','enabled':True,'replacements':[{'source':'Original','target':'Edited'}],'conversion':'off'}]}}
                tasks, errors = queue.prepare_queue(plan, env_path=self.env, tools=self.tools, request_builder=lambda p: None)
                self.assertFalse(errors)
                result = queue.run_task(tasks[0], env_path=self.env, tools=self.tools, cancel=Event(), emit=lambda e: None)
                self.assertEqual(Path(result['projectPath']).parent, self.root/'projects')
                self.assertEqual(Path(result['srtPath']).parent, self.root)
                self.assertNotEqual(Path(result['srtPath']), self.srt)
                self.assertIn('Original', self.srt.read_text(encoding='utf-8'))
        self.assertEqual(len(list((self.root/'projects').glob('*.mosp'))), 2)

    def test_all_srt_disabled_still_publishes_project_only(self):
        result = self.execute(self.plan(exportSrt=False,exportTranslatedSrt=False,exportBilingualSrt=False))
        self.assertTrue(result.project_path.exists())
        self.assertIsNone(result.srt_path)
        self.assertIsNone(result.translated_srt_path)
        self.assertIsNone(result.bilingual_srt_path)

    def test_waveform_tool_blocks_legacy_operations_while_running(self):
        from unittest.mock import Mock
        api = LauncherApi(paths=LauncherPaths(root=self.root,env_path=self.env,launcher_html=self.root/'index.html'))
        api.waveform_worker = Mock(is_alive=Mock(return_value=True))
        for method in ('run_extract_audio','start_transcription','start_prefab_queue','start_waveform_tool'):
            self.assertFalse(getattr(api, method)({})['ok'])


if __name__ == '__main__':
    unittest.main()
