"""Launcher-side recent-project index.

最近工程的真源是编辑器服务的 ``server-editor-settings.json``（``recent_projects``）：
编辑器打开、保存、另存为成功都会更新它。启动器只读该文件，不并行写它，
避免两个进程同时写同一 JSON 造成覆盖。

启动器自己额外的视图状态（固定、从记录移除、失效路径的重新定位映射、
启动器侧打开时间）保存在独立的 ``launcher-recent.json`` 元数据里。
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final

from maw.app_paths import default_app_data_root, default_server_settings_path

LAUNCHER_RECENT_FILE_NAME: Final = "launcher-recent.json"
MAX_RECENT_ENTRIES: Final = 50
# 统计解析的工程大小上限：更大的工程仍可打开，但卡片不解析统计（显示为未知）。
STATS_SIZE_LIMIT: Final = 64 * 1024 * 1024


def launcher_recent_metadata_path() -> Path:
    return default_app_data_root() / LAUNCHER_RECENT_FILE_NAME


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


def _read_editor_recent_paths(settings_path: Path | None = None) -> list[Path]:
    """Read the editor-owned recent list (read-only for the launcher)."""
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
    paths: list[Path] = []
    for value in values:
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            continue
        try:
            paths.append(Path(value["path"]).expanduser().resolve())
        except OSError:
            continue
    return paths


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
    editor_paths = _read_editor_recent_paths(settings_path)

    merged: dict[str, Path] = {}
    ordered: list[Path] = []
    for raw in editor_paths:
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
            "lastOpenedAt": metadata.opened_at.get(key, ""),
            "modifiedAt": _mtime_iso(path) if exists else "",
        })
    return {"ok": True, "projects": projects}


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


def relocate_recent_project(old_path: Path, new_path: Path, metadata_path: Path | None = None) -> dict[str, Any]:
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
    return {
        "ok": True,
        "path": str(resolved),
        "mainSubtitles": main_count,
        "subSubtitles": sub_count,
        "audioClips": audio_count,
    }
