"""Native project save picker. Only an explicit editor action invokes a dialog."""

from contextlib import contextmanager
from pathlib import Path
import subprocess
import sys
import threading


_folder_lock = threading.Lock()


@contextmanager
def _folder_owner(browser):
    """Own the modal on its STA thread; keep only that dialog above the browser."""
    import ctypes as c
    from ctypes import wintypes as w

    user, kernel = c.WinDLL('user32', use_last_error=True), c.WinDLL('kernel32')
    user.CreateWindowExW.argtypes = [w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD,
                                   c.c_int, c.c_int, c.c_int, c.c_int,
                                   w.HWND, w.HMENU, w.HINSTANCE, c.c_void_p]
    user.CreateWindowExW.restype = w.HWND
    user.DestroyWindow.argtypes = [w.HWND]
    user.DestroyWindow.restype = w.BOOL
    user.GetWindowRect.argtypes = [w.HWND, c.POINTER(w.RECT)]
    user.GetWindowRect.restype = w.BOOL
    user.GetWindow.argtypes = [w.HWND, w.UINT]
    user.GetWindow.restype = w.HWND
    user.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
    user.IsWindowVisible.argtypes = [w.HWND]
    user.IsWindowVisible.restype = w.BOOL
    user.SetWindowPos.argtypes = [w.HWND, w.HWND, c.c_int, c.c_int, c.c_int, c.c_int, w.UINT]
    user.SetWindowPos.restype = w.BOOL
    user.GetWindowLongW.argtypes = [w.HWND, c.c_int]
    user.GetWindowLongW.restype = w.LONG
    user.SetForegroundWindow.argtypes = [w.HWND]
    user.SetForegroundWindow.restype = w.BOOL
    kernel.GetCurrentThreadId.restype = w.DWORD
    enum_type = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    timer_type = c.WINFUNCTYPE(None, w.HWND, w.UINT, c.c_size_t, w.DWORD)
    user.EnumThreadWindows.argtypes = [w.DWORD, enum_type, w.LPARAM]
    user.SetTimer.argtypes = [w.HWND, c.c_size_t, w.UINT, timer_type]
    user.SetTimer.restype = c.c_size_t
    user.KillTimer.argtypes = [w.HWND, c.c_size_t]
    user.KillTimer.restype = w.BOOL
    rect = w.RECT(0, 0, 800, 600)
    if browser:
        user.GetWindowRect(browser, c.byref(rect))
    # An invisible TOOLWINDOW has no taskbar entry or flashing placeholder.
    # Its owned modal inherits TOPMOST without modifying the browser's styles.
    owner = user.CreateWindowExW(0x80 | 0x8, 'STATIC', 'MSW folder owner', 0x80000000,
                                rect.left, rect.top, max(1, rect.right-rect.left),
                                max(1, rect.bottom-rect.top), None, None, None, None)
    if not owner:
        raise c.WinError(c.get_last_error())
    activated = set()
    thread_id = kernel.GetCurrentThreadId()

    @enum_type
    def ensure_front(hwnd, _data):
        if user.GetWindow(hwnd, 4) != owner or not user.IsWindowVisible(hwnd):  # GW_OWNER
            return True
        name = c.create_unicode_buffer(64)
        user.GetClassNameW(hwnd, name, len(name))
        if name.value != '#32770':
            return True
        first = hwnd not in activated
        if first or not user.GetWindowLongW(hwnd, -20) & 0x8:  # GWL_EXSTYLE / TOPMOST
            flags = 0x1 | 0x2 | 0x200 | (0 if first else 0x10)
            if user.SetWindowPos(hwnd, w.HWND(-1), 0, 0, 0, 0, flags):
                if first:
                    user.SetForegroundWindow(hwnd)
                    activated.add(hwnd)
        return True

    @timer_type
    def tick(_hwnd, _message, _timer, _time):
        user.EnumThreadWindows(thread_id, ensure_front, 0)

    timer = 0
    try:
        # IFileDialog pumps this thread's messages. A timer also catches late
        # shell initialization/reset, which a one-shot EVENT_OBJECT_SHOW misses.
        timer = user.SetTimer(None, 0, 100, tick)
        if not timer:
            raise c.WinError(c.get_last_error())
        yield owner
    finally:
        if timer:
            user.KillTimer(None, timer)
        user.DestroyWindow(owner)
        # ctypes callbacks stay alive through timer removal and window teardown.


