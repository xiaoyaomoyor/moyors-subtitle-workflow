"""Development v2 subtitle contract; migration never writes the input project."""
from __future__ import annotations

from copy import deepcopy

SCHEMA = "msw.project.v2"
LAYOUT_SCHEMA = "msw.subtitle_layers.v1"
LEGACY_SCHEMA = "moy.asr.project.v1"


def _ensure_ids(cues, prefix):
    used = set()
    for cue in cues:
        if not isinstance(cue, dict):
            raise ValueError("Invalid subtitle")
        if cue.get("id"):
            if not isinstance(cue["id"], str):
                raise ValueError("Invalid subtitle ID")
            if cue["id"] in used:
                raise ValueError("Duplicate subtitle ID: " + cue["id"])
            used.add(cue["id"])
    for index, cue in enumerate(cues):
        if cue.get("id"):
            continue
        base = f"{prefix}-{index + 1:03d}"
        value, suffix = base, 2
        while value in used:
            value, suffix = f"{base}-{suffix}", suffix + 1
        cue["id"] = value
        used.add(value)


def _materialize(cues):
    snapshots = []
    for cue in cues:
        result = {}
        for kind in ("color", "sticker"):
            ref = cue.get(kind + "_ref")
            head = ref.get("headIdx") if isinstance(ref, dict) else None
            source = cues[head].get(kind) if type(head) is int and 0 <= head < len(cues) else None
            value = cue.get(kind) or source
            if ref and not value:
                raise ValueError("Dangling " + kind + " reference")
            if value:
                result[kind] = {**deepcopy(value), "start": cue["start"], "end": cue["end"]}
        snapshots.append(result)
    for cue, snapshot in zip(cues, snapshots):
        cue.update(snapshot)
        for kind in ("color", "sticker"):
            cue.pop(kind + "_ref", None)


def migrate_project(source: dict) -> dict:
    if not isinstance(source, dict) or not isinstance(source.get("segments"), list):
        raise ValueError("Invalid subtitle project")
    if "schema" in source and source.get("schema") not in (LEGACY_SCHEMA, SCHEMA):
        raise ValueError("Unsupported project schema")
    project = deepcopy(source)
    if project.get("schema") == SCHEMA:
        return project
    main = project["segments"]
    overlay = project.get("overlay_track") or {}
    extra = overlay.get("segments") or []
    _ensure_ids(main, "main")
    _ensure_ids(extra, "overlay")
    _materialize(main)
    _materialize(extra)
    used = {cue["id"] for cue in main}
    remap = {}
    for index, cue in enumerate(extra):
        old = cue["id"]
        base = f"legacy-overlay-{index + 1}"
        value = base if old in used else old
        suffix = 2
        while value in used:
            value, suffix = f"{base}-{suffix}", suffix + 1
        used.add(value)
        remap[old] = value
        cue["id"] = value

    def rewrite(value):
        if isinstance(value, dict):
            if value.get("track_kind") == "overlay" or value.get("role") == "overlay":
                for field in ("id", "cue_id", "segment_id"):
                    if isinstance(value.get(field), str) and value[field] in remap:
                        value[field] = remap[value[field]]
                if value.get("track_kind") == "overlay":
                    value.pop("track_kind")
                if value.get("role") == "overlay":
                    value["role"] = "main"
            for child in value.values():
                rewrite(child)
        elif isinstance(value, list):
            for child in value:
                rewrite(child)

    rewrite(project.get("msw"))
    main.extend(extra)
    main.sort(key=lambda cue: cue["start"])
    for track in (project.get("multi_subtitle") or {}).get("tracks", []):
        cues = track.get("segments") or []
        _ensure_ids(cues, f"{track['id']}-segment")
        _materialize(cues)
        cues.sort(key=lambda cue: cue["start"])
    project["subtitle_layers"] = {
        "schema": LAYOUT_SCHEMA,
        "allow_overlap": overlay.get("enabled") is True if source.get("overlay_track") is not None else True,
        "legacy_overlay": {"visible": overlay.get("enabled") is True, "cue_ids": [cue["id"] for cue in extra]},
    }
    project.pop("overlay_track", None)
    project["schema"] = SCHEMA
    return project


def validate_layout(project):
    value = project.get("subtitle_layers")
    if not isinstance(value, dict) or value.get("schema") != LAYOUT_SCHEMA:
        return [("$.subtitle_layers", "must be a v1 subtitle presentation object")]
    errors = []
    if type(value.get("allow_overlap")) is not bool:
        errors.append(("$.subtitle_layers.allow_overlap", "must be a boolean"))
    legacy = value.get("legacy_overlay", {})
    ids = {cue.get("id") for cue in project.get("segments", []) if isinstance(cue, dict)}
    if (not isinstance(legacy, dict) or type(legacy.get("visible")) is not bool
            or not isinstance(legacy.get("cue_ids"), list)
            or any(not isinstance(cue_id, str) or cue_id not in ids for cue_id in legacy.get("cue_ids", []))
            or len(set(legacy["cue_ids"])) != len(legacy["cue_ids"])):
        errors.append(("$.subtitle_layers.legacy_overlay", "must preserve valid legacy visibility and main cue IDs"))
    overlay = project.get("overlay_track")
    if overlay is not None and (not isinstance(overlay, dict) or overlay.get("segments")):
        errors.append(("$.overlay_track", "v2 subtitles belong to main or extension roles"))
    return errors


def require_production_schema(project):
    if project.get("schema") == SCHEMA:
        raise ValueError("统一多层字幕 A–C 为开发预览；保存与处理输出须待 D–G 适配完成，不能写成旧格式。")
