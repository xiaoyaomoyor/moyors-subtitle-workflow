import base64
import threading
import time
import unittest
from unittest import mock

from test_msw_media_service import MediaServiceTests
from maw.msw.audio_render import command_prefix, probe_source, run
from maw.waveform import extract_waveform, WaveformError


class MediaJobsTests(unittest.TestCase):
    def setUp(self):
        MediaServiceTests.setUp(self)
        if not self.tools.complete:
            self.skipTest('FFmpeg required')

    def tearDown(self):
        MediaServiceTests.tearDown(self)

    def wait(self, job):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            result = self.media.jobs.get(job['id'], 'temporary')
            if result['status'] in {'succeeded', 'failed', 'cancelled', 'interrupted'}:
                return result
            time.sleep(.03)
        self.fail('Media worker did not finish')

    def submit(self, media, kind='waveform'):
        return self.media.jobs.submit({**self.scope, 'media_id': media['id'], 'kind': kind})

    def test_multitrack_peaks_and_proxy_use_selected_logical_audio(self):
        video = self.root / 'multi.mp4'
        run(command_prefix(self.tools.ffmpeg) + ['-f', 'lavfi', '-i', 'color=size=160x90:rate=25',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
            '-map', '0:v', '-map', '1:a', '-map', '2:a', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', str(video)], threading.Event())
        first = self.media.register(video, 'temporary')
        second = self.media.select_track({**self.scope, 'media_id': first['id'], 'audio_index': 1})['media']
        for record, silence in [(first, False), (second, True)]:
            job = self.wait(self.submit(record))
            self.assertEqual(job['status'], 'succeeded', job)
            peaks = self.media.jobs.result(job['id'], 'temporary')['waveform']
            self.assertEqual(peaks['audio_track'], int(silence))
            self.assertEqual(any(base64.b64decode(peaks['data'])), not silence)
        proxy = self.wait(self.submit(second, 'proxy'))
        self.assertEqual(proxy['status'], 'succeeded', proxy)
        path = self.media.jobs.artifact(proxy)
        info = probe_source(self.tools.ffprobe, path, threading.Event())
        self.assertEqual(len(info['audio_tracks']), 1)
        self.assertAlmostEqual(info['duration_ms'], 2000, delta=100)
        self.assertFalse(any(base64.b64decode(extract_waveform(path, ffmpeg_bin=str(self.tools.ffmpeg))['data'])))
        self.assertEqual(self.media.get(first['id'], 'temporary')['path'], str(video))

    def test_cache_reuse_scope_and_fingerprint_rejection(self):
        media = self.media.register(self.source, 'temporary')
        first = self.wait(self.submit(media))
        self.assertEqual(first['status'], 'succeeded', first)
        self.assertEqual(self.submit(media)['id'], first['id'])
        with self.assertRaises(KeyError):
            self.media.jobs.result(first['id'], 'other')
        again = self.media.register(self.source, 'temporary')
        with mock.patch('maw.msw.media_jobs.extract_waveform', side_effect=AssertionError('cache missed')):
            second = self.wait(self.submit(again))
        self.assertEqual(second['status'], 'succeeded', second)
        self.source.write_bytes(self.source.read_bytes() + b'changed')
        with self.assertRaises(ValueError):
            self.media.jobs.result(first['id'], 'temporary')

    def test_cancel_worker_and_retry_without_publishing_partial_peaks(self):
        media = self.media.register(self.source, 'temporary')
        entered = threading.Event()
        def block(*args, cancel_event, **kwargs):
            entered.set()
            cancel_event.wait(10)
            raise WaveformError('cancelled')
        with mock.patch('maw.msw.media_jobs.extract_waveform', side_effect=block):
            job = self.submit(media)
            self.assertTrue(entered.wait(5))
            self.media.jobs.cancel(job['id'], 'temporary')
            self.assertEqual(self.wait(job)['status'], 'cancelled')
        self.assertFalse(self.media.jobs.artifact(job).exists())
        self.assertEqual(self.wait(self.submit(media))['status'], 'succeeded')

    def test_pre_cancelled_stream_extraction_does_not_start_ffmpeg(self):
        cancel = threading.Event(); cancel.set()
        with mock.patch('maw.waveform.subprocess.Popen') as popen:
            with self.assertRaises(WaveformError):
                extract_waveform(self.source, ffmpeg_bin=str(self.tools.ffmpeg), cancel_event=cancel)
            popen.assert_not_called()

    def test_no_audio_is_distinct_from_silent_audio_and_source_index_is_validated(self):
        video = self.root / 'silent-video.mp4'
        run(command_prefix(self.tools.ffmpeg) + ['-f', 'lavfi', '-i', 'color=size=160x90:rate=25',
            '-t', '1', '-an', '-c:v', 'libx264', str(video)], threading.Event())
        media = self.media.register(video, 'temporary')
        self.assertEqual(media['metadata']['audio_tracks'], [])
        with self.assertRaisesRegex(ValueError, '没有'):
            self.submit(media)
        with self.assertRaises(ValueError):
            self.media.select_track({**self.scope, 'media_id': media['id'], 'audio_index': 1})
        self.assertEqual(self.wait(self.submit(media, 'proxy'))['status'], 'succeeded')

    def test_three_hour_stream_has_compact_peaks_and_midstream_cancel(self):
        long = self.root / 'three-hours.wav'
        run(command_prefix(self.tools.ffmpeg) + ['-f', 'lavfi', '-i', 'anullsrc=r=1000:cl=mono',
            '-t', '10800', '-c:a', 'pcm_s16le', str(long)], threading.Event())
        peaks = extract_waveform(long, ffmpeg_bin=str(self.tools.ffmpeg))
        self.assertEqual(peaks['duration_ms'], 10800000)
        self.assertEqual(peaks['peak_count'], 1080000)
        self.assertLess(len(peaks['data']), 3 * 1024 * 1024)
        cancel = threading.Event()
        with self.assertRaises(WaveformError):
            extract_waveform(long, ffmpeg_bin=str(self.tools.ffmpeg), cancel_event=cancel,
                             progress=lambda milliseconds: cancel.set())
