"""Fixed subtitle ownership (stage 2); not yet enabled in production consumers.

Content stays in segments/multi_subtitle. A display track is not a language
storage track, and changing ownership never changes a cue's stable identity.
"""
from __future__ import annotations

import json
from bisect import bisect_left
from copy import deepcopy

from maw.msw import subtitle_layers as layers

SCHEMA = "msw.project.v3"
TRACK_SCHEMA = "msw.subtitle_tracks.v1"


def key(ref):
    return json.dumps([ref.get("role"), ref.get("track_id"), ref.get("cue_id")], ensure_ascii=False, separators=(",", ":"))


def _stable(value):
    return isinstance(value, str) and bool(value.strip()) and len(value.encode("utf-16-le")) // 2 <= 160


def _fail(message):
    raise ValueError("固定字幕轨道：" + message)


def _records(project):
    if not isinstance(project, dict) or not isinstance(project.get("segments"), list):
        _fail("segments 必须是数组")
    if project.get("multi_subtitle") is not None and not isinstance(project["multi_subtitle"], dict):
        _fail("副字幕数据必须是对象")
    tracks = (project.get("multi_subtitle") or {}).get("tracks", [])
    if not isinstance(tracks, list):
        _fail("副字幕轨道必须是数组")
    ids = set()
    for track in tracks:
        if not isinstance(track, dict) or not _stable(track.get("id")) or track["id"] in ids or not isinstance(track.get("segments"), list):
            _fail("副字幕轨道 ID 重复或内容无效")
        ids.add(track["id"])
    rows = []
    sources = [("main", None, project["segments"])] + [("extension", t["id"], t["segments"]) for t in tracks]
    for role, track_id, cues in sources:
        seen = set()
        for index, cue in enumerate(cues):
            if (not isinstance(cue, dict) or not _stable(cue.get("id")) or cue["id"] in seen
                    or any(type(cue.get(edge)) is not int or abs(cue[edge]) > 2**53 - 1 for edge in ("start", "end"))
                    or cue["start"] < 0 or cue["end"] <= cue["start"]):
                _fail("字幕 ID 重复或时间范围无效")
            seen.add(cue["id"])
            rows.append(dict(role=role, track_id=track_id, cue_id=cue["id"], cue=cue, index=index))
    return rows


def _groups(project, rows):
    by_key = {key(row): row for row in rows}
    partner, used_ids = {}, set()
    multi = project.get("multi_subtitle") or {}
    bindings = multi.get("bindings", [])
    if not isinstance(bindings, list):
        _fail("绑定必须是数组")
    for binding in bindings:
        if not isinstance(binding, dict):
            _fail("绑定内容无效")
        if "id" in binding:
            if not _stable(binding["id"]) or binding["id"] in used_ids:
                _fail("绑定 ID 无效或重复")
            used_ids.add(binding["id"])
        tracks = multi.get("tracks", [])
        track_id = binding.get("track_id")
        if track_id is None and len(tracks) == 1:
            track_id = tracks[0]["id"]
        main = binding.get("main_segment_ids", [binding.get("main_segment_id")])
        ext = binding.get("extension_segment_ids", [binding.get("extension_segment_id")])
        if not isinstance(main, list) or len(main) != 1 or not isinstance(ext, list) or len(ext) != 1:
            _fail("绑定必须明确对应一条主字幕和一条副字幕")
        a = key(dict(role="main", track_id=None, cue_id=main[0]))
        b = key(dict(role="extension", track_id=track_id, cue_id=ext[0]))
        if a not in by_key or b not in by_key or a in partner or b in partner:
            _fail("绑定引用失效或重复；未修改工程")
        for field, edge in (("start_offset_ms", "start"), ("end_offset_ms", "end")):
            value = binding.get(field)
            if value is not None and (type(value) is not int or value != by_key[b]["cue"][edge] - by_key[a]["cue"][edge]):
                _fail("绑定时间偏移与字幕不一致")
        partner[a], partner[b] = b, a
    groups, visited = [], set()
    for row in rows:
        identity = key(row)
        if identity in visited:
            continue
        group = [row]
        visited.add(identity)
        if identity in partner:
            group.append(by_key[partner[identity]])
            visited.add(partner[identity])
        groups.append(group)
    return groups


def _validate_legacy_layout(project):
    metadata = project.get("subtitle_layers")
    if not isinstance(metadata, dict) or not isinstance(metadata.get("legacy_overlay"), dict):
        _fail("旧显示元数据无效；未修改工程")
    errors = layers.validate_layout({**project, "schema": layers.SCHEMA})
    if errors:
        _fail("; ".join(f"{path}: {message}" for path, message in errors))


