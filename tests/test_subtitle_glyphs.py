import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from maw.msw.audio_render import RenderCancelled, run
from maw.postprocess_ffmpeg import (BurnSubtitleRequest, MediaToolCancelled, MediaToolError,
    SubtitleFontGlyphMissingError, _run_ffmpeg_process, run_burn_subtitles)
from maw.subtitle_glyphs import SubtitleGlyphMissingError, missing_glyph_message


WARNING = 'fontselect: failed to find any fallback with glyph 0x4E2D for font: (Arial, 400, 0)\n'


class GlyphDiagnosticsTests(unittest.TestCase):
    def test_shared_browser_and_export_cases(self):
        cases = json.loads((Path(__file__).parent / 'fixtures/subtitle-glyph-diagnostics.json').read_text(encoding='utf-8'))
        for case in cases:
            for stream in (io.StringIO(case['log']), io.BytesIO(case['log'].encode())):
                with self.subTest(case=case):
                    message = missing_glyph_message(stream)
                    self.assertEqual(bool(message), bool(case['parts']))
                    for part in case['parts']:
                        self.assertIn(part, message)

    def test_repeated_warnings_are_deduplicated_and_messages_bounded(self):
        self.assertEqual(missing_glyph_message(io.StringIO(WARNING * 100)), missing_glyph_message(io.StringIO(WARNING)))
        logs = '\n'.join(WARNING.replace('4E2D', f'{code:X}') for code in range(100, 200))
        result = missing_glyph_message(io.StringIO(logs))
        self.assertEqual(result.count('U+'), 8)
        self.assertIn('另有其他缺字', result)
        self.assertNotIn('U+0000', missing_glyph_message(io.StringIO(WARNING.replace('4E2D', '0'))))
        self.assertNotIn('\u202e', missing_glyph_message(io.StringIO(WARNING.replace('Arial', '\u202eArial'))))

    def test_real_child_success_still_reports_missing_glyphs_and_large_stderr_does_not_block(self):
        # The warning precedes a large log: checking only its tail would miss it.
        command = [sys.executable, '-c', 'import os; os.write(2, ' + repr(WARNING.encode()) + '); os.write(2,b"other warning\\n"*100000)']
        with tempfile.TemporaryDirectory() as folder:
            for launcher in (False, True):
                with self.subTest(launcher=launcher):
                    if launcher:
                        with self.assertRaisesRegex(SubtitleFontGlyphMissingError, '中.*U\\+4E2D'):
                            _run_ffmpeg_process(command, cwd=Path(folder), cancel_event=threading.Event(),
                                on_process=None, on_progress=None, check_ass_glyphs=True)
                    else:
                        with self.assertRaisesRegex(SubtitleGlyphMissingError, '中.*U\\+4E2D'):
                            run(command, threading.Event(), check_ass_glyphs=True)
            run(command, threading.Event())  # Other audio operations remain unaffected.

    def test_cancellation_and_other_errors_remain_distinct(self):
        cancel = threading.Event(); cancel.set()
        with self.assertRaises(RenderCancelled):
            run([], cancel, check_ass_glyphs=True)
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(MediaToolCancelled):
                _run_ffmpeg_process([], cwd=Path(folder), cancel_event=cancel, on_process=None, on_progress=None, check_ass_glyphs=True)
            with self.assertRaisesRegex(MediaToolError, 'real failure'):
                _run_ffmpeg_process([sys.executable, '-c', 'import sys; sys.stderr.write("real failure");sys.exit(1)'],
                    cwd=Path(folder), cancel_event=None, on_process=None, on_progress=None, check_ass_glyphs=True)

    def test_launcher_font_error_does_not_retry_cpu_or_publish_partial_video(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); media = root/'clip.mp4'; subtitle = root/'clip.srt'
            media.write_bytes(b'original'); subtitle.write_text('caption', encoding='utf-8')
            calls = []
            def encode(command, **kwargs):
                calls.append(command)
                self.assertEqual(command[command.index('-loglevel')+1], 'warning')
                self.assertTrue(kwargs['check_ass_glyphs'])
                Path(command[-1]).write_bytes(b'partial')
                raise SubtitleFontGlyphMissingError('missing glyph')
            with patch('maw.msw.video_encoders.choose_encoder', return_value=('h264_nvenc','')), \
                    patch('maw.postprocess_ffmpeg._run_ffmpeg_process', side_effect=encode):
                with self.assertRaises(SubtitleFontGlyphMissingError):
                    run_burn_subtitles(BurnSubtitleRequest(media, subtitle, encoding={'video_encoding':'auto'}), ffmpeg_path=Path('ffmpeg'))
            self.assertEqual(len(calls), 1)
            self.assertEqual(set(root.iterdir()), {media, subtitle})
            self.assertEqual(media.read_bytes(), b'original')
