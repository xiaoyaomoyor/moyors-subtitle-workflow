import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event

from maw.media import resolve_project_media
from maw.msw.assets import AssetStore
from maw.msw.tts import DEFAULT_RECIPE
from maw.postprocess_io import read_project, render_srt
from maw.postprocess_pipeline import normalize_plan, run_postprocess_pipeline
from tests.test_msw_output_layout import wav_bytes


class Beta6PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.media = self.root / 'media.wav'
        self.media.write_bytes(wav_bytes())
        self.env = self.root / 'isolated.env'
        self.env.write_text('', encoding='utf-8')
        self.plan = {'enabled': True, 'outputSemantics': 'separate-v2',
            'outputSrtPath': str(self.root / 'chosen' / 'result.srt'),
            'steps': [{'id': 'replace', 'enabled': True, 'replacements': [{'source': 'wrong', 'target': 'right'}]}]}

    def run_pipeline(self, project, **kwargs):
        return run_postprocess_pipeline(self.plan, project_path=project, media_path=self.media,
            srt_path=self.root / 'not-created-yet.srt', env_path=self.env, ffmpeg_path=None,
            cancel_event=Event(), ui_language='en', **kwargs)

    def test_zero_snapshot_and_numbered_assets_survive_temporary_input_and_cache(self):
        with TemporaryDirectory(dir=self.root) as directory:
            temporary = Path(directory)
            source = temporary / 'input.mosp'
            store = AssetStore(temporary / 'cache')
            cue = {'key': 'cue', 'id': 'cue', 'track_id': None, 'start': 0, 'end': 1000, 'text': 'wrong'}
            asset = store.add('beta6-project', 'job', cue, DEFAULT_RECIPE, wav_bytes())
            project = {'media': str(self.media), 'segments': [{'id': 'cue', 'start': 0, 'end': 1000, 'text': 'wrong'}],
                'msw': {'schema': 'msw.editor.v1', 'project_id': 'beta6-project', 'assets': [asset],
                    'audio_tracks': [{'id': 'voice', 'name': 'Voice', 'gain_db': -2, 'muted': False}],
                    'audio_clips': [{'id': 'clip', 'asset_id': asset['id'], 'track_id': 'voice', 'start_ms': 250,
                        'source_in_sample': 0, 'source_out_sample': 2400, 'playback_rate': 1, 'gain_db': -1,
                        'muted': False, 'label': 'Voice'}]}}
            store.persist_project(project, source)
            source.write_text(json.dumps(project), encoding='utf-8')
            result = self.run_pipeline(source)
        self.assertFalse(source.exists())
        manifest = json.loads((result.run_directory / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(Path(manifest['initialProjectPath']).name, 'media.postprocess.0.original.mosp')
        self.assertIn('wrong', Path(manifest['initialSrtPath']).read_text(encoding='utf-8'))
        self.assertEqual(Path(manifest['steps'][0]['projectPath']).name, 'media.postprocess.1.replace.mosp')
        self.assertEqual(manifest['nextArtifactIndex'], 2)
        self.assertEqual(result.project_path.parent, self.root / 'chosen')
        fresh = AssetStore(self.root / 'fresh-cache')
        for path in [*result.run_directory.glob('*.mosp'), result.project_path]:
            restored = read_project(path)
            self.assertEqual(restored['msw']['assets'], project['msw']['assets'])
            self.assertEqual(restored['msw']['audio_clips'], project['msw']['audio_clips'])
            self.assertEqual(resolve_project_media(path, restored).resolved_path, self.media)
            self.assertEqual(fresh.resolve('beta6-project', asset, path).read_bytes(), wav_bytes())

    def test_legacy_manifest_retains_input_and_unrecorded_number_is_not_reused(self):
        run = self.root / 'old-run'
        run.mkdir()
        source = run / 'input.mosp'
        data = {'segments': [{'id': 'cue', 'start': 0, 'end': 1000, 'text': 'wrong'}]}
        source.write_text(json.dumps(data), encoding='utf-8')
        srt = run / 'input.srt'
        srt.write_text(render_srt(data), encoding='utf-8')
        manifest = {'version': 1, 'sourceProjectPath': str(source), 'sourceSrtPath': str(srt),
                    'steps': [{'id': 'replace', 'status': 'pending'}]}
        (run / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        orphan = run / 'media.postprocess.9.replace.mosp'
        orphan.write_text('diagnostic from interrupted write', encoding='utf-8')
        result = self.run_pipeline(source, resume_directory=run)
        restored = json.loads((run / 'manifest.json').read_text(encoding='utf-8'))
        self.assertNotIn('initialProjectPath', restored)
        self.assertEqual(restored['sourceProjectPath'], str(source))
        self.assertEqual(source.read_text(encoding='utf-8'), json.dumps(data))
        self.assertTrue(srt.exists())
        self.assertEqual(orphan.read_text(encoding='utf-8'), 'diagnostic from interrupted write')
        self.assertEqual(restored['nextArtifactIndex'], 11)
        self.assertEqual(Path(restored['steps'][0]['projectPath']).name, 'media.postprocess.10.replace.mosp')
        self.assertEqual(read_project(result.project_path)['segments'][0]['text'], 'right')

    def test_default_retention_preserves_explicit_false(self):
        for raw, expected in [({}, True), ({'retainIntermediate': False}, False),
                              ({'retainIntermediate': True}, True), ({'retainIntermediate': None}, True)]:
            self.assertEqual(normalize_plan(raw)['retainIntermediate'], expected)
