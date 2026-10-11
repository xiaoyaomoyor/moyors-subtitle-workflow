"""Role-independent subtitle model; mirrored by web/msw-flat-subtitles.js.

This is the v4 data foundation, not the production editor's default format.
Content is stored once. Legacy identities are aliases, never array positions.
"""
from __future__ import annotations

import json
import math
from copy import deepcopy

from maw.msw import subtitle_tracks as old

SCHEMA = "msw.project.v4"
MODEL_SCHEMA = "msw.subtitles.v1"
MIGRATION_SCHEMA = "msw.subtitle-migration.v1"
STRUCTURAL = ("segments", "multi_subtitle", "subtitle_tracks", "subtitle_layers", "overlay_track")
MAX_INT = 2**53 - 1


def _fail(message):
    raise ValueError("平级字幕：" + message)


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _alias_key(ref):
    return _json([ref.get("role"), ref.get("track_id"), ref.get("cue_id")])


def identity(prefix, key):
    """Stable identity, not a cryptographic digest. Match JS UTF-16LE exactly."""
    value = 0xcbf29ce484222325
    for byte in key.encode("utf-16-le", errors="surrogatepass"):
        value = ((value ^ byte) * 0x100000001b3) & (2**64 - 1)
    return f"{prefix}-{value:016x}"


def _stable(value):
    return isinstance(value, str) and bool(value.strip()) and len(value.encode("utf-16-le", errors="surrogatepass")) // 2 <= 160


def _int(value):
    return type(value) is int and abs(value) <= MAX_INT


def _integer(value):
    return _int(value) and value >= 0


def _json_value(value, seen=None):
    if value is None or type(value) in (str, bool):
        return
    if type(value) in (int, float) and abs(value) <= MAX_INT and math.isfinite(value):
        return
    if isinstance(value, list) or isinstance(value, dict) and all(isinstance(key, str) for key in value):
        seen = set() if seen is None else seen
        if id(value) in seen:
            _fail("包含循环引用")
        seen.add(id(value))
        for item in value.values() if isinstance(value, dict) else value:
            _json_value(item, seen)
        seen.remove(id(value))
        return
    _fail("包含不能保存为 JSON 的值")


def _frame_pair(value):
    if (("start_frame" in value) != ("end_frame" in value)
            or "start_frame" in value and (not _integer(value["start_frame"]) or not _integer(value["end_frame"]) or value["end_frame"] <= value["start_frame"])):
        _fail("帧时间码无效")


def _content_valid(cue):
    if (not isinstance(cue, dict) or "id" in cue or not _integer(cue.get("start")) or not _integer(cue.get("end"))
            or cue["end"] <= cue["start"] or not isinstance(cue.get("text"), str)
            or "disabled" in cue and type(cue["disabled"]) is not bool):
        _fail("字幕时间或正文无效")
    _frame_pair(cue)
    if "speaker" in cue and (not isinstance(cue["speaker"], str) or not cue["speaker"].strip()):
        _fail("说话人无效")
    if "items" in cue:
        if not isinstance(cue["items"], list):
            _fail("逐词时间码必须是数组")
        previous = cue["start"]
        for item in cue["items"]:
            if (not isinstance(item, dict) or not _integer(item.get("start")) or not _integer(item.get("end"))
                    or item["start"] < previous or item["end"] < item["start"] or item["end"] > cue["end"] or not isinstance(item.get("text"), str)):
                _fail("逐词时间码无效")
            _frame_pair(item)
            previous = item["end"]
    if "subtitle_position" in cue and not old._position_valid(cue["subtitle_position"]):
        _fail("字幕位置无效")
    for field in ("color", "sticker"):
        head = cue.get(field)
        if head is not None and (not isinstance(head, dict)
                                or "name" in head and (not isinstance(head["name"], str) or not head["name"].strip())
                                or any(k in head and not _int(head[k]) for k in ("start", "end"))
                                or "start" in head and "end" in head and head["end"] < head["start"]):
            _fail("字幕标记无效")


