"""Bounded diagnostics for libass exhausting all font fallbacks.

Do not treat the ordinary 'Glyph ... not found, selecting one more font'
message as failure. The final fontselect warning is emitted at warning level.
"""

import re
import unicodedata


_MISSING = re.compile(
    r"fontselect:\s*failed to find any fallback(?: with glyph 0x([0-9a-f]{1,8}))?"
    r"\s+for font:\s*\(([^\r\n]{0,512}?),\s*\d+,\s*\d+\)", re.I)


class SubtitleGlyphMissingError(ValueError):
    """Font coverage is insufficient; retrying a video encoder cannot fix it."""


def missing_glyph_message(stream):
    """Scan binary/text stderr with bounded reads and return a safe UI message."""
    found = []
    more = False
    while line := stream.readline(8192):
        if isinstance(line, bytes):
            line = line.decode('utf-8', errors='replace')
        for match in _MISSING.finditer(line):
            raw, family = match.groups()
            family = ''.join(c for c in family if not unicodedata.category(c).startswith('C')).strip()[:100] or '当前字体'
            code = int(raw, 16) if raw else 0
            glyph = ''
            if code:
                char = chr(code) if code <= 0x10ffff else ''
                if char and not unicodedata.category(char).startswith('C') and not char.isspace():
                    glyph = f'「{char}」'
                glyph += f' U+{code:04X}'
            item = f'字体「{family}」{glyph}'
            if item not in found:
                if len(found) == 8:
                    more = True
                    break
                found.append(item)
        if more:
            break
    if not found:
        return ''
    return ('字幕字体回退后仍缺字：' + '；'.join(found) + ('；另有其他缺字' if more else '')
            + '。已停止烧录，请安装包含这些字符的字体或调整字幕字体后重试。')
