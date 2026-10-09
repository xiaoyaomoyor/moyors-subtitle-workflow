"""Opt-in v3 migration codec. Never used implicitly by the current editor.

Run ``python -m maw.msw.subtitle_tracks_io project.mosp`` for a read-only report.
``--write`` explicitly upgrades that same file, after a durable original backup.
Keeping the directory/name unchanged preserves relative media and .assets paths.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from maw.file_io import FileSaveError, atomic_output_path
from maw.msw import subtitle_layers, subtitle_tracks
from maw.project import ProjectValidationFailed, validate_project


class MigrationCancelled(ValueError):
    pass


@dataclass(frozen=True)
class TrackDocument:
    path: Path
    original: bytes
    project: dict


@dataclass(frozen=True)
class TrackSaveResult:
    document: TrackDocument
    backup: Path | None


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"工程 JSON 含重复字段 {key}，无法安全迁移")
        result[key] = value
    return result


def _nonfinite(value):
    raise ValueError(f"工程 JSON 含无效数值 {value}")


def _decode(raw):
    return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_object, parse_constant=_nonfinite)


def _validate_content(project):
    subtitle_tracks.validate(project)
    # Content remains the v2 contract. Validation may normalize its private
    # copy, but we deliberately serialize the original, lossless data instead.
    result = validate_project({**project, "schema": subtitle_layers.SCHEMA})
    if not result.ok:
        raise ProjectValidationFailed(result.errors)


def serialize_project(project):
    _validate_content(project)
    return json.dumps(project, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def read_project(path):
    path = Path(path).resolve(strict=True)
    original = path.read_bytes()
    source = _decode(original)
    project = subtitle_tracks.migrate_project(source)
    _validate_content(project)
    return TrackDocument(path, original, project)


def _check_current(document, cancelled):
    if cancelled and cancelled():
        raise MigrationCancelled("已取消固定轨道迁移；原文件未覆盖")
    if document.path.read_bytes() != document.original:
        raise ValueError("工程文件已被其他程序修改，请重新读取后再迁移；未覆盖较新内容")


def _backup(document):
    # Short, exclusive names avoid adding a suffix to already long filenames.
    # A backup is the original bytes, including BOM/formatting, not regenerated JSON.
    backup = document.path.with_name(f".msw-tracks-backup-{uuid4().hex}.mosp")
    created = False
    try:
        with backup.open("xb") as handle:
            created = True
            handle.write(document.original)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as error:
        if created:
            with suppress(OSError):
                backup.unlink()
        raise FileSaveError(backup, error, operation="备份旧工程（原工程未覆盖）") from error
    return backup


@contextmanager
def _writer_lock(path):
    digest = hashlib.sha256(os.fsencode(str(path))).hexdigest()[:20]
    lock = path.with_name(f".msw-tracks-{digest}.lock")
    try:
        handle = lock.open("xb")
    except FileExistsError as error:
        raise ValueError("该工程已有固定轨道写入任务，未覆盖文件；若任务异常退出，请确认后清理旁边的 .msw-tracks-*.lock") from error
    try:
        handle.close()
        yield
    finally:
        with suppress(OSError):
            lock.unlink(missing_ok=True)


def save_project(document, project=None, *, cancelled=None):
    """Save to the original path only; return a new revision for further edits.

    The lock coordinates this codec's writers. Byte comparisons additionally
    detect external changes before backup and immediately before replacement.
    External programs must not save concurrently during the final OS replace.
    """
    content = serialize_project(document.project if project is None else project)
    encoded = content.encode("utf-8")
    with _writer_lock(document.path):
        _check_current(document, cancelled)
        old = _decode(document.original)
        if not isinstance(old, dict) or old.get("schema", subtitle_layers.LEGACY_SCHEMA) not in (
                subtitle_layers.LEGACY_SCHEMA, subtitle_layers.SCHEMA, subtitle_tracks.SCHEMA):
            raise ValueError("不支持的原工程版本；未覆盖文件")
        backup = _backup(document) if old.get("schema") != subtitle_tracks.SCHEMA else None
        with atomic_output_path(document.path) as pending:
            with pending.open("wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            _check_current(document, cancelled)
    return TrackSaveResult(TrackDocument(document.path, encoded, _decode(encoded)), backup)


def main(argv=None):
    parser = argparse.ArgumentParser(description="固定字幕轨道第二阶段迁移工具；默认只检查。当前日常编辑器尚不接受 v3。")
    parser.add_argument("project", type=Path)
    parser.add_argument("--write", action="store_true", help="先备份原文件，再在原位置写入 v3；请仅在测试工程上使用")
    args = parser.parse_args(argv)
    try:
        document = read_project(args.project)
        metadata = document.project["subtitle_tracks"]
        print(f"检查通过：{len(metadata['tracks'])} 条固定轨道，{len(metadata['assignments'])} 条字幕。")
        if args.write:
            result = save_project(document)
            print(f"已写入：{document.path}")
            if result.backup:
                print(f"原始备份：{result.backup}")
        else:
            print("仅在内存迁移，原文件未修改。")
        print("阶段 3–5 尚未启用：当前编辑器、预览与导出会拒绝 v3，请继续使用旧工程。")
        return 0
    except (ValueError, OSError, TypeError, KeyError) as error:
        print(f"迁移失败：{error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
