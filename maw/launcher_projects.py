"""Launcher-side recent-project index.

最近工程的真源是编辑器服务的 ``server-editor-settings.json``（``recent_projects``）：
编辑器打开、保存、另存为成功都会更新它。启动器只读该文件，不并行写它，
避免两个进程同时写同一 JSON 造成覆盖。

启动器自己额外的视图状态（固定、从记录移除、失效路径的重新定位映射、
启动器侧打开时间）保存在独立的 ``launcher-recent.json`` 元数据里。

S3 长期工程目录：``launcher-project-registry.json`` 是「全部工程」的持久登记层
（与最近视图分开）。启动器制作/打开与编辑器打开/保存都经 ``register_project``
登记；统一走本模块的文件锁 + 原子替换，两个进程（启动器与编辑器 Server）
并发写同一注册表也不会相互覆盖。
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Final

from maw.app_paths import default_app_data_root, default_server_settings_path

LAUNCHER_RECENT_FILE_NAME: Final = "launcher-recent.json"
MAX_RECENT_ENTRIES: Final = 9
# 统计解析的工程大小上限：更大的工程仍可打开，但卡片不解析统计（显示为未知）。
STATS_SIZE_LIMIT: Final = 64 * 1024 * 1024

REGISTRY_FILE_NAME: Final = "launcher-project-registry.json"
REGISTRY_VERSION: Final = 1
# 登记层允许的工程文件后缀（「删除工程文件」同样只接受这两类）。
PROJECT_SUFFIXES: Final = frozenset({".mosp", ".json"})
# 注册表写入锁的陈旧阈值：超过该时长的锁视为持有者已崩溃，可被抢占。
REGISTRY_LOCK_STALE_SECONDS: Final = 10.0
# T2/§5.3：全部工程按页返回——不再以单次 5000 条硬截断冒充分页。
DEFAULT_ALL_PAGE_SIZE: Final = 12
MAX_ALL_PAGE_SIZE: Final = 120
MEDIA_INDEX_FILE_NAME: Final = "launcher-media-index.json"


def launcher_recent_metadata_path() -> Path:
    return default_app_data_root() / LAUNCHER_RECENT_FILE_NAME


def project_registry_path() -> Path:
    return default_app_data_root() / REGISTRY_FILE_NAME


def media_index_path() -> Path:
    """T2/A6：媒体名轻量索引（path -> 媒体文件名），供全目录搜索。"""
    return default_app_data_root() / MEDIA_INDEX_FILE_NAME


@dataclass(slots=True)
class LauncherRecentMetadata:
    """Launcher-only view state on top of the editor's recent list."""

    pinned: dict[str, str] = field(default_factory=dict)  # path -> ISO opened time
    removed: set[str] = field(default_factory=set)
    aliases: dict[str, str] = field(default_factory=dict)  # old path -> relocated path
    opened_at: dict[str, str] = field(default_factory=dict)  # path -> ISO time

    def to_json(self) -> dict[str, Any]:
        return {
            "version": 1,
            "pinned": self.pinned,
            "removed": sorted(self.removed),
            "aliases": self.aliases,
            "openedAt": self.opened_at,
        }


def read_launcher_metadata(path: Path | None = None) -> LauncherRecentMetadata:
    target = path or launcher_recent_metadata_path()
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
        return LauncherRecentMetadata()
    if not isinstance(payload, dict):
        return LauncherRecentMetadata()

    def string_dict(key: str) -> dict[str, str]:
        value = payload.get(key)
        if not isinstance(value, dict):
            return {}
        return {str(k): str(v) for k, v in value.items() if isinstance(k, str) and isinstance(v, str) and k.strip()}

    removed_raw = payload.get("removed")
    removed = {str(item) for item in removed_raw if isinstance(item, str)} if isinstance(removed_raw, list) else set()
    return LauncherRecentMetadata(
        pinned=string_dict("pinned"),
        removed=removed,
        aliases=string_dict("aliases"),
        opened_at=string_dict("openedAt"),
    )


