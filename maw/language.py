"""Shared language and transcription-granularity conventions.

ASR providers use a mixture of ISO codes, English names, and localized names.
Keep the project-facing value stable while leaving provider-specific request
formats to their adapters.
"""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Mapping, Sequence


LANGUAGE_SOURCES = frozenset({"detected", "hint", "inferred", "unknown"})
SPLIT_MODES = frozenset({"continuous", "word"})
TIMESTAMP_GRANULARITIES = frozenset({"char", "word", "segment", "unknown"})

# Shared subtitle defaults.  Keep these outside a provider adapter so the
# Launcher, local CLI, and cloud/local segmentation paths expose one contract.
DEFAULT_MAX_WORDS = 13
DEFAULT_MIN_WORDS = 3

# These are the languages for which MSW counts text as a continuous character
# stream. Korean remains word-mode: Hangul has whitespace-separated words and
# the existing auto splitter treats it as a western/word language.
CONTINUOUS_LANGUAGE_CODES = frozenset({"zh", "yue", "ja"})


_LANGUAGE_ALIASES = {
    # Chinese and Cantonese
    "zh": "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "zh-sg": "zh",
    "zh-tw": "zh",
    "zh-hant": "zh",
    "cmn": "zh",
    "chi": "zh",
    "zho": "zh",
    "chinese": "zh",
    "mandarin": "zh",
    "zhongwen": "zh",
    "中文": "zh",
    "汉语": "zh",
    "汉語": "zh",
    "普通话": "zh",
    "普通話": "zh",
    "yue": "yue",
    "yue-cn": "yue",
    "cantonese": "yue",
    "粵語": "yue",
    "粤语": "yue",
    "广东话": "yue",
    "廣東話": "yue",
    # East Asian languages
    "ja": "ja",
    "jpn": "ja",
    "japanese": "ja",
    "日本語": "ja",
    "日语": "ja",
    "ko": "ko",
    "kor": "ko",
    "korean": "ko",
    "한국어": "ko",
    "韩语": "ko",
    "韓語": "ko",
    # Common Latin/Cyrillic language codes and provider names
    "en": "en", "eng": "en", "english": "en", "英语": "en", "英文": "en",
    "ar": "ar", "ara": "ar", "arabic": "ar", "阿拉伯语": "ar",
    "cs": "cs", "ces": "cs", "czech": "cs",
    "da": "da", "dan": "da", "danish": "da",
    "nl": "nl", "nld": "nl", "dutch": "nl",
    "fi": "fi", "fin": "fi", "finnish": "fi",
    "fr": "fr", "fra": "fr", "fre": "fr", "french": "fr", "法语": "fr",
    "de": "de", "deu": "de", "ger": "de", "german": "de", "德语": "de",
    "el": "el", "ell": "el", "gre": "el", "greek": "el",
    "hi": "hi", "hin": "hi", "hindi": "hi",
    "hu": "hu", "hun": "hu", "hungarian": "hu",
    "id": "id", "ind": "id", "indonesian": "id",
    "it": "it", "ita": "it", "italian": "it",
    "ms": "ms", "msa": "ms", "may": "ms", "malay": "ms",
    "mk": "mk", "mkd": "mk", "macedonian": "mk",
    "fa": "fa", "fas": "fa", "per": "fa", "persian": "fa",
    "pl": "pl", "pol": "pl", "polish": "pl",
    "pt": "pt", "por": "pt", "portuguese": "pt",
    "ro": "ro", "ron": "ro", "rum": "ro", "romanian": "ro",
    "ru": "ru", "rus": "ru", "russian": "ru", "俄语": "ru",
    "es": "es", "spa": "es", "spanish": "es", "西班牙语": "es",
    "sv": "sv", "swe": "sv", "swedish": "sv",
    "th": "th", "tha": "th", "thai": "th",
    "tr": "tr", "tur": "tr", "turkish": "tr",
    "vi": "vi", "vie": "vi", "vietnamese": "vi",
    "uk": "uk", "ukr": "uk", "ukrainian": "uk",
    "he": "he", "heb": "he", "hebrew": "he",
    "no": "no", "nor": "no", "norwegian": "no",
    "sk": "sk", "slk": "sk", "slo": "sk", "slovak": "sk",
    "sl": "sl", "slv": "sl", "slovenian": "sl",
    "bg": "bg", "bul": "bg", "bulgarian": "bg",
    "hr": "hr", "hrv": "hr", "croatian": "hr",
    "ca": "ca", "cat": "ca", "catalan": "ca",
    "et": "et", "est": "et", "estonian": "et",
    "lv": "lv", "lav": "lv", "latvian": "lv",
    "lt": "lt", "lit": "lt", "lithuanian": "lt",
    # Other languages exposed by the Soniox/Launcher registries.  Filipino is
    # stored as ``fil`` even when a provider calls it ``tl``/Tagalog.
    "af": "af", "afr": "af", "afrikaans": "af",
    "sq": "sq", "sqi": "sq", "albanian": "sq",
    "az": "az", "aze": "az", "azerbaijani": "az",
    "eu": "eu", "eus": "eu", "basque": "eu",
    "be": "be", "bel": "be", "belarusian": "be",
    "bn": "bn", "ben": "bn", "bengali": "bn",
    "bs": "bs", "bos": "bs", "bosnian": "bs",
    "fil": "fil", "tl": "fil", "tgl": "fil", "filipino": "fil", "tagalog": "fil",
    "gl": "gl", "glg": "gl", "galician": "gl",
    "gu": "gu", "guj": "gu", "gujarati": "gu",
    "is": "is", "isl": "is", "ice": "is", "icelandic": "is",
    "kn": "kn", "kan": "kn", "kannada": "kn",
    "kk": "kk", "kaz": "kk", "kazakh": "kk",
    "ml": "ml", "mal": "ml", "malayalam": "ml",
    "mr": "mr", "mar": "mr", "marathi": "mr",
    "pa": "pa", "pan": "pa", "punjabi": "pa",
    "sr": "sr", "srp": "sr", "serbian": "sr",
    "sw": "sw", "swa": "sw", "swahili": "sw",
    "ta": "ta", "tam": "ta", "tamil": "ta",
    "te": "te", "tel": "te", "telugu": "te",
    "ur": "ur", "urd": "ur", "urdu": "ur",
    "cy": "cy", "cym": "cy", "welsh": "cy", "威尔士语": "cy",
}