def _windows_folder(owner):
    """Modern IFileOpenDialog; only real filesystem folders are accepted."""
    import ctypes as c
    from ctypes import wintypes as w
    import uuid

    class Guid(c.Structure):
        _fields_ = [('bytes', c.c_ubyte * 16)]

    def guid(value):
        return Guid((c.c_ubyte * 16).from_buffer_copy(uuid.UUID(value).bytes_le))

    ole = c.WinDLL('ole32')
    ole.CoInitializeEx.argtypes = [c.c_void_p, w.DWORD]
    ole.CoInitializeEx.restype = c.c_long
    ole.CoCreateInstance.argtypes = [c.POINTER(Guid), c.c_void_p, w.DWORD, c.POINTER(Guid), c.POINTER(c.c_void_p)]
    ole.CoCreateInstance.restype = c.c_long
    ole.CoTaskMemFree.argtypes = [c.c_void_p]
    ole.CoTaskMemFree.restype = None
    ole.CoUninitialize.argtypes = []
    ole.CoUninitialize.restype = None

    def check(hr):
        if hr < 0:
            raise OSError(f'Folder dialog HRESULT 0x{hr & 0xffffffff:08X}')

    def invoke(pointer, index, *types):
        table = c.cast(pointer, c.POINTER(c.POINTER(c.c_void_p))).contents
        return c.WINFUNCTYPE(c.c_long, c.c_void_p, *types)(table[index])

    check(ole.CoInitializeEx(None, 2))  # COINIT_APARTMENTTHREADED
    dialog, item, text = c.c_void_p(), c.c_void_p(), c.c_void_p()
    try:
        clsid = guid('DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7')
        iid = guid('D57C7288-D4AD-4768-BE02-9D969532D960')
        check(ole.CoCreateInstance(c.byref(clsid), None, 1, c.byref(iid), c.byref(dialog)))
        flags = w.DWORD()
        check(invoke(dialog, 10, c.POINTER(w.DWORD))(dialog, c.byref(flags)))
        # Pick folders, real filesystem, existing path, do not alter process CWD.
        check(invoke(dialog, 9, w.DWORD)(dialog, flags.value | 0x20 | 0x40 | 0x800 | 0x8))
        check(invoke(dialog, 17, w.LPCWSTR)(dialog, '选择 TTS 安装目录'))
        with _folder_owner(owner) as modal_owner:
            hr = invoke(dialog, 3, w.HWND)(dialog, modal_owner)
        if hr & 0xffffffff == 0x800704C7:  # Explicit user cancellation.
            return None
        check(hr)
        check(invoke(dialog, 20, c.POINTER(c.c_void_p))(dialog, c.byref(item)))
        check(invoke(item, 5, w.DWORD, c.POINTER(c.c_void_p))(item, 0x80058000, c.byref(text)))
        return Path(c.wstring_at(text))
    finally:
        if text:
            ole.CoTaskMemFree(text)
        if item:
            invoke(item, 2)(item)
        if dialog:
            invoke(dialog, 2)(dialog)
        ole.CoUninitialize()