def write_launcher_metadata(metadata: LauncherRecentMetadata, path: Path | None = None) -> None:
    target = path or launcher_recent_metadata_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{target.stem}.", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
            json.dump(metadata.to_json(), output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temp_name, target)
    except Exception:
        # 保留未完成的临时文件以便排障；元数据写失败不阻断启动器主流程。
        raise


def _read_editor_recent_paths(settings_path: Path | None = None) -> list[tuple[Path, str]]:
    """Read the editor-owned recent list (read-only for the launcher).

    H06：编辑器记录现在带 openedAt（仅成功打开/保存后写入）；
    返回 (路径, 打开时间) 以便合并视图取较新的时间。
    """
    target = settings_path or default_server_settings_path()
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
        return []
    if not isinstance(payload, dict):
        return []
    values = payload.get("recent_projects")
    if not isinstance(values, list):
        return []
    entries: list[tuple[Path, str]] = []
    for value in values:
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            continue
        opened_at = value.get("openedAt")
        try:
            entries.append((
                Path(value["path"]).expanduser().resolve(),
                opened_at if isinstance(opened_at, str) else "",
            ))
        except OSError:
            continue
    return entries


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _resolve_alias(metadata: LauncherRecentMetadata, path: Path) -> Path:
    current = path
    seen: set[str] = set()
    while True:
        key = str(current)
        if key in seen:
            return current
        seen.add(key)
        nxt = metadata.aliases.get(key)
        if not nxt:
            return current
        try:
            current = Path(nxt).expanduser().resolve()
        except OSError:
            return current


def recent_projects_payload(
    *,
    settings_path: Path | None = None,
    metadata_path: Path | None = None,
) -> dict[str, Any]:
    """Merge the editor index with launcher view state into card payloads."""
    metadata = read_launcher_metadata(metadata_path)
    editor_entries = _read_editor_recent_paths(settings_path)
    editor_times = {str(path): opened_at for path, opened_at in editor_entries}

    merged: dict[str, Path] = {}
    ordered: list[Path] = []
    for raw, _opened_at in editor_entries:
        resolved = _resolve_alias(metadata, raw)
        key = str(resolved)
        if key in metadata.removed and key not in metadata.pinned:
            continue
        if key not in merged:
            merged[key] = resolved
            ordered.append(resolved)
    # 重新定位后的新路径不在编辑器列表时也展示（用户刚指过去）。
    for alias_target in metadata.aliases.values():
        try:
            resolved = Path(alias_target).expanduser().resolve()
        except OSError:
            continue
        key = str(resolved)
        if key in metadata.removed:
            continue
        if key not in merged:
            merged[key] = resolved
            ordered.append(resolved)

    pinned_paths = [Path(p).expanduser().resolve() for p in metadata.pinned if p not in metadata.removed]
    for pinned in pinned_paths:
        key = str(pinned)
        if key not in merged:
            merged[key] = pinned
            ordered.append(pinned)

    pinned_first = sorted(ordered, key=lambda p: (0 if str(p) in metadata.pinned else 1,))
    # 固定项在前；其余保持编辑器「最近优先」顺序。
    final_order: list[Path] = []
    seen: set[str] = set()
    for path in pinned_first:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        final_order.append(path)

    projects: list[dict[str, Any]] = []
    for path in final_order[:MAX_RECENT_ENTRIES]:
        key = str(path)
        exists = path.is_file()
        projects.append({
            "path": key,
            "name": path.name,
            "dir": str(path.parent),
            "exists": exists,
            "pinned": key in metadata.pinned,
            # H06：编辑器记录时间与启动器记录时间取较新者（均为「成功打开」语义）。
            "lastOpenedAt": _latest_iso(editor_times.get(key, ""), metadata.opened_at.get(key, "")),
            "modifiedAt": _mtime_iso(path) if exists else "",
        })
    return {"ok": True, "projects": projects}


def _latest_iso(left: str, right: str) -> str:
    if not left:
        return right
    if not right:
        return left
    return max(left, right)