def validate(project):
    _json_value(project)
    if not isinstance(project, dict) or project.get("schema") != SCHEMA:
        _fail("不支持的工程版本")
    if any(k in project for k in STRUCTURAL):
        _fail("新工程不能同时保存旧主副正文或归属")
    if "timebase" in project:
        timebase = project["timebase"]
        if (not isinstance(timebase, dict) or timebase.get("unit") not in ("milliseconds", "frames")
                or type(timebase.get("fps")) not in (int, float) or not 1 <= timebase["fps"] <= 240):
            _fail("时间基准无效")
    model = project.get("subtitles")
    if (not isinstance(model, dict) or model.get("schema") != MODEL_SCHEMA
            or not isinstance(model.get("tracks"), list) or not model["tracks"]
            or not isinstance(model.get("cues"), list) or not isinstance(model.get("bindings"), list)):
        _fail("字幕结构无效")
    tracks, cues, lanes = {}, {}, {}
    for track in model["tracks"]:
        if (not isinstance(track, dict) or not _stable(track.get("id")) or track["id"] in tracks or not _stable(track.get("name"))
                or any(k in track for k in ("parent_id", "children", "segments", "cues"))
                or track.get("purpose") not in ("none", "dialogue", "source", "translation", "annotation")
                or track.get("layout") not in ("auto", "fixed")
                or any(type(track.get(k)) is not bool for k in ("enabled", "locked", "collapsed"))
                or not isinstance(track.get("style"), dict) or track["style"].get("slot") not in ("main", "secondary")
                or track["style"].get("base") not in ("dialogue", "annotation")):
            _fail("轨道身份、状态或样式无效")
        style = {k: v for k, v in track["style"].items() if k not in ("slot", "base")}
        if not old._style_valid(style) or "position" in track and not old._position_valid(track["position"]):
            _fail("轨道样式或位置无效")
        tracks[track["id"]], lanes[track["id"]] = track, []
    for cue in model["cues"]:
        if (not isinstance(cue, dict) or not _stable(cue.get("id")) or cue["id"] in cues
                or not isinstance(cue.get("track_id"), str) or cue["track_id"] not in tracks
                or "hidden" in cue and type(cue["hidden"]) is not bool):
            _fail("字幕身份、归属或显示状态无效")
        _content_valid(cue.get("content"))
        cues[cue["id"]] = cue
        lanes[cue["track_id"]].append(cue)
    for lane in lanes.values():
        lane.sort(key=lambda c: c["content"]["start"])
        if any(b["content"]["start"] < a["content"]["end"] for a, b in zip(lane, lane[1:])):
            _fail("同一轨道的字幕重叠")
    for cue in cues.values():
        for field in ("color_ref", "sticker_ref"):
            ref = cue["content"].get(field)
            if ref is None:
                continue
            head_field = field.removesuffix("_ref")
            target = cues.get(ref.get("cue_id")) if isinstance(ref, dict) and isinstance(ref.get("cue_id"), str) else None
            head = target["content"].get(head_field) if target else None
            if (not isinstance(ref, dict) or "headIdx" in ref or ref.get("cue_id") == cue["id"] or cue["content"].get(head_field) is not None
                    or not isinstance(head, dict) or isinstance(head.get("name"), str) and isinstance(ref.get("name"), str) and head["name"] != ref["name"]):
                _fail("字幕标记引用失效")
    used, ids = set(), set()
    for link in model["bindings"]:
        if not isinstance(link, dict):
            _fail("对应关系无效")
        a = cues.get(link.get("source_id")) if isinstance(link.get("source_id"), str) else None
        b = cues.get(link.get("target_id")) if isinstance(link.get("target_id"), str) else None
        if (not _stable(link.get("id")) or link["id"] in ids or not a or not b or a["id"] == b["id"] or a["track_id"] == b["track_id"]
                or a["id"] in used or b["id"] in used
                or not _int(link.get("start_offset_ms")) or link["start_offset_ms"] != b["content"]["start"] - a["content"]["start"]
                or not _int(link.get("end_offset_ms")) or link["end_offset_ms"] != b["content"]["end"] - a["content"]["end"]):
            _fail("对应关系重复、失效或时间偏移不一致")
        used.update((a["id"], b["id"]))
        ids.add(link["id"])
    if "migration" in model:
        h = model["migration"]
        if (not isinstance(h, dict) or h.get("schema") != MIGRATION_SCHEMA or not isinstance(h.get("structure"), dict)
                or not isinstance(h.get("identities"), list) or not set(h["structure"]) <= set(STRUCTURAL)):
            _fail("迁移来源记录无效")
        aliases, alias_ids = set(), set()
        for a in h["identities"]:
            if (not isinstance(a, dict) or not _stable(a.get("id")) or a["id"] in alias_ids or not _stable(a.get("cue_id"))
                    or a.get("role") not in ("main", "extension")
                    or (a.get("track_id", False) is not None if a["role"] == "main" else not _stable(a.get("track_id")))
                    or _alias_key(a) in aliases):
                _fail("旧字幕身份映射无效")
            aliases.add(_alias_key(a))
            alias_ids.add(a["id"])
            if a["id"] != identity("cue", _alias_key(a)):
                _fail("旧字幕身份映射不一致")
            if "reference_extras" in a and (not isinstance(a["reference_extras"], dict) or any(
                    k not in ("color_ref", "sticker_ref") or not isinstance(v, dict) or set(v) != {"cue_id"}
                    for k, v in a["reference_extras"].items())):
                _fail("旧标记扩展字段无效")
        multi = h["structure"].get("multi_subtitle")
        if multi is not None and (not isinstance(multi, dict) or not isinstance(multi.get("tracks"), list)
                                  or any(not isinstance(t, dict) or not _stable(t.get("id")) for t in multi["tracks"])):
            _fail("迁移来源副字幕结构无效")
        sources = [dict(role="main", track_id=None, segments=h["structure"].get("segments"))]
        sources += [dict(role="extension", track_id=t["id"], segments=t.get("segments")) for t in (multi or {}).get("tracks", [])]
        by_id, listed = {a["id"]: a for a in h["identities"]}, set()
        overlay = h["structure"].get("overlay_track")
        if isinstance(overlay, dict) and overlay.get("segments"):
            _fail("迁移来源不能包含第二份正文")
        for source in sources:
            if not isinstance(source["segments"], list):
                _fail("迁移来源只能保存字幕身份列表")
            for cue_id in source["segments"]:
                alias = by_id.get(cue_id) if isinstance(cue_id, str) else None
                if not alias or cue_id in listed or alias["role"] != source["role"] or alias["track_id"] != source["track_id"]:
                    _fail("迁移来源身份列表不一致")
                listed.add(cue_id)
        if listed != alias_ids:
            _fail("迁移来源身份列表不完整")
    return True