def pick_tts_directory():
    """User-initiated native folder chooser, also available without a launcher."""
    if sys.platform == 'win32':
        if not _folder_lock.acquire(blocking=False):
            raise ValueError('目录选择窗口已打开，请先完成或取消选择')
        try:
            import ctypes
            from ctypes import wintypes as w
            user = ctypes.WinDLL('user32')
            user.GetForegroundWindow.restype = w.HWND
            owner = user.GetForegroundWindow()
            result = {}

            def select():
                try:
                    result['path'] = _windows_folder(owner)
                except Exception as error:
                    result['error'] = error

            # HTTP/Qt worker apartments are not guaranteed to be STA. Shell
            # dialogs own their COM lifetime on a fresh thread.
            thread = threading.Thread(target=select, name='msw-folder-picker', daemon=True)
            thread.start()
            thread.join()
            if 'error' in result:
                raise ValueError('无法打开系统目录选择窗口，请重试或填写安装位置') from result['error']
            return result.get('path')
        finally:
            _folder_lock.release()
    args = (['osascript', '-e', 'POSIX path of (choose folder with prompt "TTS installation")']
            if sys.platform == 'darwin' else ['zenity', '--file-selection', '--directory', '--title=TTS installation'])
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=300, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError('目录选择器不可用，请填写安装位置') from error
    return Path(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip() else None


def pick_media_source():
    return pick_project_target('', _open_media=True)


def pick_project_target(suggested_name, *, _open_media=False, _new_project=False):
    name = Path(str(suggested_name)).name
    if not name.lower().endswith((".mosp", ".json")):
        name = "untitled.mosp"
    if _open_media:
        name = ''
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes as w

        class OpenFileName(ctypes.Structure):
            _fields_ = [("lStructSize", w.DWORD), ("hwndOwner", w.HWND),
                        ("hInstance", w.HINSTANCE), ("lpstrFilter", w.LPCWSTR),
                        ("lpstrCustomFilter", w.LPWSTR), ("nMaxCustFilter", w.DWORD),
                        ("nFilterIndex", w.DWORD), ("lpstrFile", w.LPWSTR),
                        ("nMaxFile", w.DWORD), ("lpstrFileTitle", w.LPWSTR),
                        ("nMaxFileTitle", w.DWORD), ("lpstrInitialDir", w.LPCWSTR),
                        ("lpstrTitle", w.LPCWSTR), ("Flags", w.DWORD),
                        ("nFileOffset", w.WORD), ("nFileExtension", w.WORD),
                        ("lpstrDefExt", w.LPCWSTR), ("lCustData", ctypes.c_ssize_t),
                        ("lpfnHook", ctypes.c_void_p), ("lpTemplateName", w.LPCWSTR),
                        ("pvReserved", ctypes.c_void_p), ("dwReserved", w.DWORD),
                        ("FlagsEx", w.DWORD)]

        buffer = ctypes.create_unicode_buffer(name, 32768)
        options = OpenFileName()
        options.lStructSize = ctypes.sizeof(options)
        options.lpstrFilter = "MSW 工程 (*.mosp)\0*.mosp\0JSON 工程 (*.json)\0*.json\0\0"
        if _open_media:
            from maw.media import MEDIA_EXTENSIONS
            options.lpstrFilter = '音视频文件\0' + ';'.join('*' + suffix for suffix in sorted(MEDIA_EXTENSIONS)) + '\0\0'
        options.lpstrFile = ctypes.cast(buffer, w.LPWSTR)
        options.nMaxFile = len(buffer)
        options.lpstrTitle = "新工程保存位置" if _new_project else "另存为 MSW 工程"
        options.lpstrDefExt = "mosp"
        # Explorer dialog, overwrite confirmation, existing parent, no CWD change.
        options.Flags = 0x80000 | 0x2 | 0x800 | 0x8
        if _open_media:
            options.lpstrTitle = '导入媒体'
            options.lpstrDefExt = None
            options.Flags = 0x80000 | 0x1000 | 0x800 | 0x8
        dll = ctypes.WinDLL("comdlg32", use_last_error=True)
        picker = dll.GetOpenFileNameW if _open_media else dll.GetSaveFileNameW
        picker.argtypes = [ctypes.POINTER(OpenFileName)]
        picker.restype = w.BOOL
        if picker(ctypes.byref(options)):
            return Path(buffer.value)
        if dll.CommDlgExtendedError():
            raise ValueError("无法打开系统保存对话框，请重试")
        return None
    if sys.platform == "darwin":
        script = 'on run argv\nset f to choose file name with prompt "Save MSW project" default name (item 1 of argv)\nreturn POSIX path of f\nend run'
        if _new_project:
            script = script.replace('Save MSW project','New project save location')
        args = ["osascript", "-e", script, name]
        if _open_media:
            args = ['osascript', '-e', 'POSIX path of (choose file with prompt "Import media")']
    else:
        args = ["zenity", "--file-selection", "--save", "--confirm-overwrite",
                "--title=Save MSW project", f"--filename={name}", "--file-filter=*.mosp *.json"]
        if _new_project:
            args[4] = '--title=New project save location'
        if _open_media:
            args = ['zenity', '--file-selection', '--title=Import media']
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=300, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("系统保存对话框不可用；Linux 需要安装 zenity") from error
    return Path(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip() else None