def _mtime_iso(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds")
    except OSError:
        return ""


def note_project_opened(path: Path, metadata_path: Path | None = None) -> dict[str, Any]:
    metadata = read_launcher_metadata(metadata_path)
    try:
        resolved = str(path.expanduser().resolve())
    except OSError:
        resolved = str(path)
    metadata.opened_at[resolved] = _now_iso()
    metadata.removed.discard(resolved)
    write_launcher_metadata(metadata, metadata_path)
    return {"ok": True}


def remove_recent_project(path: Path, metadata_path: Path | None = None) -> dict[str, Any]:
    """Remove one entry from the launcher view; the project file itself is untouched."""
    metadata = read_launcher_metadata(metadata_path)
    try:
        resolved = str(path.expanduser().resolve())
    except OSError:
        resolved = str(path)
    metadata.removed.add(resolved)
    metadata.pinned.pop(resolved, None)
    metadata.opened_at.pop(resolved, None)
    # 已重新定位的旧路径记录一并清理，避免幽灵条目。
    for alias in [k for k, v in metadata.aliases.items() if v == resolved]:
        del metadata.aliases[alias]
    write_launcher_metadata(metadata, metadata_path)
    return {"ok": True}


def set_recent_project_pinned(path: Path, pinned: bool, metadata_path: Path | None = None) -> dict[str, Any]:
    metadata = read_launcher_metadata(metadata_path)
    try:
        resolved = str(path.expanduser().resolve())
    except OSError:
        resolved = str(path)
    if pinned:
        metadata.pinned[resolved] = metadata.opened_at.get(resolved) or _now_iso()
        metadata.removed.discard(resolved)
    else:
        metadata.pinned.pop(resolved, None)
    write_launcher_metadata(metadata, metadata_path)
    return {"ok": True}


def relocate_recent_project(old_path: Path, new_path: Path, metadata_path: Path | None = None, registry_path: Path | None = None) -> dict[str, Any]:
    """Record that a missing project moved; the launcher view now points at the new file."""
    try:
        old = str(old_path.expanduser().resolve())
        new = new_path.expanduser().resolve()
    except OSError as error:
        return {"ok": False, "error": str(error)}
    if not new.is_file():
        return {"ok": False, "error": f"文件不存在：{new}"}
    metadata = read_launcher_metadata(metadata_path)
    metadata.aliases[old] = str(new)
    metadata.removed.discard(str(new))
    write_launcher_metadata(metadata, metadata_path)
    with contextlib.suppress(Exception):
        # 登记条目随最近视图一起指向新路径（重定位不重复、不丢登记时间）。
        move_registry_entry(Path(old), new, registry_path=registry_path)
    return {"ok": True, "path": str(new)}


def project_stats_payload(path: Path) -> dict[str, Any]:
    """Lightweight card statistics parsed from a .mosp/.json project file."""
    try:
        resolved = path.expanduser().resolve()
    except OSError as error:
        return {"ok": False, "error": str(error)}
    if not resolved.is_file():
        return {"ok": False, "error": f"文件不存在：{resolved}"}
    try:
        if resolved.stat().st_size > STATS_SIZE_LIMIT:
            return {"ok": True, "path": str(resolved), "skipped": "too_large"}
        data = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        return {"ok": False, "error": str(error), "path": str(resolved)}
    if not isinstance(data, dict):
        return {"ok": False, "error": "工程文件必须是 JSON 对象", "path": str(resolved)}

    segments = data.get("segments")
    main_count = len(segments) if isinstance(segments, list) else 0
    sub_count = 0
    multi = data.get("multi_subtitle")
    if isinstance(multi, dict):
        tracks = multi.get("tracks")
        if isinstance(tracks, list):
            for track in tracks:
                if not isinstance(track, dict):
                    continue
                if str(track.get("id", "")) in {"main", "primary"}:
                    continue
                track_segments = track.get("segments")
                if isinstance(track_segments, list):
                    sub_count += len(track_segments)
    msw = data.get("msw")
    audio_count = 0
    if isinstance(msw, dict):
        clips = msw.get("audio_clips")
        audio_count = len(clips) if isinstance(clips, list) else 0
    raw_media = data.get("media")
    media_name = ""
    if isinstance(raw_media, str) and raw_media.strip():
        media_name = Path(raw_media.strip().replace("\\", "/")).name
    return {
        "ok": True,
        "path": str(resolved),
        "mainSubtitles": main_count,
        "subSubtitles": sub_count,
        "audioClips": audio_count,
        "mediaName": media_name,
    }


# ======================= S3：长期工程目录（全部工程登记层） =======================


def _canonical_identity(path: Path) -> tuple[str, str]:
    """返回 (归一化键, 可读路径)。Windows 大小写不敏感去重，但保留原样显示。"""
    try:
        resolved = path.expanduser().resolve()
    except OSError:
        resolved = path
    display = str(resolved)
    key = os.path.normcase(display) if os.name == "nt" else display
    return key, display


def _try_lock_region(fd: int) -> bool:
    """非阻塞加锁成功返回 True；被占用抛 OSError 由调用方处理。"""
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        return True
    import fcntl

    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return True


def _unlock_region(fd: int) -> None:
    with contextlib.suppress(OSError):
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_UN)


