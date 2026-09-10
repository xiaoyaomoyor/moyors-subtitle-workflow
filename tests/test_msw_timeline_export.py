from array import array
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest
import wave
import zipfile

from maw.ffmpeg import resolve_ffmpeg_tools
from maw.msw.audio_plan import compile_plan
from maw.msw.audio_render import RenderCancelled, probe_source, run
from maw.msw.timeline_export import editable_plan, render_bundle
from test_msw_audio_plan import FIXTURES
from test_msw_audio_render import make_wave


def pcm(data, kind):
    position = 12
    while position + 8 <= len(data):
        size = struct.unpack_from('<I', data, position + 4)[0]
        if data[position:position + 4] == b'data':
            result = array(kind)
            result.frombytes(data[position + 8:position + 8 + size])
            if sys.byteorder != 'little':
                result.byteswap()
            return result
        position += 8 + size + size % 2
    raise AssertionError('WAV missing PCM payload')


class TimelineExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools = resolve_ffmpeg_tools(configured_path=os.environ.get('MSW_TEST_FFMPEG'))
        if not cls.tools.complete:
            raise unittest.SkipTest('FFmpeg / FFprobe unavailable')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cancel = threading.Event()
        self.project = copy.deepcopy(FIXTURES[0]['project'])
        self.project['segments'] = [dict(id='cue', start=1000, end=3500, text='配音测试')]
        self.asset = self.project['msw']['assets'][0]
        self.audio = self.root / 'voice.wav'
        self.data = make_wave([1000] * 24000 + [2000] * 24000 + [3000] * 24000 + [4000] * 24000)
        self.audio.write_bytes(self.data)
        self.asset['sha256'] = hashlib.sha256(self.data).hexdigest()
        first = self.project['msw']['audio_clips'][0]
        self.project['msw']['audio_clips'] += [{**first, 'id': 'overlap', 'gain_db': -2}, {**first, 'id': 'muted', 'muted': True}]
        self.source = self.root / 'video.mp4'
        run([str(self.tools.ffmpeg), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24:duration=4',
             '-i', str(self.audio), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', str(self.source)], self.cancel)
        self.info = probe_source(self.tools.ffprobe, self.source, self.cancel)

    def tearDown(self):
        self.temp.cleanup()

    def export(self, *, source=True, progress=None, **options):
        settings = {**dict(mode='mix' if source else 'voice', duration_ms=6000, remove_gaps=True,
                          voice_gain_db=2, source_gain_db=-3, collect_media=True), **options}
        plan = compile_plan(self.project, settings)
        path = self.root / 'result.otioz'
        result = render_bundle(self.project, plan, path, self.tools, self.cancel, progress or (lambda *_: None),
                               lambda _: (self.asset, self.audio), source=self.source if source else None,
                               source_channels=1, info=self.info if source else {}, settings=settings)
        return result, plan, path

    def test_packaged_timeline_has_portable_refs_overlap_lanes_and_silent_muted_clips(self):
        result, plan, path = self.export()
        with zipfile.ZipFile(path) as package:
            timeline = json.loads(package.read('content.otio'))
            self.assertEqual(package.read('version.txt'), b'1.0.0')
            self.assertEqual(package.read(f"originals/{self.asset['id']}.wav"), self.data)
            tracks = timeline['tracks']['children']
            self.assertEqual([t['kind'] for t in tracks], ['Video', 'Audio', 'Audio', 'Audio', 'Audio'])
            for t in tracks:
                total = 0
                for c in t['children']:
                    duration = c['source_range']['duration']
                    total += duration['value'] / duration['rate']
                    if c['OTIO_SCHEMA'] != 'Clip.2':
                        continue
                    url = c['media_references']['DEFAULT_MEDIA']['target_url']
                    self.assertIn(url, package.namelist())
                    self.assertNotIn('..', url)
                    if not c['enabled']:
                        self.assertEqual(max(map(abs, pcm(package.read(url), 'f'))), 0)
                self.assertAlmostEqual(total, plan['sample_count'] / plan['sample_rate'], places=6)
            self.assertEqual(result['editable_clip_count'], 6)
            self.assertIn('00:00:01,500 --> 00:00:02,500', package.read('subtitles/track-1.srt').decode('utf-8-sig'))
            self.assertEqual(len(timeline['tracks']['markers']), 2)
            self.assertNotIn('project.mosp', package.namelist())

    def test_sum_of_editable_float_clips_matches_canonical_reference_mix(self):
        _, plan, path = self.export()
        with zipfile.ZipFile(path) as package:
            reference = pcm(package.read('reference/mix.wav'), 'h')
            rendered = array('f', [0]) * len(reference)
            for t in json.loads(package.read('content.otio'))['tracks']['children']:
                if t['kind'] != 'Audio':
                    continue
                cursor = 0
                for c in t['children']:
                    duration = c['source_range']['duration']
                    frames = round(duration['value'] / duration['rate'] * plan['sample_rate'])
                    if c['OTIO_SCHEMA'] == 'Clip.2':
                        url = c['media_references']['DEFAULT_MEDIA']['target_url']
                        samples = pcm(package.read(url), 'f')
                        self.assertEqual(len(samples), frames * 2)
                        for i, value in enumerate(samples):
                            rendered[cursor * 2 + i] += value
                    cursor += frames
            self.assertLessEqual(max(abs(a - max(-32768, min(32767, round(b * 32768)))) for a, b in zip(reference, rendered)), 2)

    def test_muted_clips_do_not_change_gap_protection(self):
        self.project['msw']['audio_settings']['gap_policy'] = 'protect'
        self.project['msw']['audio_clips'] = [{**self.project['msw']['audio_clips'][0], 'muted': True}]
        plan = compile_plan(self.project, dict(duration_ms=6000, remove_gaps=True))
        edited = editable_plan(self.project, plan)
        self.assertEqual(plan['intervals'], edited['intervals'])
        self.assertEqual(plan['pieces'], [])
        self.assertEqual(len(edited['pieces']), 2)

    def test_optional_original_video_and_audio_only_project(self):
        result, _, path = self.export(collect_media=False)
        self.assertTrue(result['external_media'])
        with zipfile.ZipFile(path) as package:
            video = json.loads(package.read('content.otio'))['tracks']['children'][0]
            url = video['children'][0]['media_references']['DEFAULT_MEDIA']['target_url']
            self.assertEqual(url, self.source.resolve().as_uri())
            self.assertNotIn('media/source.mp4', package.namelist())
        _, _, path = self.export(source=False)
        with zipfile.ZipFile(path) as package:
            self.assertTrue(all(t['kind'] == 'Audio' for t in json.loads(package.read('content.otio'))['tracks']['children']))

    def test_cancel_packaging_does_not_publish(self):
        def progress(stage, value):
            if stage == 'packaging':
                self.cancel.set()
        with self.assertRaises(RenderCancelled):
            self.export(progress=progress)
        self.assertFalse((self.root / 'result.otioz').exists())

    def test_original_audio_is_padded_when_exporting_beyond_source_end(self):
        _, plan, path = self.export(start_ms=4500, end_ms=6000, remove_gaps=False)
        with zipfile.ZipFile(path) as package:
            data = pcm(package.read('media/original-000000.wav'), 'f')
            self.assertEqual(len(data), plan['sample_count'] * 2)
            self.assertEqual(max(map(abs, data)), 0)

    def test_official_otio_parser_accepts_timeline(self):
        try:
            import opentimelineio as otio
        except ImportError:
            self.skipTest('Optional official OTIO validator unavailable')
        _, plan, path = self.export()
        moved = self.root / 'moved'
        moved.mkdir()
        timeline = otio.adapters.read_from_file(str(path), adapter_name='otioz', extract_to_directory=str(moved))
        self.assertAlmostEqual(timeline.duration().to_seconds(), plan['sample_count'] / plan['sample_rate'], places=6)
        self.assertEqual(len(list(timeline.find_clips())), 10)
        for c in timeline.find_clips():
            self.assertTrue((moved / c.media_reference.target_url).is_file())

    def test_peak_protection_is_shared_across_all_derivatives(self):
        first = self.project['msw']['audio_clips'][0]
        self.project['msw']['audio_clips'] = [{**first, 'id': f'clip-{i}', 'gain_db': 12} for i in range(4)]
        result, _, path = self.export()
        self.assertLess(result['attenuation_db'], -3)
        with zipfile.ZipFile(path) as package:
            with wave.open(io.BytesIO(package.read('reference/mix.wav')), 'rb') as wav:
                values = array('h', wav.readframes(wav.getnframes()))
                self.assertLessEqual(max(map(abs, values)), 32736)
