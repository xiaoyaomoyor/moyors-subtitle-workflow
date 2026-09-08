"""Native project save picker. Only an explicit editor action invokes a dialog."""

from pathlib import Path
import subprocess
import sys


def pick_project_target(suggested_name):
    name = Path(str(suggested_name)).name
    if not name.lower().endswith((".mosp", ".json")):
        name = "untitled.mosp"
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
        options.lpstrFile = ctypes.cast(buffer, w.LPWSTR)
        options.nMaxFile = len(buffer)
        options.lpstrTitle = "另存为 MSW 工程"
        options.lpstrDefExt = "mosp"
        # Explorer dialog, overwrite confirmation, existing parent, no CWD change.
        options.Flags = 0x80000 | 0x2 | 0x800 | 0x8
        dll = ctypes.WinDLL("comdlg32", use_last_error=True)
        dll.GetSaveFileNameW.argtypes = [ctypes.POINTER(OpenFileName)]
        dll.GetSaveFileNameW.restype = w.BOOL
        if dll.GetSaveFileNameW(ctypes.byref(options)):
            return Path(buffer.value)
        if dll.CommDlgExtendedError():
            raise ValueError("无法打开系统保存对话框，请重试")
        return None
    if sys.platform == "darwin":
        script = 'on run argv\nset f to choose file name with prompt "Save MSW project" default name (item 1 of argv)\nreturn POSIX path of f\nend run'
        args = ["osascript", "-e", script, name]
    else:
        args = ["zenity", "--file-selection", "--save", "--confirm-overwrite",
                "--title=Save MSW project", f"--filename={name}", "--file-filter=*.mosp *.json"]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=300, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("系统保存对话框不可用；Linux 需要安装 zenity") from error
    return Path(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip() else None
