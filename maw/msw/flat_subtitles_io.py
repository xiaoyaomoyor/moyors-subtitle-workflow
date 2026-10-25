"""Native v4 persistence and migration codec. CLI/read_project is read-only.

The normal editor upgrades on save with an original-byte backup. The CLI only
writes when explicitly invoked with ``--write-v4``.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from maw.file_io import atomic_output_path
from maw.msw import flat_subtitles as core
from maw.msw import subtitle_tracks_io as legacy_io

# Shared lock and byte comparisons coordinate both migration codecs. Do not
# invent a second lock namespace that permits a v3 writer to race a v4 writer.
FlatDocument = legacy_io.TrackDocument
FlatSaveResult = legacy_io.TrackSaveResult
MigrationCancelled = legacy_io.MigrationCancelled


def serialize_project(project, *, _validated=False):
    if not _validated:
        core.validate(project)
    # Compact JSON uses the C encoder and avoids megabytes of indentation in
    # long projects. The data contract and UTF-8/LF format remain unchanged.
    return json.dumps(project, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + "\n"


def read_project(path):
    path = Path(path).resolve(strict=True)
    original = path.read_bytes()
    source = legacy_io._decode(original)
    project = core.migrate_project(source)
    if source.get("schema") != core.SCHEMA:
        # Validate legacy ancillary/content contracts without serializing the
        # validator's normalized copy (which could change word timings).
        legacy_io._validate_content(core.legacy_projection(project))
    return FlatDocument(path, original, project)


def save_project(document, project=None, *, cancelled=None, previous_backup=False, _validated=False, _validated_original=False):
    """Explicit write to original location; first upgrade has a byte backup.

    A revision can be used once. Cancellation/external changes reject before
    replacement; I/O failures preserve the original. Atomic replacement cannot
    coordinate a third-party writer that ignores our shared lock.
    """
    value = document.project if project is None else project
    encoded = serialize_project(value, _validated=_validated).encode("utf-8")
    with legacy_io._writer_lock(document.path):
        legacy_io._check_current(document, cancelled)
        source = legacy_io._decode(document.original)
        # Native originals need validation, not another full migration copy.
        # Unknown versions and forged documents still fail before any write.
        if _validated_original:
            pass  # Internal caller compared the bytes to its last successful save.
        elif isinstance(source, dict) and source.get("schema") == core.SCHEMA:
            core.validate(source)
        else:
            core.migrate_project(source)
        backup = legacy_io._backup(document) if source.get("schema") != core.SCHEMA else None
        if previous_backup:
            previous = document.path.with_suffix(document.path.suffix + '.bak')
            with atomic_output_path(previous) as pending:
                with pending.open('wb') as handle:
                    handle.write(document.original)
                    handle.flush()
                    os.fsync(handle.fileno())
            backup = backup or previous
        with atomic_output_path(document.path) as pending:
            with pending.open("wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            legacy_io._check_current(document, cancelled)
    return FlatSaveResult(FlatDocument(document.path, encoded, legacy_io._decode(encoded)), backup)


def main(argv=None):
    parser = argparse.ArgumentParser(description="平级字幕 v4 数据迁移检查；默认只读。")
    parser.add_argument("project", type=Path)
    parser.add_argument("--write-v4", action="store_true", help="备份并原位写入 v4，可使用普通编辑器打开")
    args = parser.parse_args(argv)
    try:
        document = read_project(args.project)
        model = document.project["subtitles"]
        print(f"检查通过：{len(model['tracks'])} 条平级轨道，{len(model['cues'])} 条字幕，{len(model['bindings'])} 组对应关系。")
        if args.write_v4:
            result = save_project(document)
            print(f"已写入 v4：{document.path}")
            if result.backup:
                print(f"原始备份：{result.backup}")
        else:
            print("仅在内存迁移，原文件未修改。")
        print("可在普通编辑器中继续编辑；旧工程首次保存升级时保留原始备份。")
        return 0
    except (ValueError, OSError, TypeError, KeyError) as error:
        print(f"迁移失败：{error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