def validate(project):
    if not isinstance(project, dict) or project.get("schema") != SCHEMA:
        _fail("不支持的工程版本")
    rows = _records(project)
    _validate_legacy_layout(project)
    groups = _groups(project, rows)
    metadata = project.get("subtitle_tracks")
    if (not isinstance(metadata, dict) or metadata.get("schema") != TRACK_SCHEMA or metadata.get("presentation") != "legacy"
            or not isinstance(metadata.get("tracks"), list) or not metadata["tracks"] or not isinstance(metadata.get("assignments"), list)):
        _fail("轨道元数据无效")
    if "legacy_overlay_settings" in metadata and (not isinstance(metadata["legacy_overlay_settings"], dict)
                                                 or "segments" in metadata["legacy_overlay_settings"]):
        _fail("旧叠加设置不能包含第二份字幕正文")
    tracks = {}
    for track in metadata["tracks"]:
        if (not isinstance(track, dict) or not _stable(track.get("id")) or track["id"] in tracks or not _stable(track.get("name"))
                or track.get("kind") not in ("dialogue", "annotation") or track.get("origin") not in ("main", "legacy-overlay")
                or any(type(track.get(k)) is not bool for k in ("enabled", "locked", "collapsed"))
                or track.get("style") != {"mode": "inherit"}):
            _fail("轨道 ID、名称、状态或样式无效")
        tracks[track["id"]] = track
    by_key, owners = {key(row): row for row in rows}, {}
    for entry in metadata["assignments"]:
        if (not isinstance(entry, dict) or entry.get("role") not in ("main", "extension")
                or (entry.get("track_id", False) is not None if entry["role"] == "main" else not _stable(entry.get("track_id")))
                or not _stable(entry.get("cue_id")) or key(entry) not in by_key or key(entry) in owners
                or not _stable(entry.get("subtitle_track_id")) or entry["subtitle_track_id"] not in tracks):
            _fail("字幕归属缺失、重复或引用不存在的对象")
        owners[key(entry)] = entry["subtitle_track_id"]
    if len(owners) != len(rows):
        _fail("每条字幕必须且只能归属一条固定轨道")
    for group in groups:
        if len({owners[key(row)] for row in group}) > 1:
            _fail("绑定主副字幕必须归属同一轨道")
    lanes = {}
    for row in rows:
        lanes.setdefault((owners[key(row)], row["role"], row["track_id"]), []).append(row["cue"])
    for cues in lanes.values():
        cues.sort(key=lambda cue: cue["start"])
        if any(b["start"] < a["end"] for a, b in zip(cues, cues[1:])):
            _fail("同轨同角色字幕重叠；请分配到不同轨道")
    return True


def _insertion(cues, cue):
    index = bisect_left(cues, cue["start"], key=lambda value: value["start"])
    if (index and cues[index - 1]["end"] > cue["start"]) or (index < len(cues) and cue["end"] > cues[index]["start"]):
        return -1
    return index