def normalize_language_code(value: object) -> str:
    """Return a canonical ISO-style code, or ``""`` when it is unknown."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    # Soniox and Launcher hints can contain a comma-separated list.  A single
    # project language records the first usable code; provider hint handling
    # remains responsible for preserving the full list where needed.
    raw = raw.split(",", 1)[0].strip()
    key = raw.casefold().replace("_", "-")
    if key in {"auto", "automatic", "detect", "detected", "unknown", "none", "自动", "自动识别"}:
        return ""
    direct = _LANGUAGE_ALIASES.get(key)
    if direct:
        return direct
    base = key.split("-", 1)[0]
    return _LANGUAGE_ALIASES.get(base, "")


def infer_language_code(text: str) -> str:
    """Infer from the dominant script, never from an isolated foreign phrase.

    ASR can return quoted dialogue (or hallucinations) in another script. A
    single kana token must not turn a long Latin transcript into character-mode
    subtitles. Count letters only, so digits/punctuation do not skew inference;
    Latin/Cyrillic/etc. remain unknown rather than falsely labelled English.
    Provider language and explicit hints still take precedence in resolve_language.
    """
    letters = [char for char in text if unicodedata.category(char).startswith('L')]
    total = len(letters)
    if not total:
        return ""
    hangul = sum("\uac00" <= char <= "\ud7af" or "\u1100" <= char <= "\u11ff"
                 or "\u3130" <= char <= "\u318f" for char in letters)
    kana = sum("\u3040" <= char <= "\u30ff" or "\u31f0" <= char <= "\u31ff"
               or "\uff66" <= char <= "\uff9d" for char in letters)
    han = sum("\u3400" <= char <= "\u4dbf" or "\u4e00" <= char <= "\u9fff"
              or "\uf900" <= char <= "\ufaff" or "\U00020000" <= char <= "\U000323af"
              for char in letters)
    if hangul * 2 > total:
        return "ko"
    if (kana + han) * 2 > total and kana * 10 >= kana + han:
        return "ja"
    if han * 2 > total:
        return "zh"
    return ""


def normalize_timestamp_range(
    start: object,
    end: object,
    *,
    scale: float = 1.0,
) -> tuple[int, int] | None:
    """Convert one provider timestamp pair to integer milliseconds.

    Providers use both milliseconds and seconds and occasionally return
    malformed values.  A range is usable only when both values are finite,
    non-negative, and the rounded end is strictly after the rounded start.
    ``None`` is returned for anything else so adapters can discard the whole
    sentence/token group instead of manufacturing a zero-width item.
    """
    if isinstance(start, bool) or isinstance(end, bool):
        return None
    try:
        start_value = float(start)
        end_value = float(end)
        multiplier = float(scale)
    except (TypeError, ValueError, OverflowError):
        return None
    if (
        not math.isfinite(start_value)
        or not math.isfinite(end_value)
        or not math.isfinite(multiplier)
        or multiplier <= 0
        or start_value < 0
        or end_value < 0
    ):
        return None
    start_scaled = start_value * multiplier
    end_scaled = end_value * multiplier
    if not math.isfinite(start_scaled) or not math.isfinite(end_scaled):
        return None
    try:
        start_ms = int(round(start_scaled))
        end_ms = int(round(end_scaled))
    except (OverflowError, ValueError):
        return None
    if end_ms <= start_ms:
        return None
    return start_ms, end_ms


def timestamp_items_cover_text(text: str, items: Sequence[object]) -> bool:
    """Return whether timestamp item text accounts for a complete cue.

    Providers may omit whitespace and punctuation from aligned tokens, so the
    comparison ignores Unicode whitespace and punctuation while retaining
    letters, numbers, marks, and symbols such as emoji.  A false result means
    that flattening the items would silently lose or invent cue text; callers
    should keep the enclosing sentence range instead.
    """
    values: list[str] = []
    for item in items:
        if not isinstance(item, Mapping):
            return False
        value = str(item.get("text") or "")
        if value.strip():
            values.append(value)
    if not values or not str(text or "").strip():
        return False

    def key(value: str) -> str:
        return "".join(
            char.casefold()
            for char in value
            if not char.isspace()
            and not unicodedata.category(char).startswith("P")
        )

    return key(str(text)) == key("".join(values))


def restore_timestamp_item_text(text: str, items: Sequence[object]) -> list[dict] | None:
    """Map complete sentence text back onto timed fragments, without guessing words.

    Coverage ignores spaces/punctuation; it is not permission to concatenate the
    provider's normalized tokens. Use the source sentence for the actual text.
    Token ranges and other metadata are retained, including zero-width tokens.
    Return None for incomplete/ambiguous alignment so callers can keep a coarse
    sentence instead of silently losing text or inventing word timestamps.
    """
    if not items or any(not isinstance(item, Mapping) for item in items):
        return None
    restored = [dict(item) for item in items]
    if "".join(str(item.get("text") or "") for item in restored) == text:
        return restored

    def key(char: str) -> str:
        return "" if char.isspace() or unicodedata.category(char).startswith("P") else char.casefold()

    source = []
    for index, char in enumerate(text):
        source.extend((unit, index) for unit in key(char))
    tokens = ["".join(key(char) for char in str(item.get("text") or "")) for item in restored]
    if not source or "".join(unit for unit, _ in source) != "".join(tokens):
        return None

    cursor = offset = 0
    for index, (item, token) in enumerate(zip(restored, tokens)):
        if token:
            offset += len(token)
            end = source[offset - 1][1] + 1
            # A case-fold expansion (e.g. ß -> ss) cannot be split between two
            # separate timestamps without assigning the same character twice.
            if offset < len(source) and source[offset][1] < end:
                return None
            # Keep sentence-ending punctuation on the preceding word, unless
            # the provider gave it a separate timed item (which must survive).
            if index + 1 == len(tokens) or tokens[index + 1]:
                while end < len(text) and not text[end].isspace() and not key(text[end]):
                    end += 1
        else:
            # Match explicit punctuation/space-only items at the current source
            # position; never search ahead across an unaccounted word.
            literal = "".join(str(item.get("text") or "").split())
            end = cursor
            if literal:
                matched = ""
                while end < len(text) and not key(text[end]):
                    if not text[end].isspace():
                        matched += text[end]
                    end += 1
                    if matched == literal:
                        break
                    if not literal.startswith(matched):
                        return None
                if matched != literal:
                    return None
            else:
                while end < len(text) and text[end].isspace():
                    end += 1
            if end == cursor:
                return None
        item["text"] = text[cursor:end]
        cursor = end
    restored[-1]["text"] += text[cursor:]
    return restored


def resolve_language(
    raw_language: object,
    language_hint: object = None,
    text: str = "",
) -> tuple[str, str]:
    """Resolve output language and provenance in priority order."""
    detected = normalize_language_code(raw_language)
    if detected:
        return detected, "detected"
    hinted = normalize_language_code(language_hint)
    if hinted:
        return hinted, "hint"
    inferred = infer_language_code(text)
    if inferred:
        return inferred, "inferred"
    return "", "unknown"


def split_mode_for_language(language: object) -> str:
    """Map a known language to MSW's continuous or word counting mode."""
    code = normalize_language_code(language)
    if not code:
        return ""
    return "continuous" if code in CONTINUOUS_LANGUAGE_CODES else "word"


