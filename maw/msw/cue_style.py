"""Validated partial cue appearance, independent of position and animation."""
import math
import re
from maw.msw import subtitle_background as background, subtitle_gradient as gradient
from maw.font_scripts import SCRIPT_FONTS

NUMBERS = dict(fontSize=(1, 512), outline=(0, 100), shadow=(0, 100), spacing=(-100, 100),
               angle=(-360, 360), scaleX=(0, 1000), scaleY=(0, 1000), charsPerLine=(1, 200))
BOOLEANS = ('bold', 'italic', 'underline', 'strikeOut')
COLORS = ('primaryColor', 'outlineColor', 'backColor')


def valid(value):
    if not isinstance(value, dict):
        return False
    for key, v in value.items():
        if key in background.DEFAULTS:
            ok = background.valid({key: v})
        elif key in gradient.DEFAULTS:
            ok = gradient.valid({key: v})
        elif key in NUMBERS:
            lo, hi = NUMBERS[key]
            ok = type(v) in (int, float) and math.isfinite(v) and lo <= v <= hi
            if key == 'charsPerLine':
                ok = ok and int(v) == v
        elif key in BOOLEANS:
            ok = type(v) is bool
        elif key in COLORS:
            ok = isinstance(v, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', v)
        elif key == 'fontName':
            ok = isinstance(v, str) and bool(v.strip()) and len(v) <= 128 and not re.search(r'[\r\n,\x00]', v)
        elif key in SCRIPT_FONTS:
            ok = isinstance(v, str) and len(v) <= 128 and not re.search(r'[\\{},\r\n\x00]', v)
        elif key == 'borderStyle':
            ok = type(v) in (int, float) and v in (1, 3)
        elif key == 'wrapMode':
            ok = v in ('auto', 'characters')
        else:
            return False
        if not ok:
            return False
    return True


def apply(base, cue):
    return {**base, **background.normalize(base), **gradient.normalize(base), **cue.get('subtitle_style', {})}
