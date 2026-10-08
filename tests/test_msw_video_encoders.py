import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from maw.msw import video_encoders as enc
from maw.msw.audio_render import RenderCancelled
from maw.msw.video_progress import EncodingEstimate


class EncoderTests(unittest.TestCase):
    def test_detection_requires_successful_frames_and_caches_per_executable(self):
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder) / 'ffmpeg'
            executable.write_bytes(b'fixture')
            seen = []

            def run(command, *args, **kwargs):
                codec = command[command.index('-c:v') + 1]
                seen.append(codec)
                if codec != 'h264_nvenc':
                    raise ValueError('driver unavailable')
                Path(command[-1]).write_bytes(b'encoded')

            with patch.object(enc, 'run', side_effect=run):
                result = enc.capabilities(executable)
                self.assertEqual([e['id'] for e in result if e['available']], ['h264_nvenc'])
                self.assertTrue(all(e['reason'] for e in result if not e['available']))
                result[0]['available'] = False
                self.assertTrue(enc.capabilities(executable)[0]['available'])
                self.assertEqual(seen, list(enc.HARDWARE))
                executable.write_bytes(b'new ffmpeg')
                enc.capabilities(executable)
                self.assertEqual(len(seen), 6)

    def test_auto_cpu_and_explicit_hardware_have_different_failure_rules(self):
        cancel = threading.Event()
        with patch.object(enc, 'capabilities', return_value=[]):
            self.assertEqual(enc.choose_encoder({'video_encoding':'h264'}, '', cancel), ('libx264',''))
            self.assertIn('未检测到', enc.choose_encoder({'video_encoding':'auto'}, '', cancel)[1])
            with self.assertRaisesRegex(ValueError, '硬件编码不可用'):
                enc.choose_encoder({'video_encoding':'hardware'}, '', cancel)
        with patch.object(enc, 'capabilities', return_value=[dict(id='h264_nvenc', available=True), dict(id='h264_qsv', available=True)]):
            self.assertEqual(enc.choose_encoder({'video_encoding':'hardware','hardware_encoder':'h264_qsv'}, '', cancel)[0], 'h264_qsv')
            self.assertEqual(enc.choose_encoder({'video_encoding':'auto','hardware_encoder':'h264_qsv'}, '', cancel)[0], 'h264_nvenc')

    def test_cancelled_probe_never_becomes_an_unavailable_device(self):
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(RenderCancelled):
            enc.capabilities('missing', cancel)

    def test_cpu_threads_leave_headroom_and_have_bounds(self):
        for cores, expected in [(None,1),(1,1),(4,2),(16,8),(64,8)]:
            with self.subTest(cores=cores), patch.object(enc.os, 'cpu_count', return_value=cores):
                self.assertEqual(enc.cpu_threads(), expected)
        with self.assertRaises(ValueError):
            enc.encoder_args('arbitrary-codec')


class EstimateTests(unittest.TestCase):
    def test_sampling_reset_stage_and_completion(self):
        now = [0.0]
        estimate = EncodingEstimate(clock=lambda: now[0])
        self.assertIsNone(estimate.update('video', .55))
        now[0] = 2
        self.assertIsNone(estimate.update('video', .55 + .37 * .1))
        now[0] = 4
        self.assertAlmostEqual(estimate.update('video', .55 + .37 * .2), 16, delta=1)
        now[0] = 5
        self.assertIsNone(estimate.update('video', .55))  # CPU retry resets speed.
        now[0] = 7
        self.assertIsNone(estimate.update('video', .6))
        self.assertIsNone(estimate.update('muxing', .94))
        self.assertIsNone(estimate.update('video', .92))

    def test_changed_speed_is_smoothed(self):
        now = [0.0]
        estimate = EncodingEstimate(clock=lambda: now[0])
        estimate.update('video', .55)
        now[0] = 5
        before = estimate.update('video', .55 + .37 * .25)
        now[0] = 10
        after = estimate.update('video', .55 + .37 * .30)
        self.assertGreater(after, before)
        self.assertLess(after, 70)  # Avoid jumping to the last sample's 70 seconds.
