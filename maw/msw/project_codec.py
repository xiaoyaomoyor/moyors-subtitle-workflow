"""Validate the optional MSW namespace without discarding future fields."""

from __future__ import annotations

import copy
import re

SCHEMA = "msw.editor.v1"
ID_PATTERN = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")


def valid_id(value: object) -> bool:
    return isinstance(value, str) and ID_PATTERN.fullmatch(value) is not None


def valid_cue_id(value: object) -> bool:
    # Existing project IDs for cues/tracks/bindings are opaque Unicode strings.
    return isinstance(value, str) and 0 < len(value) <= 160 and value == value.strip()


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
    return errors


def normalize_extension(value: object) -> dict | None:
    errors = validate_extension(value)
    if errors:
        raise ValueError("; ".join(f"{path}: {message}" for path, message in errors))
    return copy.deepcopy(value)
