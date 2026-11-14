"""Encoding settings stay consistent across editor export and manual burning."""
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from maw.msw.video_encoders import encoder_args, encoding_options
from maw.msw.video_render import can_copy
from maw.postprocess_ffmpeg import BurnSubtitleRequest, MediaToolCancelled, MediaToolError, run_burn_subtitles


class EncodingOptionsTests(unittest.TestCase):
    def test_custom_quality_speed_and_defaults_reach_each_encoder(self):
        expected = {'libx264': ('-crf', '23', '-preset', 'fast'),
                    'h264_nvenc': ('-cq', '24', '-preset', 'p3'),
                    'h264_qsv': ('-global_quality', '24', '-preset', 'fast'),
                    'h264_amf': ('-qp_i', '23', '-quality', 'speed')}
        for encoder, (quality_key, quality, speed_key, speed) in expected.items():
            with self.subTest(encoder=encoder):
                args = encoder_args(encoder, {'video_quality': 23, 'video_preset': 'fast'})
                self.assertEqual(args[args.index(quality_key)+1], quality)
                self.assertEqual(args[args.index(speed_key)+1], speed)
        self.assertEqual(encoding_options()['audio_bitrate_kbps'], 192)
        args = encoder_args('libx264')
        self.assertEqual(args[args.index('-crf')+1], '18')
        self.assertEqual(args[args.index('-preset')+1], 'medium')
        self.assertEqual(encoder_args('h264_amf', {'video_quality':51})[9], '51')

    def test_invalid_options_fail_before_building_commands(self):
        for key, values in {
            'video_quality': [-1, 52, True, 18.5, '18', None],
            'audio_bitrate_kbps': [0, 63, 513, True, float('nan'), '192k', None],
            'video_preset': ['invalid', '-y', None, []],
            'video_encoding': ['copy', None, []],
            'hardware_encoder': ['arbitrary-codec', None, []],
        }.items():
            for value in values:
                with self.subTest(key=key,value=value), self.assertRaises(ValueError):
                    encoding_options({key:value})

    def test_only_picture_settings_prevent_copy(self):
        plan = {'intervals':[{}], 'source_start_ms':0, 'source_end_ms':10000}
        video = {'codec':'h264','pixel_format':'yuv420p','duration_ms':10000}
        self.assertTrue(can_copy(plan,video,encoding_options({'audio_bitrate_kbps':128})))
        for change in [{'video_quality':23},{'video_preset':'fast'},{'video_encoding':'h264'}]:
            self.assertFalse(can_copy(plan,video,encoding_options(change)))

    def test_launcher_fallback_keeps_quality_speed_and_bitrate(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);media=root/'clip.mp4';subtitle=root/'clip.srt'
            media.write_bytes(b'original');subtitle.write_text('1\n00:00:00,000 --> 00:00:01,000\ncaption\n',encoding='utf-8')
            calls=[]
            def encode(command, **kwargs):
                calls.append(command)
                if command[command.index('-c:v')+1] != 'libx264':
                    raise MediaToolError('driver failed')
                Path(command[-1]).write_bytes(b'encoded')
            settings={'video_encoding':'auto','video_quality':23,'video_preset':'fast','audio_bitrate_kbps':128}
            with patch('maw.msw.video_encoders.choose_encoder',return_value=('h264_nvenc','')), \
                    patch('maw.postprocess_ffmpeg._run_ffmpeg_process',side_effect=encode):
                result=run_burn_subtitles(BurnSubtitleRequest(media,subtitle,encoding=settings),ffmpeg_path=Path('ffmpeg'))
            self.assertEqual(result.video_encoder,'libx264')
            self.assertIn('CPU',result.encoding_note)
            self.assertEqual(len(calls),2)
            for command in calls:
                self.assertEqual(command[command.index('-b:a')+1],'128k')
            self.assertEqual(calls[-1][calls[-1].index('-crf')+1],'23')
            self.assertEqual(calls[-1][calls[-1].index('-preset')+1],'fast')
            self.assertEqual(media.read_bytes(),b'original')

    def test_launcher_cancel_and_explicit_hardware_never_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);media=root/'clip.mp4';subtitle=root/'clip.srt'
            media.write_bytes(b'original');subtitle.write_text('caption',encoding='utf-8')
            for mode, error in [('auto',MediaToolCancelled('cancelled')),('hardware',MediaToolError('driver failed'))]:
                with self.subTest(mode=mode), patch('maw.msw.video_encoders.choose_encoder',return_value=('h264_nvenc','')), \
                        patch('maw.postprocess_ffmpeg._run_ffmpeg_process',side_effect=error) as encode:
                    with self.assertRaises(type(error)):
                        run_burn_subtitles(BurnSubtitleRequest(media,subtitle,encoding={'video_encoding':mode}),ffmpeg_path=Path('ffmpeg'),cancel_event=threading.Event())
                    self.assertEqual(encode.call_count,1)
            self.assertEqual(list(root.glob('*.part.mp4')),[])
            self.assertEqual(list(root.glob('*subtitled*.mp4')),[])
