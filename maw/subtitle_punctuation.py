"""Shared, tail-only punctuation policy for newly generated subtitle text."""
from __future__ import annotations

import re
from collections.abc import Mapping

DEFAULT_TAIL_PUNCT = "，。,."


def _variants(symbols):
    result = set("".join(str(s) for s in symbols))
    for pair in ("，,", "。.", "？?", "！!"):
        if result.intersection(pair):
            result.update(pair)
    return result


def tail_strip_symbols(plan: Mapping) -> str:
    step = next((s for s in plan.get("steps", []) if isinstance(s, Mapping) and s.get("id") == "match"), {})
    candidates = _variants([DEFAULT_TAIL_PUNCT, *step.get("extraSplitPunctuation", [])])
    preserved = _variants(step.get("preservePunctuation", ["？", "！"]))
    return "".join(sorted(candidates - preserved))


def strip_tail_text(text: str, symbols: str) -> str:
    if not symbols:
        return text
    trimmed = text.rstrip()
    end = len(trimmed)
    while end and trimmed[end - 1] in symbols:
        # A final initialism (U.S., e.g.) is part of the word, not a sentence mark.
        if trimmed[end - 1] == "." and re.search(r"(?:\b[A-Za-z]\.){2,}$", trimmed[:end]):
            break
        end -= 1
    return trimmed[:end] if end < len(trimmed) else text


def strip_segment_tails(segments: list, symbols: str, *, drop_empty: bool = False) -> None:
    """Preserve cue/word timing and IDs; remove only the matching text suffix."""
    for segment in segments:
        segment["text"] = strip_tail_text(segment["text"], symbols)
        items = segment.get("items")
        if not items:
            continue
        joined = "".join(item["text"] for item in items)
        remaining = len(joined) - len(strip_tail_text(joined, symbols))
        while remaining and items:
            item = items[-1]
            count = min(remaining, len(item["text"]))
            item["text"] = item["text"][:-count] if count else item["text"]
            remaining -= count
            if item["text"]:
                break
            items.pop()
    if drop_empty:
        # ASR has not created translation bindings yet. Drop empty results here,
        # before translation; other callers retain their one-to-one cue identity.
        segments[:] = [segment for segment in segments if segment["text"].strip()]
