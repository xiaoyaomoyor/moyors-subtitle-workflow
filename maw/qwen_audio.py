"""Shared Qwen-Audio capabilities, usage and hotword helpers."""

from __future__ import annotations

import re
import json
from collections.abc import Iterable
from dataclasses import dataclass

QWEN_AUDIO_31_MODEL_ID = "qwen-audio-3.1-asr-flash-filetrans"
QWEN_AUDIO_MODEL_IDS = frozenset({"qwen-audio-3.0-asr-flash-filetrans", QWEN_AUDIO_31_MODEL_ID})
QWEN_USAGE_PREFIX = "MSW_ASR_USAGE "
# CNY / million tokens, verified 2026-11-14. Reference only; actual bills may
# include promotions. Keep regions separate and never infer tokens from duration.
# https://help.aliyun.com/en/model-studio/qwen-audio-3-1-asr-flash-filetrans
QWEN_AUDIO_31_PRICES = {"beijing": (0.8, 2.7), "singapore": (1.094, 3.427)}


def qwen_audio_billing_info(model: str) -> dict | None:
    if model != QWEN_AUDIO_31_MODEL_ID:
        return None
    return {"currency": "CNY", "unit": "tokens", "prices": {
        region: {"input": prices[0], "output": prices[1]}
        for region, prices in QWEN_AUDIO_31_PRICES.items()}}


def qwen_audio_31_usage(usage: object, region: str) -> dict:
    """Normalize provider counters; absent/invalid is unknown, distinct from zero."""
    values = usage if isinstance(usage, dict) else {}
    counts = {key: value if type(value) is int and 0 <= value <= 2**53 - 1 else None
              for key in ("input_tokens", "output_tokens") for value in (values.get(key),)}
    prices = QWEN_AUDIO_31_PRICES.get(region)
    cost = None
    if prices and all(value is not None for value in counts.values()):
        cost = round((counts["input_tokens"] * prices[0] + counts["output_tokens"] * prices[1]) / 1_000_000, 9)
    return {**counts, "region": region, "currency": "CNY", "estimated_cost": cost}


def qwen_audio_usage_line(usage: object, region: str) -> str:
    return QWEN_USAGE_PREFIX + json.dumps(qwen_audio_31_usage(usage, region), separators=(",", ":"))


def parse_qwen_audio_usage_line(line: str, region: str) -> dict | None:
    if not line.startswith(QWEN_USAGE_PREFIX) or len(line) > 2000:
        return None
    try:
        usage = json.loads(line[len(QWEN_USAGE_PREFIX):])
    except ValueError:
        return None
    return qwen_audio_31_usage(usage, region) if isinstance(usage, dict) else None


def format_qwen_audio_usage(usage: object, region: str) -> str:
    report = qwen_audio_31_usage(usage, region)
    def count(key):
        return str(report[key]) if report[key] is not None else "未知"
    text = f"输入 {count('input_tokens')} / 输出 {count('output_tokens')} tokens"
    if report["estimated_cost"] is not None:
        text += f" | 参考费用 ¥{report['estimated_cost']:.6f}（以实际账单为准）"
    else:
        text += " | 参考费用未知"
    return text


QWEN_AUDIO_HOTWORD_WEIGHTS = frozenset({1, 2, 3, 4, 5, 50})
QWEN_AUDIO_MAX_HOTWORDS = 2000
QWEN_AUDIO_MAX_SUPER_HOTWORDS = 50
QWEN_AUDIO_MAX_MIXED_HOTWORD_CHARS = 15
QWEN_AUDIO_MAX_ASCII_HOTWORD_WORDS = 7


@dataclass(frozen=True, slots=True)
class QwenAudioHotword:
    text: str
    weight: int


@dataclass(frozen=True, slots=True)
class QwenAudioHotwordIssue:
    index: int
    text: str
    code: str


def split_qwen_audio_hotwords(value: str) -> list[str]:
    """把 Launcher 的换行/逗号/分号分隔热词转换成单项列表。"""
    return [
        word.strip()
        for word in re.split(r"[\r\n,，;；]+", value)
        if word.strip()
    ]


def parse_qwen_audio_hotword(value: str, default_weight: int | str = 5) -> tuple[QwenAudioHotword | None, str | None]:
    """解析单个热词，可选使用英文或中文冒号覆盖全局权重。"""
    text = value.strip()
    if not text:
        return None, "empty"
    try:
        fallback_weight = int(default_weight)
    except (TypeError, ValueError):
        fallback_weight = 5

    match = re.fullmatch(r"(.+?)\s*[:：]\s*([0-9]+)\s*", text)
    if match:
        text = match.group(1).strip()
        weight = int(match.group(2))
        if weight not in QWEN_AUDIO_HOTWORD_WEIGHTS:
            return None, "invalid_weight"
    else:
        weight = fallback_weight

    if not text:
        return None, "empty"
    if any(ord(char) > 127 for char in text):
        if len(text) > QWEN_AUDIO_MAX_MIXED_HOTWORD_CHARS:
            return None, "text_too_long"
    elif len(text.split()) > QWEN_AUDIO_MAX_ASCII_HOTWORD_WORDS:
        return None, "too_many_ascii_words"
    return QwenAudioHotword(text=text, weight=weight), None


def parse_qwen_audio_hotwords(
    hotwords: Iterable[str],
    default_weight: int | str = 5,
) -> tuple[list[QwenAudioHotword], list[QwenAudioHotwordIssue]]:
    """解析、去重并过滤不符合 Qwen-Audio 规则的热词。"""
    parsed: dict[str, tuple[int, QwenAudioHotword]] = {}
    issues: list[QwenAudioHotwordIssue] = []
    for index, raw in enumerate(hotwords, start=1):
        entry, code = parse_qwen_audio_hotword(str(raw), default_weight)
        if code:
            if str(raw).strip():
                issues.append(QwenAudioHotwordIssue(index=index, text=str(raw).strip(), code=code))
            continue
        assert entry is not None
        parsed[entry.text] = (index, entry)

    entries: list[QwenAudioHotword] = []
    super_count = 0
    for index, entry in sorted(parsed.values(), key=lambda value: value[0]):
        if len(entries) >= QWEN_AUDIO_MAX_HOTWORDS:
            issues.append(QwenAudioHotwordIssue(index=index, text=entry.text, code="too_many"))
            continue
        if entry.weight == 50 and super_count >= QWEN_AUDIO_MAX_SUPER_HOTWORDS:
            issues.append(QwenAudioHotwordIssue(index=index, text=entry.text, code="too_many_super"))
            continue
        entries.append(entry)
        if entry.weight == 50:
            super_count += 1
    return entries, issues
