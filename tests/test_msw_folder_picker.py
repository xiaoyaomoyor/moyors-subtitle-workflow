"""Folder picker dispatch and cancellation; real Windows smoke is opt-in."""
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

from maw.msw import dialogs


@unittest.skipUnless(sys.platform == 'win32', 'Windows native folder dispatch')
class FolderPickerTests(unittest.TestCase):
    def test_dialog_runs_on_separate_sta_thread_and_keeps_unicode_path(self):
        caller = threading.get_ident()
        seen = []
        def select(owner):
            seen.append((threading.get_ident(), owner))
            return Path('C:/TTS/中文 安装')
        with patch.object(dialogs, '_windows_folder', side_effect=select):
            self.assertEqual(dialogs.pick_tts_directory(), Path('C:/TTS/中文 安装'))
        self.assertNotEqual(seen[0][0], caller)

    def test_cancel_and_failure_are_different_and_release_picker_lock(self):
        with patch.object(dialogs, '_windows_folder', return_value=None):
            self.assertIsNone(dialogs.pick_tts_directory())
        with patch.object(dialogs, '_windows_folder', side_effect=OSError('COM failed')):
            with self.assertRaisesRegex(ValueError, '无法打开'):
                dialogs.pick_tts_directory()
        self.assertFalse(dialogs._folder_lock.locked())

    def test_second_request_cannot_open_another_dialog(self):
        dialogs._folder_lock.acquire()
        try:
            with patch.object(dialogs, '_windows_folder', Mock()) as select:
                with self.assertRaisesRegex(ValueError, '已打开'):
                    dialogs.pick_tts_directory()
                select.assert_not_called()
        finally:
            dialogs._folder_lock.release()
