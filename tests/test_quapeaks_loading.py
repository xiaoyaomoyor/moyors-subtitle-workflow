"""Fast cache readers preserve peak values without decoding unrelated layers."""
import base64
import struct
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from maw import quapeaks as q


class IndexedCacheLoadingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.media = self.root / 'sample.wav'
        self.media.write_bytes(b'test media signature')
        self.cache = self.media.with_suffix('.wav.quapeaks')

    def write(self, layers, *, magic=b'QPK1', channels=2):
        stat = self.media.stat()
        header = struct.pack('<4sBBiII', magic, channels, len(layers), 8000,
                             int(stat.st_mtime) & q.UINT32_MASK, stat.st_size)
        self.cache.write_bytes(header + b''.join(struct.pack('<ii', div, count)
                                                for div, count, _ in layers)
                               + b''.join(body for _, _, body in layers))

    def mixed_layers(self):
        return [
            (80, 2, struct.pack('<8h', 12000, -13000, 14000, -15000, 9000, -8000, 7000, -6000)),
            (q.DIV_SPECTRAL, 2, struct.pack('<4i', (42 << 15) | 300, 0, (7 << 15) | 900, 0)),
            (q.DIV_SPECTROGRAM, 1, bytes(192 * 2)),
            (q.DIV_LOUDNESS, 2, struct.pack('<4f', .2, .4, .5, .3)),
            (q.DIV_SELF_WAVE, 2, struct.pack('<II4b', 1000, 10, -20, 30, -40, 50)),
        ]

    def test_payloads_do_not_expand_unrelated_layers(self):
        self.write(self.mixed_layers())
        with ExitStack() as stack:
            for kind in ('wave', 'spectral', 'spectrogram', 'self_wave'):
                stack.enter_context(patch.object(q.ReapeaksFile, '_read_' + kind,
                    side_effect=AssertionError('full peak decoding on a loading path')))
            self.assertTrue(q._reapeaks_matches_media(self.cache, self.media))
            self.assertEqual(q.find_self_wave_container(self.media), self.cache)
            self.assertTrue(q._self_check(self.cache, want_self_wave=True))
            self.assertTrue(q._reapeaks_contains_spectral(self.cache))
            basic = q.load_self_wave_payload(self.media)
            spectral = q.load_spectral_payload(self.media)
            wave = q.load_waveform_payload(self.media)
            loudness = q.load_loudness_stats(self.media)
        self.assertEqual(base64.b64decode(basic['data']), struct.pack('<4b', -20, 30, -40, 50))
        self.assertEqual(basic['peak_count'], 2)
        self.assertEqual(basic['duration_ms'], 20)
        self.assertEqual(base64.b64decode(spectral['data']), struct.pack('<4H', 300, 42, 900, 7))
        self.assertEqual(base64.b64decode(wave['data']), struct.pack('<4b', -58, 54, -31, 35))
        self.assertEqual(wave['peaks_per_second'], 100)
        self.assertEqual(loudness['bin_count'], 2)
        self.assertAlmostEqual(loudness['max'], .5)
        self.assertAlmostEqual(loudness['mean'], .45)

    def test_skipped_layer_bounds_are_still_validated(self):
        for kind, count, body in self.mixed_layers():
            with self.subTest(kind=kind):
                valid_self = self.mixed_layers()[-1]
                self.write([valid_self, (kind, count, body[:-1])])
                with self.assertRaises((ValueError, struct.error)):
                    q.ReapeaksFile(str(self.cache), decode=False)
                self.assertIsNone(q.load_self_wave_payload(self.media))
                self.assertFalse(q._reapeaks_matches_media(self.cache, self.media))

    def test_skipped_self_layer_rejects_invalid_scale_and_foreign_magic(self):
        self.write([(q.DIV_SELF_WAVE, 1, struct.pack('<II2b', 1000, 0, -1, 1))])
        with self.assertRaisesRegex(ValueError, '刻度'):
            q.ReapeaksFile(str(self.cache), decode=False)
        self.write([self.mixed_layers()[-1]], magic=b'RPKN')
        with self.assertRaisesRegex(ValueError, '拒绝猜测'):
            q.ReapeaksFile(str(self.cache), decode=False)

    def test_wave_quantization_matches_eager_parser_for_all_int16_values(self):
        # Covers v1.0 mirrored peaks, v1.1 integers and v1.2 float-range values,
        # including -32768, rounding boundaries and channels of opposite signs.
        values = list(range(-32768, 32768))
        for magic in (q.MAGIC_V10, q.MAGIC_V11, q.MAGIC_V12):
            with self.subTest(magic=magic):
                if magic == q.MAGIC_V10:
                    body = b''.join(struct.pack('<2h', n, -n - 1) for n in values)
                else:
                    body = b''.join(struct.pack('<4h', n, -n - 1, -n - 1, n) for n in values)
                self.write([(53, len(values), body)], magic=magic)
                eager = q.ReapeaksFile(str(self.cache))
                expected = bytearray()
                for row in eager.wave_mipmaps()[0].wave:
                    expected.extend((min(q._wave_to_int8(p.min) for p in row) & 255,
                                     max(q._wave_to_int8(p.max) for p in row) & 255))
                payload = q.extract_waveform_payload(self.cache, self.media)
                self.assertEqual(base64.b64decode(payload['data']), expected)
                self.assertEqual(payload['peak_count'], len(values))
                self.assertEqual(payload['division'], 53)
                self.assertEqual(payload['duration_ms'], round(len(values) * 53 / 8000 * 1000))


if __name__ == '__main__':
    unittest.main()