@contextlib.contextmanager
def _registry_file_lock(registry: Path) -> Iterator[None]:
    """跨进程/跨线程互斥：OS 级字节范围锁（Windows msvcrt / POSIX fcntl）。

    T0：替换原文件存在性锁——原实现的「等待者读锁内容」与「持有者删锁文件」
    在 Windows 上互相阻塞（读句柄无 FILE_SHARE_DELETE → unlink 失败被吞 →
    锁文件残留死锁）。字节范围锁由内核持有：持有进程死亡即自动释放，无需
    pid 校验或陈旧抢占；同进程内不同句柄同样互斥（已实测）。锁文件本身
    常驻磁盘（空文件），本体写入仍走临时文件 + os.replace。
    """
    lock_path = registry.with_name(registry.name + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR)
    deadline = time.monotonic() + REGISTRY_LOCK_STALE_SECONDS * 6
    try:
        while True:
            try:
                _try_lock_region(fd)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise TimeoutError(f"project registry lock busy: {lock_path}") from None
                time.sleep(0.02)
        yield
    finally:
        _unlock_region(fd)
        os.close(fd)


def _read_registry_payload(registry: Path) -> dict[str, Any]:
    """读注册表原始载荷；损坏文件先落备份再返回空（区分「不存在」与「坏了」）。"""
    try:
        payload = json.loads(registry.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeError, json.JSONDecodeError):
        # T0：坏索引不能当成空索引直接覆盖——保留带时间戳的损坏备份供恢复。
        backup = registry.with_name(f"{registry.name}.corrupt-{int(time.time())}.json")
        with contextlib.suppress(OSError):
            backup.write_bytes(registry.read_bytes())
        return {}
    return payload if isinstance(payload, dict) else {}


