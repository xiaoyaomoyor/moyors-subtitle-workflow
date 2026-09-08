import copy
import hashlib
from array import array
import math
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from maw.ffmpeg import resolve_ffmpeg_tools
from maw.msw.audio_render import RenderCancelled, probe_source, run
from maw.msw.video_render import prepare, render_video
from test_msw_audio_plan import FIXTURES
from test_msw_audio_render import make_wave


class VideoRenderTests(unittest.TestCase):
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
        self.asset = self.project['msw']['assets'][0]
        data = make_wave([2000] * 96000)
        self.audio = self.root / 'voice.wav'
        self.audio.write_bytes(data)
        self.asset['sha256'] = hashlib.sha256(data).hexdigest()
        self.source = self.root / '原视频.mp4'
        run([str(self.tools.ffmpeg), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24:duration=4',
             '-i', str(self.audio), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p',
             '-c:a', 'aac', str(self.source)], self.cancel)
        self.info = probe_source(self.tools.ffprobe, self.source, self.cancel)
        self.project['segments'] = []
        self.settings = dict(mode='mix', duration_ms=4000, video_tail='ask', video_encoding='auto')

    def tearDown(self):
        self.temp.cleanup()

    def export(self, **settings):
        selected = {**self.settings, **settings}
        plan = prepare(self.project, selected, self.info)
        output = self.root / 'result.mp4'
        result = render_video(plan, output, self.tools, self.cancel, lambda *_: None,
                              lambda _: (self.asset, self.audio), source=self.source, source_channels=1,
                              info=self.info, settings=selected, project=self.project)
        actual = probe_source(self.tools.ffprobe, output, self.cancel)
        self.assertAlmostEqual(actual['duration_ms'], plan['sample_count'] / 48, delta=80)
        self.assertEqual(len(actual['audio_tracks']), 1)
        return result, plan, output

    def test_complete_compatible_picture_is_copied_and_audio_mixed(self):
        result, _, output = self.export(video_tail='truncate')
        self.assertEqual(result['video_encoding'], 'copy')
        # Packet payload checksums prove the picture was not recompressed.
        def packets(path):
            with tempfile.TemporaryFile() as data:
                run([str(self.tools.ffprobe), '-v', 'error', '-select_streams', 'v:0', '-show_packets',
                     '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'csv=p=0', str(path)],
                    self.cancel, stdout=data)
                data.seek(0)
                return data.read()
        self.assertEqual(packets(self.source), packets(output))

    def test_tail_requires_explicit_decision_and_can_freeze(self):
        with self.assertRaisesRegex(ValueError, '超出画面尾部'):
            self.export(duration_ms=6000)
        result, plan, _ = self.export(duration_ms=6000, video_tail='freeze')
        self.assertEqual(plan['sample_count'], 288000)
        self.assertEqual(result['video_encoding'], 'h264')

    def test_follow_gaps_and_custom_range_use_same_sound_picture_clock(self):
        with patch('maw.msw.video_render.CHUNK_SECONDS', .5):
            result, plan, _ = self.export(start_ms=1000, end_ms=3500, remove_gaps=True)
        self.assertEqual(result['video_encoding'], 'h264')
        self.assertEqual(plan['sample_count'], 72000)

    def test_subtitles_are_burned_after_gap_mapping_and_across_encoding_chunks(self):
        run([str(self.tools.ffmpeg), '-v', 'error', '-y', '-f', 'lavfi', '-i',
             'color=black:size=320x180:rate=24:duration=4', '-c:v', 'libx264', '-threads', '1', str(self.source)], self.cancel)
        self.info = probe_source(self.tools.ffprobe, self.source, self.cancel)
        self.project['segments'] = [dict(start=1000, end=3000, text='MAIN')]
        self.project['multi_subtitle'] = {'tracks': [{'segments': [dict(start=1000, end=3000, text='SECONDARY')]}]}
        self.project['msw']['audio_settings']['gap_policy'] = 'follow'
        self.project['gap_remove'] = {'gaps': [dict(start=1500, end=2500, removed=True)]}
        with patch('maw.msw.video_render.CHUNK_SECONDS', .5):
            result, _, output = self.export(mode='voice', remove_gaps=True, burn_subtitles='both')
        self.assertEqual(result['video_encoding'], 'h264')
        self.assertEqual(result['burn_subtitles'], 'both')
        def frame(at):
            with tempfile.TemporaryFile() as data:
                run([str(self.tools.ffmpeg), '-v', 'error', '-ss', str(at), '-i', str(output), '-frames:v', '1',
                     '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], self.cancel, stdout=data)
                data.seek(0)
                return data.read()
        for at in (.25, 2.25):
            self.assertLess(max(frame(at)), 8)
        for at in (1.25, 1.75):
            painted = frame(at)
            self.assertGreater(sum(v > 150 for v in painted), 100)
            rows = [y for y in range(180) if max(painted[y*320:(y+1)*320]) > 150]
            # Two distinct caption lines, not both drawn at the same baseline.
            self.assertGreaterEqual(sum(b - a > 1 for a, b in zip(rows, rows[1:])), 1)

    def test_selected_empty_subtitle_track_fails_before_rendering(self):
        with self.assertRaisesRegex(ValueError, '没有所选轨道'):
            self.export(burn_subtitles='secondary')
        self.assertFalse((self.root / 'result.mp4').exists())

    def test_tail_only_and_silent_video_work_without_voice_or_original_audio(self):
        self.project['msw']['audio_clips'] = []
        _, plan, _ = self.export(mode='voice', duration_ms=8000, start_ms=6000, video_tail='freeze')
        self.assertEqual(plan['sample_count'], 96000)

    def test_cancel_does_not_publish_a_video(self):
        self.cancel.set()
        with self.assertRaises(RenderCancelled):
            self.export(video_tail='truncate')
        self.assertFalse((self.root / 'result.mp4').exists())

    def test_no_video_and_too_short_range_are_actionable(self):
        with self.assertRaisesRegex(ValueError, '没有可导出的视频'):
            prepare(self.project, self.settings, {**self.info, 'video': None})
        with self.assertRaisesRegex(ValueError, '短于一帧'):
            self.export(end_ms=1)

    def test_voice_is_audible_at_its_offset_in_the_muxed_video(self):
        values = [round(4000 * math.sin(i * 2 * math.pi * 440 / 24000)) for i in range(96000)]
        data = make_wave(values)
        self.audio.write_bytes(data)
        self.asset['sha256'] = hashlib.sha256(data).hexdigest()
        _, _, output = self.export(mode='voice', video_tail='truncate')
        decoded = self.root / 'decoded.pcm'
        run([str(self.tools.ffmpeg), '-v', 'error', '-i', str(output), '-map', '0:a:0', '-ac', '1',
             '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 's16le', str(decoded)], self.cancel)
        samples = array('h')
        samples.frombytes(decoded.read_bytes())
        self.assertEqual(max(map(abs, samples[:24000])), 0)
        self.assertGreater(math.sqrt(sum(v*v for v in samples[57600:72000]) / 14400), 2000)

    def test_noninteger_frame_rate_and_many_cuts_do_not_accumulate_duration_error(self):
        run([str(self.tools.ffmpeg), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=30000/1001:duration=4',
             '-c:v', 'libx264', '-threads', '1', str(self.source)], self.cancel)
        self.info = probe_source(self.tools.ffprobe, self.source, self.cancel)
        self.project['msw']['audio_settings']['gap_policy'] = 'follow'
        self.project['gap_remove'] = {'gaps':[{'start':i*157+77, 'end':i*157+107, 'removed':True} for i in range(20)]}
        _, plan, output = self.export(mode='voice', remove_gaps=True, end_ms=3500)
        actual = probe_source(self.tools.ffprobe, output, self.cancel)
        self.assertEqual(actual['video']['frame_rate'], '30000/1001')
        self.assertLessEqual(abs(actual['video']['duration_ms'] - plan['sample_count']/48), 18)

    def test_delayed_picture_keeps_its_initial_black_interval(self):
        # The audio/container begins at zero, while the video starts at 0.5s.
        run([str(self.tools.ffmpeg), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:size=96x64:rate=24:duration=3.5',
             '-i', str(self.audio), '-vf', 'setpts=PTS+0.5/TB', '-fps_mode', 'passthrough', '-map', '0:v', '-map', '1:a',
             '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', str(self.source)], self.cancel)
        self.info = probe_source(self.tools.ffprobe, self.source, self.cancel)
        self.assertEqual(self.info['video']['start_ms'], 500)
        self.assertEqual(self.info['video']['duration_ms'], 4000)
        _, _, output = self.export(video_encoding='h264', video_tail='truncate')
        def pixel(at):
            with tempfile.TemporaryFile() as data:
                run([str(self.tools.ffmpeg), '-v', 'error', '-ss', str(at), '-i', str(output), '-frames:v', '1',
                     '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], self.cancel, stdout=data)
                data.seek(0)
                return data.read()
        self.assertLess(max(pixel(.2)), 8)
        self.assertGreater(pixel(.8)[0], 200)