def migrate_project(source):
    if isinstance(source, dict) and source.get("schema") == SCHEMA:
        validate(source)
        return deepcopy(source)
    if isinstance(source, dict) and "subtitles" in source:
        _fail("旧工程含有保留的新结构字段，未覆盖")
    _json_value(source)
    project = old.migrate_project(source)
    rows = old.TrackIndex(project).records(include_hidden=True)
    model = dict(schema=MODEL_SCHEMA, tracks=[], cues=[], bindings=[])
    identities = [dict(id=identity("cue", _alias_key(r)), role=r["role"], track_id=r["track_id"], cue_id=r["cue_id"]) for r in rows]
    if len({a["id"] for a in identities}) != len(identities):
        _fail("身份编码冲突，未修改工程")
    by_alias, aliases = {_alias_key(a): a["id"] for a in identities}, {a["id"]: a for a in identities}
    source_cues = {("main", None): project["segments"]}
    multi = project.get("multi_subtitle") or {}
    source_cues.update({("extension", t["id"]): t["segments"] for t in multi.get("tracks", [])})
    owner_tracks, track_ids = {}, {t["id"] for t in project["subtitle_tracks"]["tracks"]}
    occupied = {(r["subtitle_track_id"], r["track_id"]) for r in rows}
    for i, track in enumerate(project["subtitle_tracks"]["tracks"]):
        def add(role, storage=None):
            key = (track["id"], role, storage["id"] if storage else None)
            track_id = track["id"] if role == "main" else identity("track", _json(key))
            if role != "main":
                base, n = track_id, 1
                while track_id in track_ids:
                    track_id, n = f"{base}-{n}", n + 1
                track_ids.add(track_id)
            label = next((storage[k] for k in ("name", "language") if isinstance(storage.get(k), str) and storage[k]), "副字幕") if storage else "副字幕"
            name = track["name"] if role == "main" else f"{track['name']} · {label}"
            name = name.encode("utf-16-le", errors="surrogatepass")[:320].decode("utf-16-le", errors="ignore")
            result = dict(id=track_id, name=name, purpose=track.get("purpose", track["kind"]) if role == "main" else "translation",
                          layout=old.placement(track), enabled=track["enabled"] and (role == "main" or multi.get("enabled") is True),
                          locked=track["locked"], collapsed=track["collapsed"],
                          style={**deepcopy(track["style"]), "slot": "main" if role == "main" else "secondary", "base": old.style_kind(track)})
            if track.get("position"):
                result["position"] = deepcopy(track["position"])
            if storage and storage.get("language"):
                result["language"] = deepcopy(storage["language"])
            model["tracks"].append(result)
            owner_tracks[key] = track_id
        add("main")
        for storage in multi.get("tracks", []):
            if (track["id"], storage["id"]) in occupied or i == 0 and not storage["segments"]:
                add("extension", storage)
    legacy = project["subtitle_layers"]["legacy_overlay"]
    hidden = set() if legacy["visible"] else set(legacy["cue_ids"])
    for row in rows:
        cue = dict(id=by_alias[_alias_key(row)], track_id=owner_tracks[(row["subtitle_track_id"], row["role"], row["track_id"])], content=deepcopy(row["cue"]))
        del cue["content"]["id"]
        if row["role"] == "main" and row["cue_id"] in hidden:
            cue["hidden"] = True
        for field in ("color_ref", "sticker_ref"):
            ref = cue["content"].get(field)
            if ref is None:
                continue
            if not isinstance(ref, dict) or not _integer(ref.get("headIdx")) or ref["headIdx"] >= row["index"]:
                _fail("旧字幕标记引用失效")
            head = source_cues[(row["role"], row["track_id"])][ref["headIdx"]]
            if "cue_id" in ref:
                aliases[cue["id"]].setdefault("reference_extras", {})[field] = dict(cue_id=ref["cue_id"])
            cue["content"][field] = {k: v for k, v in ref.items() if k != "headIdx"}
            cue["content"][field]["cue_id"] = by_alias[_alias_key({**row, "cue_id": head["id"]})]
        model["cues"].append(cue)
    cue_map = {c["id"]: c for c in model["cues"]}
    for binding in multi.get("bindings", []):
        track = binding.get("track_id") or multi["tracks"][0]["id"]
        source_id = by_alias[_alias_key(dict(role="main", track_id=None, cue_id=binding.get("main_segment_ids", [binding.get("main_segment_id")])[0]))]
        target_id = by_alias[_alias_key(dict(role="extension", track_id=track, cue_id=binding.get("extension_segment_ids", [binding.get("extension_segment_id")])[0]))]
        a, b = cue_map[source_id]["content"], cue_map[target_id]["content"]
        model["bindings"].append(dict(id=binding.get("id") or identity("binding", _json([source_id, target_id])), source_id=source_id, target_id=target_id,
                                      start_offset_ms=b["start"] - a["start"], end_offset_ms=b["end"] - a["end"]))
    result = deepcopy(project)
    structure = {field: result.pop(field) for field in STRUCTURAL if field in result}
    structure["segments"] = [by_alias[_alias_key(dict(role="main", track_id=None, cue_id=c["id"]))] for c in project["segments"]]
    for track in (structure.get("multi_subtitle") or {}).get("tracks", []):
        track["segments"] = [by_alias[_alias_key(dict(role="extension", track_id=track["id"], cue_id=c["id"]))] for c in track["segments"]]
    model["migration"] = dict(schema=MIGRATION_SCHEMA, structure=structure, identities=identities)
    result.update(schema=SCHEMA, subtitles=model)
    validate(result)
    return result


