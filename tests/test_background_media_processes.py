"""Hidden Windows children without changing media/error/cancellation contracts."""
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from maw import ffmpeg, gui_platform, media, local_asr, quapeaks


class BackgroundMediaTests(unittest.TestCase):
    def test_media_entry_points_hide_windows_children_and_are_portable(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.flv'
            source.write_bytes(b'synthetic')
            calls = [
                (lambda: ffmpeg.media_duration_seconds(source), 'run'),
                (lambda: media.probe_video_fps(source), 'run'),
                (lambda: media.probe_audio_tracks(source), 'run'),
                (lambda: media.convert_media_for_browser(source, cache_dir=Path(folder)/'cache'), 'run'),
                (lambda: local_asr.QwenAsrEngine._extract_chunk(source, Path(folder)/'chunk.wav', start_s=1, duration_s=2), 'run'),
                (lambda: quapeaks.generate_reapeaks_stream_bytes(source), 'Popen'),
            ]
            for platform in ('win32', 'linux', 'darwin'):
                for invoke, method in calls:
                    with self.subTest(platform=platform, method=method), ExitStack() as stack:
                        stack.enter_context(patch.object(gui_platform.sys, 'platform', platform))
                        stack.enter_context(patch.object(subprocess, 'STARTUPINFO', side_effect=lambda:SimpleNamespace(dwFlags=0), create=True))
                        stack.enter_context(patch.object(subprocess, 'STARTF_USESHOWWINDOW', 1, create=True))
                        stack.enter_context(patch.object(subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True))
                        for module, name in [(ffmpeg,'resolve_ffmpeg_tool'),(media,'find_ffmpeg'),(media,'find_ffprobe'),
                                             (local_asr,'resolve_ffmpeg_tool'),(quapeaks,'resolve_ffmpeg')]:
                            stack.enter_context(patch.object(module,name,return_value='synthetic-tool'))
                        stack.enter_context(patch.object(quapeaks,'_load_rust_kernel',return_value=lambda:None))
                        child = stack.enter_context(patch.object(subprocess,method,side_effect=OSError('unavailable')))
                        try:
                            invoke()
                        except (OSError, media.MediaConversionError):
                            pass
                        child.assert_called_once()
                        kwargs=child.call_args.kwargs
                        self.assertEqual(kwargs['creationflags'], 0x08000000 if platform=='win32' else 0)
                        if platform=='win32':
                            self.assertEqual(kwargs['startupinfo'].dwFlags & 1, 1)
                        else:
                            self.assertIsNone(kwargs['startupinfo'])
                        if method=='run':
                            self.assertTrue(kwargs['capture_output'])
                        else:
                            self.assertEqual(kwargs['stdout'],subprocess.PIPE)
                            self.assertIsNotNone(kwargs['stderr'])
