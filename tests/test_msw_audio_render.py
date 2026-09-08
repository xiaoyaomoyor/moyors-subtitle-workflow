from array import array
import copy
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import wave

from maw.ffmpeg import resolve_ffmpeg_tools
from maw.msw.audio_plan import compile_plan
from maw.msw.audio_render import RenderCancelled, probe_source, render, run
from test_msw_audio_plan import FIXTURES


def make_wave(values, rate=24000, channels=1):
    data = array('h', values)
    if sys.byteorder != 'little':
        data.byteswap()
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as writer:
        writer.setparams((channels, 2, rate, 0, 'NONE', 'not compressed'))
        writer.writeframes(data.tobytes())
    return buffer.getvalue()


class AudioRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools = resolve_ffmpeg_tools(configured_path=os.environ.get('MSW_TEST_FFMPEG'))
        if not cls.tools.ffmpeg or not cls.tools.ffprobe:
            raise unittest.SkipTest('FFmpeg / FFprobe unavailable for synthetic audio integration')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.project = copy.deepcopy(FIXTURES[0]['project'])
        self.asset = self.project['msw']['assets'][0]
        # Four constant plateaus reveal wrong trim/gap offsets, not just duration.
        data = make_wave([1000] * 24000 + [2000] * 24000 + [3000] * 24000 + [4000] * 24000)
        self.path = self.root / '素材 音频.wav'
        self.path.write_bytes(data)
        self.asset['sha256'] = hashlib.sha256(data).hexdigest()
        self.cancel = threading.Event()

    def tearDown(self):
        self.temp.cleanup()

    def export(self, **options):
        plan = compile_plan(self.project, {'duration_ms': 7000, **options})
        output = self.root / 'result.wav'
        result = render(plan, output, self.tools.ffmpeg, self.cancel, lambda *_: None, lambda _: (self.asset, self.path))
        with wave.open(str(output), 'rb') as audio:
            self.assertEqual(audio.getnframes(), plan['sample_count'])
            samples = array('h', audio.readframes(audio.getnframes()))
        if sys.byteorder != 'little':
            samples.byteswap()
        return result, lambda seconds, channel=0: samples[round(seconds * plan['sample_rate']) * 2 + channel]

    def test_render_follow_gap_source_offsets_mono_level_and_silence(self):
        _, at = self.export(remove_gaps=True)
        self.assertEqual(at(.5), 0)
        self.assertAlmostEqual(at(1.2), 1000 * 10**(3/20), delta=2)
        self.assertAlmostEqual(at(1.8), 3000 * 10**(3/20), delta=2)
        self.assertEqual(at(1.8), at(1.8, 1))
        self.assertEqual(at(3.8), 0)

    def test_protection_preserves_audio_and_custom_range_rebases(self):
        self.project['msw']['audio_settings']['gap_policy'] = 'protect'
        result, at = self.export(remove_gaps=True, start_ms=1250, end_ms=3500)
        self.assertEqual(result['sample_count'], 108000)
        self.assertAlmostEqual(at(.1), 1000 * 10**(3/20), delta=2)
        self.assertAlmostEqual(at(1.6), 3000 * 10**(3/20), delta=2)

    def test_overlap_gain_and_global_peak_protection_across_bounded_batches(self):
        clip = self.project['msw']['audio_clips'][0]
        self.project['msw']['audio_clips'] = [{**clip, 'id': f'clip-{i}'} for i in range(20)]
        with patch('maw.msw.audio_render.BATCH_INPUTS', 4), patch('maw.msw.audio_render.CHUNK_SECONDS', 1):
            result, at = self.export(end_ms=4500)
        self.assertLess(result['attenuation_db'], -9)
        # Sinc resampling overshoots a plateau boundary slightly. Protection
        # measures those peaks too, while preserving the 1:4 plateau balance.
        self.assertAlmostEqual(at(3.8) / at(1.1), 4, delta=.002)
        self.assertGreater(at(3.8), 30000)
        self.assertLessEqual(at(3.8), 32735)
        self.assertEqual(at(4.4), 0)

    def test_muting_and_disabled_peak_protection(self):
        clip = self.project['msw']['audio_clips'][0]
        clip['gain_db'] = 12
        self.project['msw']['audio_clips'] = [{**clip, 'id': f'clip-{i}', 'muted': i == 19} for i in range(20)]
        result, at = self.export(peak_protection=False, end_ms=2000)
        self.assertTrue(result['clipped'])
        self.assertEqual(result['attenuation_db'], 0)
        self.assertEqual(at(1.6), 32767)

    def test_source_mix_stream_selection_gap_mapping_and_tail_silence(self):
        other = self.root / 'other.wav'
        other.write_bytes(make_wave([-500] * 24000 * 3))
        media = self.root / 'two-tracks.mkv'
        run([str(self.tools.ffmpeg), '-v', 'error', '-y', '-i', str(self.path), '-i', str(other),
             '-map', '0:a', '-map', '1:a', '-c:a', 'pcm_s16le', str(media)], self.cancel)
        info = probe_source(self.tools.ffprobe, media, self.cancel)
        self.assertEqual(len(info['audio_tracks']), 2)
        plan = compile_plan(self.project, {'mode':'mix', 'duration_ms':7000, 'source_audio_index':1, 'remove_gaps':True})
        output = self.root / 'mix.wav'
        with patch('maw.msw.audio_render.CHUNK_SECONDS', 1):
            render(plan, output, self.tools.ffmpeg, self.cancel, lambda *_:None, lambda _: (self.asset,self.path), source=media, source_channels=1)
        with wave.open(str(output), 'rb') as audio:
            values = array('h', audio.readframes(audio.getnframes()))
        at = lambda sec: values[round(sec * 48000) * 2]
        self.assertAlmostEqual(at(.2), -500, delta=1)
        self.assertAlmostEqual(at(1.8), 3000 * 10**(3/20) - 500, delta=2)
        self.assertEqual(at(4.5), 0)

    def test_empty_voice_missing_audio_and_cancel_publish_no_wav(self):
        self.project['msw']['audio_clips'][0]['muted'] = True
        with self.assertRaisesRegex(ValueError, '没有可发声'):
            self.export()
        self.project['msw']['audio_clips'][0]['muted'] = False
        self.asset['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, '发生变化'):
            self.export()
        self.cancel.set()
        with self.assertRaises(RenderCancelled):
            self.export()
        self.assertFalse((self.root/'result.wav').exists())

    def test_fractional_resample_boundary_pads_without_reading_past_source_trim(self):
        clip = self.project['msw']['audio_clips'][0]
        clip.update(start_ms=1,source_in_sample=101,source_out_sample=102,gain_db=3)
        # At 44.1 kHz source frames [101,102) map to [186,187), but
        # timeline [1ms,1ms+1/24ms) maps to [44,46): one padding frame.
        _, at = self.export(sample_rate=44100,end_ms=10)
        self.assertAlmostEqual(at(44/44100),1000,delta=2)
        self.assertEqual(at(45/44100),0)

    def test_unresponsive_process_can_be_cancelled(self):
        timer = threading.Timer(.3, self.cancel.set)
        timer.start()
        started = time.monotonic()
        try:
            with self.assertRaises(RenderCancelled):
                run([sys.executable, '-c', 'import time; time.sleep(20)'], self.cancel)
        finally:
            timer.join()
        self.assertLess(time.monotonic() - started, 4)