class SubtitleIndex:
    """Snapshot index; rebuild after edits. History aliases may outlive a cue."""

    def __init__(self, project):
        validate(project)
        self.project = project
        self.tracks = {t["id"]: t for t in project["subtitles"]["tracks"]}
        self.cues = {c["id"]: c for c in project["subtitles"]["cues"]}
        self.aliases = {_alias_key(a): a["id"] for a in project["subtitles"].get("migration", {}).get("identities", [])}

    def resolve(self, cue_id):
        return self.cues.get(cue_id) if isinstance(cue_id, str) else None

    def track_for(self, cue_id):
        cue = self.resolve(cue_id)
        return self.tracks.get(cue["track_id"]) if cue else None

    def resolve_legacy(self, ref):
        return self.resolve(self.aliases.get(_alias_key(ref))) if isinstance(ref, dict) else None

    def resolve_source(self, ref):
        if not isinstance(ref, dict) or ref.get("kind") == "editor_text":
            return None
        if "subtitle_cue_id" in ref:
            return self.resolve(ref["subtitle_cue_id"])
        return self.resolve_legacy(dict(role="main" if ref.get("track_id") is None else "extension", track_id=ref.get("track_id"),
                                       cue_id=ref.get("source_cue_id", ref.get("id"))))

    def records(self, *, track_id=None, include_hidden=False, include_disabled=True):
        return [c for c in self.project["subtitles"]["cues"] if (track_id is None or c["track_id"] == track_id)
                and (include_hidden or self.tracks[c["track_id"]]["enabled"] and not c.get("hidden"))
                and (include_disabled or not c["content"].get("disabled"))]

    def partners(self, cue_id):
        return [self.cues[b["target_id"] if b["source_id"] == cue_id else b["source_id"]]
                for b in self.project["subtitles"]["bindings"] if cue_id in (b["source_id"], b["target_id"])]