def split_mode_for_text(text: str, language: object = None) -> str:
    """Choose a safe default when a provider did not return language metadata."""
    explicit = split_mode_for_language(language)
    if explicit:
        return explicit
    inferred = infer_language_code(text)
    if inferred:
        return split_mode_for_language(inferred)
    # Latin-script text is not labelled as English, but its subtitle units are
    # still words by default. This is a split-mode decision, not language ID.
    return "word"


def is_space_separated_language(language: object) -> bool:
    code = normalize_language_code(language)
    if not code:
        return False
    # A known language that is not in the continuous-script set uses words for
    # the purpose of spacing/counting. Keep this derived from the split-mode
    # contract so newly supported word languages cannot silently concatenate.
    return code not in CONTINUOUS_LANGUAGE_CODES


def timestamp_granularity_for_items(
    items: Sequence[object],
    split_mode: str,
    *,
    explicit_items: bool = False,
    has_segments: bool = False,
) -> str:
    """Describe item granularity without claiming precision for fallback items.

    ``items`` can contain a sentence-level fallback item, so callers must opt
    in only when they know every returned item came from explicit sub-segment
    timestamps.
    """
    if not items or not explicit_items:
        return "segment" if has_segments else "unknown"
    return "char" if split_mode == "continuous" else "word"


__all__ = [
    "CONTINUOUS_LANGUAGE_CODES",
    "DEFAULT_MAX_WORDS",
    "DEFAULT_MIN_WORDS",
    "LANGUAGE_SOURCES",
    "SPLIT_MODES",
    "TIMESTAMP_GRANULARITIES",
    "infer_language_code",
    "is_space_separated_language",
    "normalize_timestamp_range",
    "normalize_language_code",
    "resolve_language",
    "restore_timestamp_item_text",
    "split_mode_for_language",
    "split_mode_for_text",
    "timestamp_items_cover_text",
    "timestamp_granularity_for_items",
]
