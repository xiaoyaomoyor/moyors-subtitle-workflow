"""Shared MSW project serialization and source-media metadata enrichment."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from maw.media import probe_audio_tracks, probe_video_fps
from maw.project import PROJECT_SCHEMA, ProjectValidationError, ProjectValidationFailed, project_schema_errors
from maw.msw.project_codec import validate_extension


INLINE_CACHE_KEYS = ("waveform", "spectral", "waveform_reapeaks", "loudness")


def strip_inline_caches(project: Mapping[str, Any]) -> dict[str, Any]:
    """Make a disk copy; cached peaks in the live project remain untouched."""
    return {key: value for key, value in project.items() if key not in INLINE_CACHE_KEYS}


def selected_audio_track_from_metadata(metadata: object) -> int | None:
    value = metadata.get("selected_audio_track") if isinstance(metadata, Mapping) else None
    return value if type(value) is int and value >= 0 else None


def default_audio_track_from_metadata(metadata: object) -> int:
    tracks = metadata.get("audio_tracks", []) if isinstance(metadata, Mapping) else []
    for track in tracks if isinstance(tracks, list) else []:
        if isinstance(track, Mapping) and track.get("default") is True:
            value = track.get("audio_index")
            if type(value) is int and value >= 0:
                return value
    return 0


def selected_audio_track_from_project(project: Mapping[str, Any]) -> int:
    """Public selection > old MSW selection > old peaks > container default."""
    selected = selected_audio_track_from_metadata(project.get("media_metadata"))
    if selected is not None:
        return selected
    extension = project.get("msw")
    old = extension.get("source_audio_index") if isinstance(extension, Mapping) else None
    if type(old) is int and old >= 0:
        return old
    for key in INLINE_CACHE_KEYS:
        payload = project.get(key)
        value = payload.get("audio_track") if isinstance(payload, Mapping) else None
        if type(value) is int and value >= 0:
            return value
    return default_audio_track_from_metadata(project.get("media_metadata"))


def audio_track_conflict(project: Mapping[str, Any]) -> bool:
    selected = selected_audio_track_from_metadata(project.get("media_metadata"))
    extension = project.get("msw")
    old = extension.get("source_audio_index") if isinstance(extension, Mapping) else None
    return selected is not None and type(old) is int and old >= 0 and selected != old


def persist_audio_track(project: Mapping[str, Any], selected: int | None = None) -> dict[str, Any]:
    """Preserve a conflicting legacy field until the user confirms a source track."""
    result = dict(project)
    if selected is not None or project.get("media") or project.get("media_metadata"):
        selected = selected_audio_track_from_project(project) if selected is None else selected
        if type(selected) is not int or selected < 0:
            raise ValueError("selected_audio_track must be a non-negative integer")
        result["media_metadata"] = {**project.get("media_metadata", {}), "selected_audio_track": selected}
    return result


def restore_runtime_caches(project: Mapping[str, Any], previous: Mapping[str, Any], media_path=None) -> dict[str, Any]:
    """Reuse same-source caches on save, never across a source/track revision."""
    from maw.waveform import media_signature
    result = dict(project)
    if project.get("media") != previous.get("media") or selected_audio_track_from_project(project) != selected_audio_track_from_project(previous):
        return result
    try:
        signature = media_signature(media_path) if media_path else None
    except OSError:
        return result
    selected = selected_audio_track_from_project(project)
    for key in INLINE_CACHE_KEYS:
        value = previous.get(key)
        if key not in result and isinstance(value, Mapping) and value.get("audio_track", 0) == selected:
            if signature is None or value.get("source") == signature:
                result[key] = value
    return result


def discard_stale_inline_caches(project: Mapping[str, Any], media_path: Path) -> dict[str, Any]:
    from maw.waveform import media_signature, audio_track_from_payloads
    result = dict(project)
    signature = media_signature(media_path)
    selected = selected_audio_track_from_project(project)
    for key in INLINE_CACHE_KEYS:
        payload = result.get(key)
        if (not isinstance(payload, Mapping) or payload.get('source') != signature
                or audio_track_from_payloads(payload) != selected):
            result.pop(key, None)
    return result


def enrich_project_media_metadata(
    project: Mapping[str, Any],
    media_path: Path | str | None = None,
    *,
    ffprobe_path: Path | str | None = None,
) -> dict[str, Any]:
    """Return a project copy with optional source-media metadata.

    Existing metadata fields are deliberately preserved. Callers can pass the
    active media explicitly; otherwise the project's ``media`` field is used
    as a best-effort fallback. FFprobe failures are handled by the media probe
    helpers and never block serialization.
    """

    enriched = dict(project)
    existing_metadata = enriched.get("media_metadata")
    if existing_metadata is not None and not isinstance(existing_metadata, Mapping):
        return enriched
    metadata = dict(existing_metadata) if isinstance(existing_metadata, Mapping) else {}
    need_video_fps = "video_fps" not in metadata
    need_video_dimensions = "video_width" not in metadata or "video_height" not in metadata
    need_audio_tracks = "audio_tracks" not in metadata
    if not need_video_fps and not need_video_dimensions and not need_audio_tracks:
        return enriched

    candidate = media_path
    if candidate is None:
        raw_media = enriched.get("media")
        if isinstance(raw_media, str) and raw_media.strip():
            candidate = raw_media
    if candidate is None or (isinstance(candidate, str) and not candidate.strip()):
        return enriched

    if need_video_fps or need_video_dimensions:
        video_metadata = probe_video_fps(candidate, ffprobe_path=ffprobe_path)
        if video_metadata is not None:
            for key, value in video_metadata.items():
                metadata.setdefault(key, value)
    if need_audio_tracks:
        audio_tracks = probe_audio_tracks(candidate, ffprobe_path=ffprobe_path)
        if audio_tracks is not None:
            metadata["audio_tracks"] = audio_tracks
    if metadata:
        if "media" in enriched and "media_metadata" not in enriched:
            media = enriched.pop("media")
            return {"media": media, "media_metadata": metadata, **enriched}
        enriched["media_metadata"] = metadata
    return enriched


def serialize_mosp(
    project: Mapping[str, Any],
    *,
    media_path: Path | str | None = None,
    ffprobe_path: Path | str | None = None,
    selected_audio_track: int | None = None,
) -> str:
    """Serialize a MSW project after optional source-media enrichment.

    Reject unsupported versions before enrichment or output. Full project
    validation and normalization remain the responsibility of the caller.
    """

    errors = project_schema_errors(project) + tuple(
        ProjectValidationError(path, message) for path, message in validate_extension(project.get("msw"))
    )
    if errors:
        raise ProjectValidationFailed(errors)
    enriched = enrich_project_media_metadata(
        project,
        media_path,
        ffprobe_path=ffprobe_path,
    )
    enriched = strip_inline_caches(persist_audio_track(enriched, selected_audio_track))
    enriched.pop("schema", None)
    return json.dumps({"schema": PROJECT_SCHEMA, **enriched}, ensure_ascii=False, indent=2) + "\n"


def write_mosp(
    path: Path | str,
    project: Mapping[str, Any],
    *,
    media_path: Path | str | None = None,
    ffprobe_path: Path | str | None = None,
    selected_audio_track: int | None = None,
) -> Path:
    """Write a UTF-8 LF-terminated ``.mosp`` project and return its path."""

    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        serialize_mosp(
            project,
            media_path=media_path,
            ffprobe_path=ffprobe_path,
            selected_audio_track=selected_audio_track,
        ),
        encoding="utf-8",
        newline="\n",
    )
    return target
