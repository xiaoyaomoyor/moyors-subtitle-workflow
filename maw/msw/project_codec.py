"""Validate the optional MSW namespace without discarding future fields."""

from __future__ import annotations

import copy
import math
import re

SCHEMA = "msw.editor.v1"
ID_PATTERN = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")


def valid_id(value: object) -> bool:
    return isinstance(value, str) and ID_PATTERN.fullmatch(value) is not None


def valid_cue_id(value: object) -> bool:
    # Existing project IDs for cues/tracks/bindings are opaque Unicode strings.
    return isinstance(value, str) and 0 < len(value) <= 160 and value == value.strip()


def valid_removed_assets(value):
    return (isinstance(value, list) and len(value) <= 100000
            and all(isinstance(item, str) and re.fullmatch(r"audio-[0-9a-f]{32}", item) for item in value)
            and len(set(value)) == len(value))


def validate_extension(value: object) -> list[tuple[str, str]]:
    if value is None:
        return []
    if not isinstance(value, dict):
        return [("$.msw", "must be an object")]
    if value.get("schema") != SCHEMA:
        return [("$.msw.schema", f"unsupported schema; expected {SCHEMA}")]
    errors = []
    if not valid_id(value.get("project_id")):
        errors.append(("$.msw.project_id", "must be a stable string ID"))
    if value.get("source_project_id") is not None and not valid_id(value["source_project_id"]):
        errors.append(("$.msw.source_project_id", "must be a stable source project ID"))
    applied = value.get("applied_results", [])
    if not isinstance(applied, list) or len(applied) > 10000 or not all(valid_id(item) for item in applied):
        errors.append(("$.msw.applied_results", "must contain at most 10000 result IDs"))
    partial = value.get("translation_applications", {})
    if (not isinstance(partial, dict) or len(partial) > 10000
            or any(not valid_id(key) or not isinstance(ids, list) or len(ids) > 10000
                   or not all(valid_cue_id(item) for item in ids) for key, ids in partial.items())):
        errors.append(("$.msw.translation_applications", "must map job IDs to source ID arrays"))
    targets = value.get("translation_target_tracks", {})
    if (not isinstance(targets, dict) or len(targets) > 10000
            or any(not valid_id(key) or not valid_cue_id(track_id) for key, track_id in targets.items())):
        errors.append(("$.msw.translation_target_tracks", "must map job IDs to target track IDs"))
    assets = value.get("assets", [])
    removed = value.get("removed_asset_ids", [])
    if not valid_removed_assets(removed):
        errors.append(("$.msw.removed_asset_ids", "invalid asset removal records"))
        removed = []
    removed_ids = set(removed)
    if not isinstance(assets, list) or len(assets) > 10000:
        errors.append(("$.msw.assets", "must contain at most 10000 audio assets"))
    else:
        seen = set()
        for index, asset in enumerate(assets):
            if not valid_asset(asset) or asset["id"] in seen or asset["id"] in removed_ids:
                errors.append((f"$.msw.assets[{index}]", "invalid or duplicate audio asset"))
            else:
                seen.add(asset["id"])
    errors.extend(validate_audio_timeline(value))
    return errors


def validate_audio_timeline(value):
    tracks, clips = value.get("audio_tracks", []), value.get("audio_clips", [])
    errors = []
    def gain(number):
        return type(number) in (int, float) and math.isfinite(number) and -60 <= number <= 12
    if (not isinstance(tracks, list) or len(tracks) > 32 or any(
            not isinstance(track, dict) or not valid_id(track.get("id"))
            or not isinstance(track.get("name"), str) or len(track["name"]) > 160
            or not gain(track.get("gain_db")) or type(track.get("muted")) is not bool for track in tracks)):
        errors.append(("$.msw.audio_tracks", "invalid audio tracks"))
        tracks = []
    track_ids = {track["id"] for track in tracks}
    if len(track_ids) != len(tracks):
        errors.append(("$.msw.audio_tracks", "duplicate audio track IDs"))
    assets = {asset["id"]: asset for asset in value.get("assets", []) if valid_asset(asset)} if isinstance(value.get("assets", []), list) else {}
    if not isinstance(clips, list) or len(clips) > 10000:
        errors.append(("$.msw.audio_clips", "must contain at most 10000 audio clips"))
    else:
        seen = set()
        for i, clip in enumerate(clips):
            valid = isinstance(clip, dict) and valid_id(clip.get("id"))
            asset = assets.get(clip.get("asset_id")) if valid and isinstance(clip.get("asset_id"), str) else None
            valid = (valid and asset is not None and isinstance(clip.get("track_id"), str)
                and clip["track_id"] in track_ids and clip["id"] not in seen
                and type(clip.get("start_ms")) is int and 0 <= clip["start_ms"] <= 10**12
                and type(clip.get("source_in_sample")) is int and type(clip.get("source_out_sample")) is int
                and 0 <= clip["source_in_sample"] < clip["source_out_sample"] <= asset["sample_count"]
                and type(clip.get("playback_rate")) in (int, float) and clip["playback_rate"] == 1
                and gain(clip.get("gain_db")) and type(clip.get("muted")) is bool
                and isinstance(clip.get("label"), str) and len(clip["label"]) <= 2000)
            if valid:
                seen.add(clip["id"])
            else:
                errors.append((f"$.msw.audio_clips[{i}]", "invalid clip or unresolved asset/track"))
    settings = value.get("audio_settings", {})
    if (not isinstance(settings, dict)
            or ("heatmap" in settings and type(settings["heatmap"]) is not bool)
            or ("gap_policy" in settings and settings["gap_policy"] not in ("protect", "follow"))):
        errors.append(("$.msw.audio_settings", "invalid audio settings"))
    return errors


def valid_asset(asset):
    if not isinstance(asset, dict):
        return False
    asset_id = asset.get("id")
    if not isinstance(asset_id, str) or not re.fullmatch(r"audio-[0-9a-f]{32}", asset_id):
        return False
    if asset.get("kind") != "audio" or not isinstance(asset.get("path"), str):
        return False
    if not re.fullmatch(r"msw-[0-9a-f]{24}\.assets/audio/" + re.escape(asset_id) + r"\.wav", asset["path"]):
        return False
    if not isinstance(asset.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", asset["sha256"]):
        return False
    for key, low, high in [("sample_rate", 8000, 192000), ("channels", 1, 8),
                           ("sample_count", 1, 2**32), ("byte_size", 44, 32 * 1024 * 1024)]:
        if type(asset.get(key)) is not int or not low <= asset[key] <= high:
            return False
    recipe, source = asset.get("generation"), asset.get("source_ref")
    if not isinstance(recipe, dict) or not isinstance(source, dict):
        return False
    if any(not isinstance(recipe.get(key), str) or len(recipe[key]) > (12000 if key == "spoken_text" else 2000)
           for key in ("provider", "model", "voice", "language_type", "display_text", "spoken_text")):
        return False
    return (valid_id(asset.get("job_id")) and valid_id(source.get("key")) and valid_cue_id(source.get("id"))
            and (source.get("track_id") is None or valid_cue_id(source["track_id"]))
            and isinstance(source.get("text"), str) and len(source["text"]) <= 600
            and isinstance(source.get("pronunciation_override", ""), str)
            and len(source.get("pronunciation_override", "")) <= 600
            and type(source.get("start")) is int and type(source.get("end")) is int
            and 0 <= source["start"] < source["end"])


def normalize_extension(value: object) -> dict | None:
    errors = validate_extension(value)
    if errors:
        raise ValueError("; ".join(f"{path}: {message}" for path, message in errors))
    return copy.deepcopy(value)