def _registry_entries(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entries = payload.get("entries")
    if not isinstance(entries, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for key, value in entries.items():
        if isinstance(key, str) and isinstance(value, dict) and isinstance(value.get("path"), str):
            result[key] = value
    return result


def _read_registry(registry: Path) -> dict[str, dict[str, Any]]:
    return _registry_entries(_read_registry_payload(registry))


def _write_registry(entries: dict[str, dict[str, Any]], registry: Path, *, migrated: bool = False) -> None:
    registry.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{registry.stem}.", suffix=".tmp", dir=registry.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
            payload: dict[str, Any] = {"version": REGISTRY_VERSION, "migrated": migrated, "entries": entries}
            json.dump(payload, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temp_name, registry)
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(temp_name)
        raise


def register_project(path: Path, *, source: str, registry_path: Path | None = None) -> dict[str, Any]:
    """登记一个工程到长期目录。调用方保证此时工程已成功产出/打开（可读）。

    source：``created``（启动器制作）/ ``opened``（启动器打开）/ ``editor``
    （编辑器打开/保存/另存）/ ``migration``（从最近记录迁移）。重复登记只刷新
    更新时间，保留首次登记时间与首个非迁移来源。
    """
    registry = registry_path or project_registry_path()
    key, display = _canonical_identity(path)
    now = _now_iso()
    with _registry_file_lock(registry):
        payload = _read_registry_payload(registry)
        entries = _registry_entries(payload)
        existing = entries.get(key)
        source_value = source
        if existing and existing.get("source") not in ("", "migration"):
            source_value = existing["source"]
        entry = {
            "path": display,
            "name": Path(display).name,
            "source": source_value,
            "registeredAt": (existing or {}).get("registeredAt") or now,
            "updatedAt": now,
        }
        entries[key] = entry
        # 普通登记不宣称迁移已完成——保留文件原标志，缺最近工程时种子仍会补。
        _write_registry(entries, registry, migrated=bool(payload.get("migrated")))
    return {"ok": True, "path": display}


def unregister_project(path: Path, registry_path: Path | None = None) -> dict[str, Any]:
    """「从全部工程记录移除」：只删登记，不动文件与最近视图。"""
    registry = registry_path or project_registry_path()
    key, _display = _canonical_identity(path)
    with _registry_file_lock(registry):
        payload = _read_registry_payload(registry)
        entries = _registry_entries(payload)
        if key not in entries:
            return {"ok": True, "removed": 0}
        del entries[key]
        _write_registry(entries, registry, migrated=bool(payload.get("migrated")))
    return {"ok": True, "removed": 1}


def move_registry_entry(old_path: Path, new_path: Path, registry_path: Path | None = None) -> None:
    """重新定位联动：登记条目随最近视图一起指向新路径（旧键迁移，保留登记时间）。"""
    registry = registry_path or project_registry_path()
    old_key, _old_display = _canonical_identity(old_path)
    new_key, new_display = _canonical_identity(new_path)
    if old_key == new_key:
        return
    with _registry_file_lock(registry):
        payload = _read_registry_payload(registry)
        entries = _registry_entries(payload)
        entry = entries.pop(old_key, None)
        if entry is None:
            return
        entry["path"] = new_display
        entry["name"] = Path(new_display).name
        entry["updatedAt"] = _now_iso()
        entries[new_key] = entry
        _write_registry(entries, registry, migrated=bool(payload.get("migrated")))


def _recycle_file_windows(path: Path) -> tuple[bool, str]:
    """Windows：SHFileOperation + FOF_ALLOWUNDO 把文件移入回收站。"""
    import ctypes

    class _ShFileOpStruct(ctypes.Structure):
        _fields_ = [
            ("hwnd", ctypes.c_void_p),
            ("wFunc", ctypes.c_uint),
            ("pFrom", ctypes.c_wchar_p),
            ("pTo", ctypes.c_wchar_p),
            ("fFlags", ctypes.c_ushort),
            ("fAnyOperationsAborted", ctypes.c_int),
            ("hNameMappings", ctypes.c_void_p),
            ("lpszProgressTitle", ctypes.c_wchar_p),
        ]

    operation = _ShFileOpStruct()
    operation.hwnd = None
    operation.wFunc = 3  # FO_DELETE
    operation.pFrom = str(path) + "\0\0"  # pFrom 要求双 NUL 结尾
    operation.pTo = None
    operation.fFlags = 0x40 | 0x10 | 0x4 | 0x400  # ALLOWUNDO | NOCONFIRMATION | SILENT | NOERRORUI
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
    if result != 0:
        return False, f"SHFileOperationW 失败（错误码 {result}）"
    if operation.fAnyOperationsAborted:
        return False, "操作被系统中止"
    return True, ""


def _recycle_file(path: Path) -> tuple[bool, str]:
    if os.name == "nt":
        return _recycle_file_windows(path)
    try:
        from send2trash import send2trash  # type: ignore[import-not-found]
    except ImportError:
        return False, "当前平台无回收站支持（可打开所在文件夹手动删除）"
    try:
        send2trash(str(path))
    except Exception as error:  # send2trash 会抛出多种系统异常
        return False, str(error)
    return True, ""


def delete_project_file(path: Path, *, registry_path: Path | None = None, metadata_path: Path | None = None) -> dict[str, Any]:
    """「删除工程文件…」：把工程文件移入回收站，并同步清理登记与最近视图。

    只处理工程文件本身——原始视频、音频、同目录文件与 ``.assets`` 一律不动；
    回收站不可用时明确失败，绝不退化为静默永久删除。
    """
    try:
        resolved = path.expanduser().resolve()
    except OSError as error:
        return {"ok": False, "error": str(error)}
    if resolved.suffix.lower() not in PROJECT_SUFFIXES:
        return {"ok": False, "error": f"仅支持删除工程文件（.mosp/.json）：{resolved}"}
    if not resolved.is_file():
        # 文件已不在：登记与最近视图里的失效记录一并清理，不尝试删除其他同名文件。
        unregister_project(resolved, registry_path=registry_path)
        remove_recent_project(resolved, metadata_path=metadata_path)
        return {"ok": True, "path": str(resolved), "alreadyGone": True}
    ok, error = _recycle_file(resolved)
    if not ok:
        return {"ok": False, "error": error, "path": str(resolved)}
    # 回收成功后再更新两组视图与元数据；文件已进回收站，可随时从回收站还原。
    unregister_project(resolved, registry_path=registry_path)
    remove_recent_project(resolved, metadata_path=metadata_path)
    return {"ok": True, "path": str(resolved)}


def _seed_registry_from_recent(registry: Path, *, settings_path: Path | None, metadata_path: Path | None) -> None:
    """从最近合并视图迁移可知工程（幂等合并，以 migrated 标记判定）。

    T0：注册表可能先于迁移被制作/编辑器创建——此时旧最近记录尚未并入。
    用独立 ``migrated`` 标记（而非「文件是否存在」）判定：未标记时合并种子，
    已有登记优先（种子不覆盖），合并后写标记；重复调用无效果。
    """
    payload = _read_registry_payload(registry)
    if payload.get("migrated") is True:
        return
    existing = _registry_entries(payload)
    merged = recent_projects_payload(settings_path=settings_path, metadata_path=metadata_path)
    now = _now_iso()
    entries: dict[str, dict[str, Any]] = dict(existing)
    for project in merged.get("projects", []):
        try:
            key, display = _canonical_identity(Path(str(project.get("path", ""))))
        except OSError:
            continue
        if not display or key in entries:
            continue
        entries[key] = {
            "path": display,
            "name": Path(display).name,
            "source": "migration",
            "registeredAt": project.get("lastOpenedAt") or project.get("modifiedAt") or now,
            "updatedAt": project.get("modifiedAt") or project.get("lastOpenedAt") or now,
        }
    with _registry_file_lock(registry):
        latest = _read_registry_payload(registry)
        if latest.get("migrated") is True:
            return
        merged_entries = _registry_entries(latest) or entries
        # 双检：另一进程可能刚写入新登记——保留其条目再补种子。
        for seed_key, seed_value in entries.items():
            merged_entries.setdefault(seed_key, seed_value)
        _write_registry(merged_entries, registry, migrated=True)


def _ensure_recent_in_registry(registry: Path, *, settings_path: Path | None, metadata_path: Path | None) -> None:
    """T-调整4：把最近视图里尚未登记的工程补入注册表（幂等，写失败不影响读取）。

    历史文件可能因迁移标志误置（早期登记写入默认置 migrated=true）而从未
    执行种子合并——真实最近工程因此缺席全部工程。此处每次读取前补齐，
    保证「全部工程 ⊇ 最近工程」这一包含关系始终成立。
    """
    recent = recent_projects_payload(settings_path=settings_path, metadata_path=metadata_path)
    if not recent.get("projects"):
        return
    with _registry_file_lock(registry):
        payload = _read_registry_payload(registry)
        entries = _registry_entries(payload)
        changed = False
        for project in recent["projects"]:
            try:
                key, display = _canonical_identity(Path(str(project.get("path", ""))))
            except OSError:
                continue
            if not display or key in entries:
                continue
            entries[key] = {
                "path": display,
                "name": Path(display).name,
                "source": "migration",
                "registeredAt": project.get("lastOpenedAt") or project.get("modifiedAt") or _now_iso(),
                "updatedAt": project.get("modifiedAt") or project.get("lastOpenedAt") or _now_iso(),
            }
            changed = True
        if changed:
            _write_registry(entries, registry, migrated=bool(payload.get("migrated")))


def _system_temp_roots() -> list[str]:
    roots = [tempfile.gettempdir()]
    for name in ("TMP", "TEMP", "TMPDIR"):
        value = os.environ.get(name, "").strip()
        if value:
            roots.append(value)
    normalized: list[str] = []
    for root in roots:
        try:
            text = str(Path(root).expanduser().resolve(strict=False))
        except OSError:
            continue
        key = os.path.normcase(text)
        if key not in normalized:
            normalized.append(key)
    return normalized


def read_media_index(index_path: Path | None = None) -> dict[str, str]:
    target = index_path or media_index_path()
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return {str(k): str(v) for k, v in payload.items() if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip()}


def write_media_index(index: dict[str, str], index_path: Path | None = None) -> None:
    target = index_path or media_index_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{target.stem}.", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
            json.dump(index, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temp_name, target)
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(temp_name)
        raise


def note_media_name(path: Path, media_name: str, *, index_path: Path | None = None) -> None:
    """T2/A6：统计/封面载荷带回媒体名时写入轻量索引（写失败不阻断调用方）。"""
    text = str(media_name or "").strip()
    if not text:
        return
    try:
        resolved = str(path.expanduser().resolve())
    except OSError:
        resolved = str(path)
    target = index_path or media_index_path()
    index = read_media_index(target)
    if index.get(resolved) == text:
        return
    index[resolved] = text
    with contextlib.suppress(OSError):
        write_media_index(index, target)


def registry_cleanup_preview(registry_path: Path | None = None) -> dict[str, Any]:
    """T0/§2.3：污染候选预览（只读）——临时目录内且文件已缺失的登记。

    不操作磁盘、不改索引；未知/无法判断的路径一律保留（不粗暴禁止临时工程：
    用户主动打开的临时文件若仍存在则不在候选内）。
    """
    registry = registry_path or project_registry_path()
    entries = _read_registry(registry)
    temp_roots = _system_temp_roots()
    candidates: list[dict[str, Any]] = []
    missing_total = 0
    for entry in entries.values():
        try:
            path = Path(str(entry.get("path", "")))
            exists = path.is_file()
        except OSError:
            exists = False
        if exists:
            continue
        missing_total += 1
        try:
            resolved = str(path.expanduser().resolve(strict=False))
        except OSError:
            resolved = str(path)
        normalized = os.path.normcase(resolved)
        in_temp = any(normalized.startswith(root) for root in temp_roots)
        if in_temp:
            candidates.append({
                "path": str(entry.get("path", "")),
                "name": entry.get("name") or path.name,
                "source": entry.get("source") or "",
                "registeredAt": entry.get("registeredAt") or "",
            })
    return {
        "ok": True,
        "total": len(entries),
        "missing": missing_total,
        "candidates": candidates,
        "candidateCount": len(candidates),
        "keptCount": len(entries) - len(candidates),
    }


def apply_registry_cleanup(registry_path: Path | None = None) -> dict[str, Any]:
    """T0：执行清理——先备份注册表，再移除候选记录；不动任何磁盘媒体/工程文件。"""
    registry = registry_path or project_registry_path()
    preview = registry_cleanup_preview(registry)
    candidate_paths = {item["path"] for item in preview["candidates"]}
    if not candidate_paths:
        return {"ok": True, "removed": 0, "kept": preview["total"], "backup": ""}
    backup = registry.with_name(f"{registry.name}.backup-{int(time.time())}.json")
    with _registry_file_lock(registry):
        payload = _read_registry_payload(registry)
        entries = _registry_entries(payload)
        backup.write_bytes(registry.read_bytes()) if registry.is_file() else backup.write_text(
            json.dumps({"version": REGISTRY_VERSION, "entries": {}}, ensure_ascii=False), encoding="utf-8"
        )
        kept = {key: value for key, value in entries.items() if str(value.get("path", "")) not in candidate_paths}
        _write_registry(kept, registry, migrated=bool(payload.get("migrated")))
    return {
        "ok": True,
        "removed": len(entries) - len(kept),
        "kept": len(kept),
        "backup": str(backup),
    }


def restore_registry_backup(backup_path: Path, registry_path: Path | None = None) -> dict[str, Any]:
    """T0：从清理备份恢复注册表（仅接受应用数据目录内的 .backup- 文件）。"""
    registry = registry_path or project_registry_path()
    backup = backup_path.expanduser().resolve(strict=False)
    if backup.parent != registry.parent.resolve(strict=False) or ".backup-" not in backup.name:
        return {"ok": False, "error": f"拒绝恢复非本目录清理备份：{backup}"}
    if not backup.is_file():
        return {"ok": False, "error": f"备份不存在：{backup}"}
    payload = _read_registry_payload(backup)
    entries = _registry_entries(payload)
    if not entries and not payload:
        return {"ok": False, "error": "备份不是有效的注册表文件"}
    with _registry_file_lock(registry):
        _write_registry(entries, registry, migrated=bool(payload.get("migrated")))
    return {"ok": True, "restored": len(entries), "backup": str(backup)}


def all_projects_payload(
    *,
    settings_path: Path | None = None,
    metadata_path: Path | None = None,
    registry_path: Path | None = None,
    media_index: Path | None = None,
    query: str = "",
    page: int = 1,
    page_size: int = DEFAULT_ALL_PAGE_SIZE,
) -> dict[str, Any]:
    """「全部工程」卡片载荷：长期登记合集按更新时间降序（固定不改变该区排序）。

    T2/§5.3：明确分页契约——`query/page/pageSize` 进，`items(=projects)/total/
    matched/page/pageSize/pages` 出；不再单次硬截断 5000 条。媒体名来自轻量
    索引（渐进建立），搜索覆盖工程名/路径/已知媒体名，响应带 `mediaIndexed`
    说明当前可按媒体名检索的范围。
    """
    registry = registry_path or project_registry_path()
    with contextlib.suppress(OSError):
        _seed_registry_from_recent(registry, settings_path=settings_path, metadata_path=metadata_path)
        # 调整4：即便注册表早已存在（migrated=true），也把最近视图新出现的工程补入注册表，
        # 保证「全部工程」始终包含最近工程（包含关系不变式）。
        _ensure_recent_in_registry(registry, settings_path=settings_path, metadata_path=metadata_path)

    entries = _read_registry(registry)
    metadata = read_launcher_metadata(metadata_path)
    editor_entries = _read_editor_recent_paths(settings_path)
    editor_times = {str(path): opened_at for path, opened_at in editor_entries}
    media_names = read_media_index(media_index)

    needle = query.strip().lower()
    matched: list[dict[str, Any]] = []
    for entry in entries.values():
        try:
            path = Path(str(entry.get("path", "")))
        except OSError:
            continue
        exists = path.is_file()
        key = str(path)
        known_media = media_names.get(key, "")
        if needle:
            haystack = f"{key.lower()}\n{known_media.lower()}"
            if needle not in haystack:
                continue
        matched.append({
            "path": key,
            "name": entry.get("name") or path.name,
            "dir": str(path.parent),
            "exists": exists,
            "pinned": key in metadata.pinned,
            "lastOpenedAt": _latest_iso(editor_times.get(key, ""), metadata.opened_at.get(key, "")),
            "modifiedAt": _mtime_iso(path) if exists else "",
            "registeredAt": entry.get("registeredAt") or "",
            "updatedAt": entry.get("updatedAt") or entry.get("registeredAt") or "",
            "source": entry.get("source") or "",
            "mediaName": known_media,
        })

    # 调整2/C1：固定（图钉）优先 > 工程名（大小写不敏感）> 路径 tiebreak；
    # 时间序只属于最近组。
    matched.sort(key=lambda item: (not item["pinned"], item["name"].casefold(), item["path"]))
    total = len(entries)
    matched_count = len(matched)
    safe_size = max(1, min(int(page_size) or DEFAULT_ALL_PAGE_SIZE, MAX_ALL_PAGE_SIZE))
    pages = max(1, -(-matched_count // safe_size))
    safe_page = min(max(1, int(page) or 1), pages)
    start = (safe_page - 1) * safe_size
    return {
        "ok": True,
        "projects": matched[start:start + safe_size],
        "total": total,
        "matched": matched_count,
        "page": safe_page,
        "pageSize": safe_size,
        "pages": pages,
        "mediaIndexed": len(media_names),
        "query": query.strip(),
    }
