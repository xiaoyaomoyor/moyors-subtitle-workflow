"""Script-font overrides shared by style validation, metrics and ASS output."""

SCRIPT_FONTS = ('latinFontName', 'kanaFontName', 'hangulFontName', 'cyrillicFontName',
                'greekFontName', 'arabicFontName', 'hebrewFontName', 'devanagariFontName', 'thaiFontName')


def script_key(char):
    cp = ord(char[0]) if char else 0
    if cp <= 0x024f or 0x1e00 <= cp <= 0x1eff:
        return 'latin'
    ranges = {
        'kana': ((0x3040, 0x30ff), (0x31f0, 0x31ff), (0xff66, 0xff9f)),
        'hangul': ((0x1100, 0x11ff), (0x3130, 0x318f), (0xa960, 0xa97f), (0xac00, 0xd7ff)),
        'cyrillic': ((0x0400, 0x052f), (0x2de0, 0x2dff), (0xa640, 0xa69f)),
        'greek': ((0x0370, 0x03ff), (0x1f00, 0x1fff)),
        'arabic': ((0x0600, 0x06ff), (0x0750, 0x077f), (0x0870, 0x08ff), (0xfb50, 0xfdff), (0xfe70, 0xfeff)),
        'hebrew': ((0x0590, 0x05ff), (0xfb1d, 0xfb4f)),
        'devanagari': ((0x0900, 0x097f), (0xa8e0, 0xa8ff)),
        'thai': ((0x0e00, 0x0e7f),),
    }
    return next((script for script, spans in ranges.items() if any(lo <= cp <= hi for lo, hi in spans)), 'han')
