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


    def test_owned_picker_rechecks_late_z_order_reset_without_repeated_focus(self):
        user, kernel = Mock(), Mock()
        user.CreateWindowExW.return_value = 42
        user.SetTimer.return_value = 7
        user.GetWindow.return_value = 42
        user.IsWindowVisible.return_value = True
        user.GetWindowLongW.return_value = 0
        user.SetWindowPos.return_value = True
        def class_name(hwnd, buffer, length):
            buffer.value = '#32770'
            return len(buffer.value)
        user.GetClassNameW.side_effect = class_name
        user.EnumThreadWindows.side_effect = lambda tid, callback, data: callback(43, data)
        kernel.GetCurrentThreadId.return_value = 9
        with patch('ctypes.WinDLL', side_effect=[user, kernel]):
            with dialogs._folder_owner(None) as owner:
                self.assertEqual(owner, 42)
                tick = user.SetTimer.call_args.args[3]
                tick(None, 0, 7, 0)
                tick(None, 0, 7, 0)  # Simulate the shell resetting TOPMOST later.
                self.assertEqual(user.SetWindowPos.call_count, 2)
                user.SetForegroundWindow.assert_called_once_with(43)
                user.GetWindow.return_value = 99  # Unrelated modal must not be raised.
                tick(None, 0, 7, 0)
                self.assertEqual(user.SetWindowPos.call_count, 2)
        user.KillTimer.assert_called_once_with(None, 7)
        user.DestroyWindow.assert_called_once_with(42)

    def test_temporary_owner_is_destroyed_when_timer_setup_fails(self):
        user, kernel = Mock(), Mock()
        user.CreateWindowExW.return_value = 42
        user.SetTimer.return_value = 0
        kernel.GetCurrentThreadId.return_value = 9
        with patch('ctypes.WinDLL', side_effect=[user, kernel]):
            with self.assertRaises(OSError):
                with dialogs._folder_owner(None):
                    self.fail('failed timer must not enter modal')
        user.KillTimer.assert_not_called()
        user.DestroyWindow.assert_called_once_with(42)