def migrate_project(source):
    if isinstance(source, dict) and source.get("schema") == SCHEMA:
        validate(source)
        return deepcopy(source)
    if isinstance(source, dict) and "subtitle_tracks" in source:
        _fail("旧版本中已包含固定轨道字段，无法安全覆盖")
    prepared = deepcopy(source)
    if isinstance(prepared, dict) and prepared.get("schema") != layers.SCHEMA and isinstance(prepared.get("multi_subtitle"), dict):
        tracks = prepared["multi_subtitle"].get("tracks")
        if isinstance(tracks, list):
            reserved = {t["id"] for t in tracks if isinstance(t, dict) and isinstance(t.get("id"), str)}
            for index, track in enumerate(tracks):
                if not isinstance(track, dict) or "id" in track:
                    continue
                base = f"extension-{index + 1:03d}"
                value = f"{base}-generated" if base in reserved else base
                suffix = 2
                while value in reserved:
                    value, suffix = f"{base}-generated-{suffix}", suffix + 1
                track["id"] = value
                reserved.add(value)
    try:
        project = layers.migrate_project(prepared)
    except (TypeError, KeyError, AttributeError) as error:
        raise ValueError("固定字幕轨道：旧工程结构无效；未修改工程") from error
    rows = _records(project)
    _validate_legacy_layout(project)
    groups = _groups(project, rows)
    legacy = project["subtitle_layers"]["legacy_overlay"]
    overlay_ids = set(legacy["cue_ids"])

    def overlay(row):
        return row["role"] == "main" and row["cue_id"] in overlay_ids

    metadata = dict(schema=TRACK_SCHEMA, presentation="legacy", tracks=[], assignments=[])
    if source.get("overlay_track"):
        metadata["legacy_overlay_settings"] = {k: deepcopy(v) for k, v in source["overlay_track"].items() if k != "segments"}
    slots, counts = [], {"main": 0, "legacy-overlay": 0}

    def create(origin, enabled):
        counts[origin] += 1
        old_name = metadata.get("legacy_overlay_settings", {}).get("name")
        overlay_name = old_name if _stable(old_name) else "原叠加字幕"
        # Match JS UTF-16 slicing without cutting a Unicode surrogate pair.
        overlay_name = overlay_name.encode("utf-16-le")[:280].decode("utf-16-le", errors="ignore")
        name = "对白" if origin == "main" else overlay_name
        track = dict(id=f"subtitle-track-{len(slots) + 1}", name=f"{name} {counts[origin]}", kind="dialogue",
                     origin=origin, enabled=enabled, locked=False, collapsed=False, style={"mode": "inherit"})
        metadata["tracks"].append(track)
        slot = dict(track=track, lanes={})
        slots.append(slot)
        return slot

    create("main", True)
    ordered = []
    for index, group in enumerate(groups):
        origin = "legacy-overlay" if any(overlay(row) for row in group) else "main"
        enabled = any(not overlay(row) or legacy["visible"] for row in group)
        ordered.append((origin != "main", min(row["cue"]["start"] for row in group), index, group, origin, enabled))
    ordered.sort(key=lambda entry: entry[:3])
    owners = {}
    for _, _, _, group, origin, enabled in ordered:
        slot = next((s for s in slots if s["track"]["origin"] == origin and s["track"]["enabled"] == enabled
                     and all(_insertion(s["lanes"].get((r["role"], r["track_id"]), []), r["cue"]) >= 0 for r in group)), None)
        if slot is None:
            slot = create(origin, enabled)
        for row in group:
            cues = slot["lanes"].setdefault((row["role"], row["track_id"]), [])
            cues.insert(_insertion(cues, row["cue"]), row["cue"])
            owners[key(row)] = slot["track"]["id"]
    metadata["assignments"] = [dict(role=row["role"], track_id=row["track_id"], cue_id=row["cue_id"], subtitle_track_id=owners[key(row)]) for row in rows]
    project.update(schema=SCHEMA, subtitle_tracks=metadata)
    validate(project)
    return project


class TrackIndex:
    """Snapshot index: rebuild after content/ownership changes, never sort cues.

    Hidden means fixed-track/legacy-overlay visibility. Language display mode,
    preview preferences and export role choices are consumer-level filters.
    """

    def __init__(self, project):
        validate(project)
        self.project = project
        self.tracks = {track["id"]: track for track in project["subtitle_tracks"]["tracks"]}
        self.owners = {key(entry): entry["subtitle_track_id"] for entry in project["subtitle_tracks"]["assignments"]}
        self.rows = [{**row, "subtitle_track_id": self.owners[key(row)]} for row in _records(project)]
        self.by_key = {key(row): row for row in self.rows}
        legacy = project["subtitle_layers"]["legacy_overlay"]
        self.hidden = set(legacy["cue_ids"]) if not legacy["visible"] else set()

    def resolve(self, ref):
        return self.by_key.get(key(ref))

    def track_for(self, ref):
        return self.tracks.get(self.owners.get(key(ref)))

    def records(self, *, subtitle_track_id=None, role=None, include_hidden=False, include_disabled=True):
        return [row for row in self.rows
                if (subtitle_track_id is None or row["subtitle_track_id"] == subtitle_track_id)
                and (role is None or row["role"] == role)
                and (include_hidden or (self.tracks[row["subtitle_track_id"]]["enabled"]
                     and not (row["role"] == "main" and row["cue_id"] in self.hidden)))
                and (include_disabled or not row["cue"].get("disabled"))]


def assign(project, refs, target_id):
    index = TrackIndex(project)
    target = index.tracks.get(target_id)
    if target is None or target["locked"]:
        _fail("目标轨道不存在或已锁定")
    moving = set()
    for ref in refs:
        if index.resolve(ref) is None:
            _fail("字幕引用已失效")
        moving.add(key(ref))
    for group in _groups(project, _records(project)):
        if any(key(row) in moving for row in group):
            moving.update(key(row) for row in group)
    for ref in project["subtitle_tracks"]["assignments"]:
        if key(ref) in moving and index.track_for(ref)["locked"]:
            _fail("绑定操作包含锁定轨道，未修改工程")
    result = deepcopy(project)
    for ref in result["subtitle_tracks"]["assignments"]:
        if key(ref) in moving:
            ref["subtitle_track_id"] = target_id
    validate(result)
    return result
