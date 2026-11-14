"""Cancellation regressions for the Launcher's existing media tools."""

from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from maw.gui_web import LauncherApi
from maw.postprocess_ffmpeg import (
    AudioTrack, BurnSubtitleRequest, ExtractAudioRequest, MediaToolCancelled,
    _run_ffmpeg_process, run_burn_subtitles, run_extract_audio,
)


class MediaToolCancellationTests(unittest.TestCase):
    def setUp(self):
        # Exercise the real lifecycle without opening a window or loading user settings.
        self.api = LauncherApi.__new__(LauncherApi)
        self.api._media_tool_lock = threading.Lock()
        self.api.media_tool_cancel_event = None
        self.api.media_tool_process = None

    def test_cancel_before_registration_terminates_late_process(self):
        cancel = self.api._begin_media_tool()
        self.assertEqual(self.api.cancel_media_tool(), {'ok': True, 'cancelling': True})
        process = mock.Mock(poll=mock.Mock(return_value=None))
        with mock.patch('maw.gui_web.terminate_process_tree') as terminate:
            self.api._set_media_tool_process(process)
            terminate.assert_called_once_with(process)
        self.assertTrue(cancel.is_set())

    def test_cancel_sets_event_under_same_lock_as_registration(self):
        cancel = self.api._begin_media_tool()
        setting, release, registered = threading.Event(), threading.Event(), threading.Event()
        original_set = cancel.set

        def paused_set():
            setting.set()
            release.wait(3)
            original_set()

        process = mock.Mock(poll=mock.Mock(return_value=None))

        def register():
            self.api._set_media_tool_process(process)
            registered.set()

        with mock.patch.object(cancel, 'set', side_effect=paused_set), \
                mock.patch('maw.gui_web.terminate_process_tree') as terminate:
            caller = threading.Thread(target=self.api.cancel_media_tool)
            worker = threading.Thread(target=register)
            try:
                caller.start()
                self.assertTrue(setting.wait(2))
                worker.start()
                self.assertFalse(registered.wait(.1), 'registration must not pass a half-set cancellation')
            finally:
                release.set()
                caller.join(3)
                if worker.ident is not None:
                    worker.join(3)
            self.assertFalse(caller.is_alive())
            self.assertFalse(worker.is_alive())
            terminate.assert_called_once_with(process)

    def test_cancel_returns_before_slow_termination_and_repeated_cancel_is_idempotent(self):
        cancel = self.api._begin_media_tool()
        process = mock.Mock(poll=mock.Mock(return_value=None))
        self.api._set_media_tool_process(process)
        terminating, release, terminated, returned = (threading.Event() for _ in range(4))
        results = []

        def slow_terminate(_process):
            terminating.set()
            release.wait(3)
            terminated.set()

        def request_cancel():
            results.append(self.api.cancel_media_tool())
            returned.set()

        with mock.patch('maw.gui_web.terminate_process_tree', side_effect=slow_terminate) as terminate:
            caller = threading.Thread(target=request_cancel)
            try:
                caller.start()
                self.assertTrue(terminating.wait(2))
                self.assertTrue(returned.wait(1), 'the bridge must return while process cleanup is pending')
                self.assertTrue(cancel.is_set())
                self.assertEqual(self.api.cancel_media_tool(), {'ok': True, 'cancelling': True})
                self.assertIsNone(self.api._begin_media_tool(), 'keep the current job busy until its worker finishes')
            finally:
                release.set()
                caller.join(3)
                self.assertTrue(terminated.wait(3))
            terminate.assert_called_once_with(process)
        self.assertEqual(results, [{'ok': True, 'cancelling': True}])
        self.api._finish_media_tool(cancel)
        next_cancel = self.api._begin_media_tool()
        self.api._finish_media_tool(cancel)
        self.assertIs(self.api.media_tool_cancel_event, next_cancel)
        self.assertFalse(next_cancel.is_set())

    def test_idle_cancel_does_not_affect_the_next_job(self):
        self.assertEqual(self.api.cancel_media_tool(), {'ok': True, 'cancelling': False})
        self.assertFalse(self.api._begin_media_tool().is_set())

    def test_pre_cancelled_worker_does_not_launch_a_process(self):
        cancel = threading.Event()
        cancel.set()
        with mock.patch('maw.postprocess_ffmpeg.subprocess.Popen') as popen:
            with self.assertRaises(MediaToolCancelled):
                _run_ffmpeg_process(['unused'], cwd=Path('.'), cancel_event=cancel, on_process=None, on_progress=None)
            popen.assert_not_called()

    def test_cancel_interrupts_a_real_process_waiting_without_stdout(self):
        cancel = self.api._begin_media_tool()
        registered, reading = threading.Event(), threading.Event()
        processes, errors = [], []

        class ObservedOutput:
            def __init__(self, stream):
                self.stream = stream

            def readline(self):
                reading.set()
                return self.stream.readline()

            def close(self):
                self.stream.close()

        def on_process(process):
            processes.append(process)
            process.stdout = ObservedOutput(process.stdout)
            self.api._set_media_tool_process(process)
            registered.set()

        def run():
            try:
                # Deliberately no output: cancellation must wake a blocked readline.
                _run_ffmpeg_process([sys.executable, '-c', 'import time; time.sleep(20)'],
                    cwd=Path.cwd(), cancel_event=cancel, on_process=on_process, on_progress=None)
            except Exception as error:
                errors.append(error)
            finally:
                self.api._finish_media_tool(cancel)

        worker = threading.Thread(target=run)
        try:
            worker.start()
            self.assertTrue(registered.wait(5))
            self.assertTrue(reading.wait(3))
            self.api.cancel_media_tool()
            worker.join(8)
            self.assertFalse(worker.is_alive(), 'cancel must not wait for stdout or natural process exit')
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], MediaToolCancelled)
            self.assertIsNotNone(processes[0].poll())
            self.assertIsNone(self.api.media_tool_cancel_event)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
            worker.join(5)

    def test_failed_registration_cleans_up_its_child_and_pipes(self):
        processes = []

        def fail_registration(process):
            processes.append(process)
            raise ValueError('registration failed')

        try:
            with self.assertRaisesRegex(ValueError, 'registration failed'):
                _run_ffmpeg_process([sys.executable, '-c', 'import time; time.sleep(20)'],
                    cwd=Path.cwd(), cancel_event=None, on_process=fail_registration, on_progress=None)
            self.assertIsNotNone(processes[0].poll())
            self.assertTrue(processes[0].stdout.closed)
            self.assertTrue(processes[0].stderr.closed)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)

    def test_cancelled_burn_and_extract_discard_partial_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            media, subtitle = root / 'fixture.mp4', root / 'fixture.srt'
            media.write_bytes(b'original-media')
            subtitle.write_text('1\n00:00:00,000 --> 00:00:01,000\nText\n', encoding='utf-8')
            original_files = set(root.iterdir())

            def cancel_with_partial_output(command, **_kwargs):
                Path(command[-1]).write_bytes(b'partial')
                raise MediaToolCancelled('cancelled')

            track = AudioTrack(0, 0, 'aac', 2, 48000, '', '', True)
            with mock.patch('maw.postprocess_ffmpeg._run_ffmpeg_process', side_effect=cancel_with_partial_output), \
                    mock.patch('maw.postprocess_ffmpeg.probe_audio_tracks', return_value=(track,)):
                for run in (
                    lambda: run_burn_subtitles(BurnSubtitleRequest(media, subtitle), ffmpeg_path=Path('ffmpeg')),
                    lambda: run_extract_audio(ExtractAudioRequest(media, 0), ffmpeg_path=Path('ffmpeg'), ffprobe_path=Path('ffprobe')),
                ):
                    with self.assertRaises(MediaToolCancelled):
                        run()
                    self.assertEqual(set(root.iterdir()), original_files)
                    self.assertEqual(media.read_bytes(), b'original-media')

    def test_style_preset_probe_cancellation_uses_media_tool_result(self):
        from maw.msw.audio_render import RenderCancelled

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            media, subtitle = root / 'fixture.mp4', root / 'fixture.srt'
            media.write_bytes(b'media')
            subtitle.write_text('1\n00:00:00,000 --> 00:00:01,000\nText\n', encoding='utf-8')
            with mock.patch('maw.msw.audio_render.probe_source', side_effect=RenderCancelled), \
                    mock.patch('maw.postprocess_ffmpeg.subprocess.Popen') as popen:
                with self.assertRaises(MediaToolCancelled):
                    run_burn_subtitles(BurnSubtitleRequest(media, subtitle, project_style={}),
                        ffmpeg_path=Path('ffmpeg'), ffprobe_path=Path('ffprobe'))
                popen.assert_not_called()