def move(project, cue_ids, target_id):
    index = SubtitleIndex(project)
    target = index.tracks.get(target_id)
    if not isinstance(cue_ids, list) or not cue_ids or target is None or target["locked"]:
        _fail("移动目标不存在或已锁定")
    for cue_id in cue_ids:
        if index.resolve(cue_id) is None or index.track_for(cue_id)["locked"]:
            _fail("字幕不存在或轨道已锁定")
    result, wanted = deepcopy(project), set(cue_ids)
    for cue in result["subtitles"]["cues"]:
        if cue["id"] in wanted:
            cue["track_id"] = target_id
    validate(result)
    return result


def add_track(project, track):
    validate(project)
    result = deepcopy(project)
    result["subtitles"]["tracks"].append(deepcopy(track))
    validate(result)
    return result


def bind(project, source_id, target_id, binding_id):
    index = SubtitleIndex(project)
    source, target = index.resolve(source_id), index.resolve(target_id)
    if not source or not target or index.track_for(source_id)["locked"] or index.track_for(target_id)["locked"]:
        _fail("对应对象不存在或轨道已锁定")
    result = deepcopy(project)
    result["subtitles"]["bindings"].append(dict(id=binding_id, source_id=source_id, target_id=target_id,
                                              start_offset_ms=target["content"]["start"] - source["content"]["start"],
                                              end_offset_ms=target["content"]["end"] - source["content"]["end"]))
    validate(result)
    return result


def unbind(project, binding_id):
    index = SubtitleIndex(project)
    link = next((b for b in project["subtitles"]["bindings"] if b["id"] == binding_id), None)
    if not link or any(index.track_for(link[k])["locked"] for k in ("source_id", "target_id")):
        _fail("对应关系不存在或轨道已锁定")
    result = deepcopy(project)
    result["subtitles"]["bindings"] = [b for b in result["subtitles"]["bindings"] if b["id"] != binding_id]
    return result


def legacy_projection(project):
    """Exact v3 audit view. Refuse edits v3 cannot represent, never downgrade."""
    validate(project)
    h = project["subtitles"].get("migration")
    if not h:
        _fail("此工程没有可无损还原的旧版视图")
    result = deepcopy(project)
    del result["subtitles"]
    result.update(schema=old.SCHEMA, **deepcopy(h["structure"]))
    cues, aliases = {c["id"]: c for c in project["subtitles"]["cues"]}, {a["id"]: a for a in h["identities"]}
    sources = [dict(role="main", track_id=None, segments=result["segments"])]
    sources += [dict(role="extension", track_id=t["id"], segments=t["segments"]) for t in (result.get("multi_subtitle") or {}).get("tracks", [])]
    for source in sources:
        order = list(source["segments"])
        head_indices = {cue_id: i for i, cue_id in enumerate(order)}
        for i, cue_id in enumerate(order):
            original, alias = cues.get(cue_id), aliases.get(cue_id)
            if not original or not alias:
                _fail("新结构已超出旧版视图的表达能力；请使用平级轨道编辑器")
            cue = deepcopy(original["content"])
            cue["id"] = alias["cue_id"]
            for field in ("color_ref", "sticker_ref"):
                ref = cue.get(field)
                if ref is None:
                    continue
                head = aliases.get(ref["cue_id"])
                if not head or head["role"] != source["role"] or head["track_id"] != source["track_id"]:
                    _fail("跨来源标记引用不能无损还原到旧版")
                ref["headIdx"] = head_indices[ref.pop("cue_id")]
                ref.update(alias.get("reference_extras", {}).get(field, {}))
            source["segments"][i] = cue
    rebuilt = migrate_project(result)
    if {k: v for k, v in rebuilt["subtitles"].items() if k != "migration"} != {k: v for k, v in project["subtitles"].items() if k != "migration"}:
        _fail("新结构已超出旧版视图的表达能力；不能降级保存")
    return result
