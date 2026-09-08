"""Canonical audio rendering plan; parity contract: web/msw-audio-render-core.js.

The editor snapshot contains the materialized gap projection (buildJson).
Neither compiler trusts a client-supplied render graph or local media path.
"""

import math
from bisect import bisect_right

from maw.project import normalize_project

VERSION = "msw.audio-render.v1"
MAX_MS = 12 * 60 * 60 * 1000


def integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(label)
    return value


def options(raw=None):
    if raw is not None and not isinstance(raw, dict):
        raise ValueError("音频导出选项无效")
    result = dict(mode="voice", sample_rate=48000, duration_ms=0, start_ms=0, end_ms=None,
                  remove_gaps=False, source_audio_index=0, source_gain_db=0, voice_gain_db=0, peak_protection=True)
    result.update(raw or {})
    if result["mode"] not in {"voice", "mix"} or type(result["sample_rate"]) is not int or result["sample_rate"] not in {44100, 48000}:
        raise ValueError("音频导出格式无效")
    for key in ("remove_gaps", "peak_protection"):
        if type(result[key]) is not bool:
            raise ValueError("音频导出选项无效")
    integer(result["duration_ms"], 0, MAX_MS, "工程时长超过音频导出范围")
    integer(result["start_ms"], 0, MAX_MS, "导出起点无效")
    if result["end_ms"] is not None:
        integer(result["end_ms"], 1, MAX_MS, "导出终点无效")
    integer(result["source_audio_index"], 0, 127, "原声音轨无效")
    for key in ("source_gain_db", "voice_gain_db"):
        value = result[key]
        if type(value) not in (int, float) or not math.isfinite(value) or not -60 <= value <= 12:
            raise ValueError("导出音量无效")
    return result


def clip_end(clip, asset):
    return clip["start_ms"] + (clip["source_out_sample"] - clip["source_in_sample"]) * 1000 / asset["sample_rate"]


def merged_ranges(ranges):
    result = []
    for start, end in sorted(ranges):
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end])
    return result


def removed_ranges(project):
    gap_data = project.get("gap_remove") or {}
    if not isinstance(gap_data, dict):
        raise ValueError("空隙数据无效")
    gaps = gap_data.get("gaps") or []
    if not isinstance(gaps, list) or len(gaps) > 50000:
        raise ValueError("空隙数据无效")
    removed = []
    for gap in gaps:
        if not isinstance(gap, dict):
            raise ValueError("空隙数据无效")
        start = integer(gap.get("start"), 0, 10**12, "空隙时间无效")
        end = integer(gap.get("end"), start + 1, 10**12, "空隙时间无效")
        if type(gap.get("removed", True)) is not bool:
            raise ValueError("空隙状态无效")
        if gap.get("removed", True):
            removed.append((start, end))
    return merged_ranges(removed)


def protect_gaps(gaps, clips, assets):
    intervals = merged_ranges((c["start_ms"], math.ceil(clip_end(c, assets[c["asset_id"]]))) for c in clips)
    result, first = [], 0
    for start, end in gaps:
        cursor = start
        while first < len(intervals) and intervals[first][1] <= cursor:
            first += 1
        for i in range(first, len(intervals)):
            lo, hi = intervals[i]
            if lo >= end:
                break
            if lo > cursor:
                result.append([cursor, lo])
            cursor = max(cursor, hi)
            if cursor >= end:
                break
        if cursor < end:
            result.append([cursor, end])
    return result


def round_sample(value):
    # JS Math.round for nonnegative timeline/sample values, not Python ties-to-even.
    return math.floor(value + .5)


def compile_plan(project, raw_options=None):
    project = normalize_project(project)
    o = options(raw_options)
    ext = project.get("msw") or {}
    assets = {a["id"]: a for a in ext.get("assets", [])}
    tracks = {t["id"]: t for t in ext.get("audio_tracks", [])}
    clips = ext.get("audio_clips", [])
    audible = [c for c in clips if not c["muted"] and not tracks[c["track_id"]]["muted"]]
    duration = max([o["duration_ms"], *[s["end"] for s in project["segments"]],
                    *[math.ceil(clip_end(c, assets[c["asset_id"]])) for c in clips]])
    integer(duration, 1, MAX_MS, "没有有效的音频导出范围，或工程超过 12 小时")
    finish = duration if o["end_ms"] is None else min(o["end_ms"], duration)
    if o["start_ms"] >= finish:
        raise ValueError("导出终点必须晚于起点")
    policy = ext.get("audio_settings", {}).get("gap_policy", "protect")
    removed = removed_ranges(project) if o["remove_gaps"] else []
    if policy == "protect":
        removed = protect_gaps(removed, audible, assets)
    intervals, cursor, output = [], o["start_ms"], 0

    def keep(start, end):
        nonlocal output
        if end > start:
            intervals.append(dict(start_ms=start, end_ms=end, output_start_ms=output))
            output += end - start

    for start, end in removed:
        if end <= cursor or start >= finish:
            continue
        keep(cursor, min(finish, start))
        cursor = min(finish, max(cursor, end))
    keep(cursor, finish)
    if not output:
        raise ValueError("移除空隙后没有剩余音频")

    def frame(ms):
        return round_sample(ms * o["sample_rate"] / 1000)

    pieces = []
    interval_ends = [k["end_ms"] for k in intervals]
    for c in audible:
        a = assets[c["asset_id"]]
        end = clip_end(c, a)
        for index in range(bisect_right(interval_ends, c["start_ms"]), len(intervals)):
            k = intervals[index]
            if k["end_ms"] <= c["start_ms"]:
                continue
            if k["start_ms"] >= end:
                break
            lo, hi = max(k["start_ms"], c["start_ms"]), min(k["end_ms"], end)
            start = frame(k["output_start_ms"] + lo - k["start_ms"])
            finish_sample = frame(k["output_start_ms"] + hi - k["start_ms"])
            source_in = max(c["source_in_sample"], round_sample(c["source_in_sample"] + (lo - c["start_ms"]) * a["sample_rate"] / 1000))
            source_out = min(c["source_out_sample"], round_sample(c["source_in_sample"] + (hi - c["start_ms"]) * a["sample_rate"] / 1000))
            if finish_sample <= start or source_out <= source_in:
                continue
            pieces.append(dict(clip_id=c["id"], asset_id=a["id"], source_in_sample=source_in, source_out_sample=source_out,
                               output_start_sample=start, output_end_sample=finish_sample,
                               gain_db=c["gain_db"] + tracks[c["track_id"]]["gain_db"] + o["voice_gain_db"]))
            if len(pieces) > 100000:
                raise ValueError("空隙切分产生过多音频片段，请缩小导出范围")
    pieces.sort(key=lambda p: (p["output_start_sample"], p["clip_id"]))
    return dict(schema=VERSION, sample_rate=o["sample_rate"], channels=2, sample_count=frame(output),
                source_start_ms=o["start_ms"], source_end_ms=finish, gap_policy=policy,
                intervals=intervals, pieces=pieces,
                source=dict(audio_index=o["source_audio_index"], gain_db=o["source_gain_db"]) if o["mode"] == "mix" else None,
                peak_protection=o["peak_protection"])
