"""Shared, tail-only punctuation policy for newly generated subtitle text."""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping

DEFAULT_TAIL_PUNCT = "，。,."
DEFAULT_CUSTOM_SPLIT = "，。！？；,.!?;:："


def custom_symbols(value):
    """None means the legacy language rules; an empty list means no punctuation breaks."""
    if value is None:
        return None
    if not isinstance(value, (str, list, tuple)) or isinstance(value, (list, tuple)) and not all(isinstance(v, str) for v in value):
        raise ValueError('断句符号必须是标点列表')
    chars = ''.join(value)
    if len(chars) > 512 or any(not ch.isspace() and unicodedata.category(ch)[0] not in 'PS' for ch in chars):
        raise ValueError('断句符号只能包含标点或符号，最多 512 字符')
    return list(dict.fromkeys(ch for ch in chars if not ch.isspace()))


def match_step(plan):
    return next((s for s in plan.get('steps', []) if isinstance(s, Mapping) and s.get('id') == 'match'), {})


def split_symbols(extra=(), custom=None):
    full = custom_symbols(custom)
    return frozenset(('，', '。', ',', '.', '\n', *extra) if full is None else (*full, '\n'))


def recognition_options(plan):
    step = match_step(plan)
    full = custom_symbols(step.get('splitPunctuation'))
    return {'splitPunctuationMode': 'legacy' if full is None else 'custom',
            'splitPunctuation': ''.join(full) if full is not None else DEFAULT_CUSTOM_SPLIT,
            'preservePunctuation': ''.join(step.get('preservePunctuation', ['？', '！']))}


def recognition_policy(payload, plan):
    step = dict(match_step(plan))
    mode = payload.get('splitPunctuationMode')
    if mode not in (None, 'legacy', 'custom'):
        raise ValueError('断句规则无效')
    if mode == 'custom' and payload.get('splitPunctuation', '') is None:
        raise ValueError('自定义断句符号不能为 null；请用空字符串关闭标点断句')
    if 'preservePunctuation' in payload and payload['preservePunctuation'] is None:
        raise ValueError('保留符号不能为 null；请用空字符串表示不保留')
    if mode == 'custom':
        step['splitPunctuation'] = custom_symbols(payload.get('splitPunctuation', ''))
    elif mode == 'legacy':
        step.pop('splitPunctuation', None)
    if 'preservePunctuation' in payload:
        step['preservePunctuation'] = custom_symbols(payload['preservePunctuation'])
    full = custom_symbols(step.get('splitPunctuation'))
    return {'split_punct': None if full is None else ''.join(full),
            'strip_tail_punct': tail_strip_symbols({'steps': [dict(step, id='match')]}),
            'extra_strong_punct': ''.join(step.get('extraSplitPunctuation', []))}


def _variants(symbols, *, complete=False):
    result = set("".join(str(s) for s in symbols))
    for pair in ("，,", "。.", "？?", "！!") + (("；;", "：:") if complete else ()):
        if result.intersection(pair):
            result.update(pair)
    return result


def tail_strip_symbols(plan: Mapping) -> str:
    step = match_step(plan)
    full = custom_symbols(step.get('splitPunctuation'))
    candidates = _variants([DEFAULT_TAIL_PUNCT, *step.get("extraSplitPunctuation", [])] if full is None
                           else [DEFAULT_CUSTOM_SPLIT, *full])
    preserved = _variants(step.get("preservePunctuation", ["？", "！"]), complete=full is not None)
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
