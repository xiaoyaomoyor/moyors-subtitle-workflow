"""Exercise the basic FFmpeg path with synthetic PCM, including old caches."""

import base64
import io
import math
import shutil
import struct
import tempfile
import threading
import unittest
import wave
from pathlib import Path

from maw import media_cache, waveform, mopeaks


class WavHeaderTests(unittest.TestCase):
    def test_header_padding_layout_and_truncation(self):
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as out:
            out.setparams((2, 2, 8000, 0, 'NONE', 'not compressed'))
            out.writeframes(b'\0' * 12)
        raw = stream.getvalue()
        self.assertEqual(waveform.parse_ffmpeg_wav_header(raw), (2, 8000, 44))
        padded = raw[:12] + b'JUNK' + struct.pack('<I', 1) + b'x\0' + raw[12:]
        self.assertEqual(waveform.parse_ffmpeg_wav_header(padded), (2, 8000, 54))
        for cut in range(44):
            self.assertIsNone(waveform.parse_ffmpeg_wav_header(raw[:cut]))
        invalid = bytearray(raw)
        struct.pack_into('<H', invalid, 34, 24)
        self.assertIsNone(waveform.parse_ffmpeg_wav_header(invalid))


@unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is required')
class MultichannelWaveformTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def audio(self, gains, seconds=.403):
        path = self.root / f'audio-{len(gains)}.wav'
        frames = bytearray()
        for i in range(round(8000 * seconds)):
            value = round(math.sin(2 * math.pi * 110 * i / 8000) * 20000)
            frames.extend(struct.pack('<' + 'h' * len(gains), *(value * gain for gain in gains)))
        with wave.open(str(path), 'wb') as out:
            out.setparams((len(gains), 2, 8000, 0, 'NONE', 'not compressed'))
            out.writeframes(frames)
        return path

    def test_mono_stereo_surround_extrema_and_frame_timing(self):
        for gains in [(1,), (1, 1), (1, -1), (0, 1), (1, -1, 0, 0, 0, 1)]:
            with self.subTest(gains=gains):
                progress = []
                value = waveform.extract_waveform(self.audio(gains), pcm_sample_rate=8000, progress=progress.append)
                peaks = base64.b64decode(value['data'])
                signed = [n if n < 128 else n-256 for n in peaks]
                self.assertGreater(max(signed), 60)
                self.assertLess(min(signed), -60)
                self.assertEqual(value['duration_ms'], 403)
                self.assertEqual(value['peak_count'], 41)
                self.assertEqual(value['division'], 80)
                self.assertEqual(progress[-1], 403)
                self.assertEqual(progress, sorted(progress))

    def test_silence_and_fractional_rate_keep_duration(self):
        value = waveform.extract_waveform(self.audio((0, 0)), pcm_sample_rate=8000, peaks_per_second=97)
        self.assertEqual(value['duration_ms'], 403)
        self.assertEqual(set(base64.b64decode(value['data'])), {0})
        self.assertEqual(waveform.waveform_peaks_per_second(value), 8000 / 82)

    def test_force_regeneration_replaces_legacy_flat_cache(self):
        media = self.audio((1, -1), seconds=1)
        old = {'schema':waveform.WAVEFORM_SCHEMA, 'encoding':waveform.WAVEFORM_ENCODING,
               'peaks_per_second':100, 'peak_count':100, 'duration_ms':1000,
               'data':base64.b64encode(bytes(200)).decode(), 'source':waveform.media_signature(media)}
        mopeaks.save_mopeaks(old, media)
        result = media_cache.embed_media_caches({'waveform':old}, media, reuse_existing=True, force_rebuild=True)
        self.assertIsNone(result.waveform_error)
        self.assertTrue(any(base64.b64decode(result.project['waveform']['data'])))
        cached, generated = waveform.load_or_extract_waveform(None, media)
        self.assertFalse(generated)
        self.assertTrue(any(base64.b64decode(cached['data'])))

    def test_cancel_and_malformed_media_preserve_error_contract(self):
        cancelled = threading.Event(); cancelled.set()
        with self.assertRaisesRegex(waveform.WaveformError, '取消'):
            waveform.extract_waveform(self.audio((1, -1)), cancel_event=cancelled)
        bad = self.root / 'invalid.wav'; bad.write_bytes(b'not an audio file')
        with self.assertRaises(waveform.WaveformError):
            waveform.extract_waveform(bad)


if __name__ == '__main__':
    unittest.main()
