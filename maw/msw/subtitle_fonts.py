"""Installed font registry and ASS advance metrics; no user font paths accepted."""
from functools import lru_cache
import re
import os
import sys
from pathlib import Path
from maw.font_scripts import SCRIPT_FONTS, script_key

# Representative alphabets, checked against glyph coverage rather than names.
SCRIPT_SAMPLES = {
    'kana': 'あいうえおかきくけこさしすせそたちつてとなにぬねのアイウエオカキクケコサシスセソタチツテトナニヌネノ',
    'hangul': '가나다라마바사아자차카타파하한글한국어',
    'cyrillic': 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    'greek': 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω',
    'arabic': 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي',
    'hebrew': 'אבגדהוזחטיכלמנסעפצקרשת',
    'devanagari': 'अआइईउऊऋएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह',
    'thai': 'กขคงจฉชซญดตถทนบปผฝพฟมยรลวศษสหอฮ',
}


def font_roots() -> tuple[Path, ...]:
    roots: list[Path] = []
    if sys.platform == "win32":
        windows = os.environ.get("WINDIR")
        local_app_data = os.environ.get("LOCALAPPDATA")
        if windows:
            roots.append(Path(windows) / "Fonts")
        if local_app_data:
            roots.append(Path(local_app_data) / "Microsoft" / "Windows" / "Fonts")
    elif sys.platform == "darwin":
        roots.extend((Path("/System/Library/Fonts"), Path("/Library/Fonts"), Path.home() / "Library" / "Fonts"))
    else:
        roots.extend((Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), Path.home() / ".fonts"))
    return tuple(dict.fromkeys(root for root in roots if root.exists()))


@lru_cache(maxsize=1)
def installed_fonts():
    try:
        from fontTools.ttLib import TTFont, TTCollection
    except ImportError:
        # Slim ASR/OCR runtimes can serialize projects without font tools.
        return {}
    result = {}
    for root in font_roots():
        for path in root.rglob('*'):
            if path.suffix.lower() not in {'.ttf','.otf','.ttc','.otc'} or not path.is_file():
                continue
            # Follow only files physically inside known font roots.
            if not path.resolve().is_relative_to(root.resolve()):
                continue
            owner = None
            try:
                owner = TTCollection(str(path),lazy=True) if path.suffix.lower() in {'.ttc','.otc'} else TTFont(str(path),lazy=True)
                faces = owner.fonts if hasattr(owner,'fonts') else [owner]
                for font in faces:
                    for record in font['name'].names:
                        if record.nameID not in {1,16}:
                            continue
                        name=record.toUnicode().strip()
                        if name:
                            result.setdefault(name.casefold(),set()).add(path.resolve())
            except Exception:
                # A damaged third-party font must not prevent other families loading.
                continue
            finally:
                if owner is not None:
                    owner.close()
    return result


@lru_cache(maxsize=1)
def font_catalog():
    """Public family metadata only; never expose installed filesystem paths."""
    from fontTools.ttLib import TTFont, TTCollection
    families = {}
    paths = {path for group in installed_fonts().values() for path in group}
    for path in sorted(paths):
        owner = None
        try:
            owner = TTCollection(str(path), lazy=True) if path.suffix.lower() in {'.ttc', '.otc'} else TTFont(str(path), lazy=True)
            for font in owner.fonts if hasattr(owner, 'fonts') else [owner]:
                names = [(r.nameID, r.langID, r.toUnicode().strip()) for r in font['name'].names
                         if r.nameID in {1, 4, 6, 16}]
                family_names = [r for r in names if r[0] in {1, 16} and r[2]]
                if not family_names:
                    continue
                # Keep separately selectable Windows/CSS families (Arial Black,
                # Arial Narrow, etc.); typographic name 16 can collapse them.
                family = min(family_names, key=lambda r: (r[1] not in (0x409, 0), r[0] != 1, r[2]))[2]
                chinese = [r for r in family_names if r[1] & 0x3ff == 4 and re.search(r'[\u3400-\u9fff]', r[2])]
                label = min(chinese, key=lambda r: (r[1] != 0x804, r[0] != 1, r[2]))[2] if chinese else family
                cmap = font.getBestCmap() or {}
                cjk = sum(ord(c) in cmap for c in '中文天地人山水日月一二三') >= 10 and sum(0x3400 <= c <= 0x9fff for c in cmap) >= 128
                latin = all(ord(c) in cmap for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
                scripts = {s for s, sample in SCRIPT_SAMPLES.items() if all(ord(c) in cmap for c in sample)}
                if cjk:
                    scripts.add('han')
                if latin:
                    scripts.add('latin')
                entry = families.setdefault(family.casefold(), dict(family=family, label=label, aliases=set(), scripts=set(), cjk=False, latin=False))
                entry['scripts'].update(scripts)
                entry['aliases'].update(r[2] for r in names if r[2])
                if chinese:
                    entry['label'] = label
                entry['cjk'] |= cjk
                entry['latin'] |= latin
        except Exception:
            continue
        finally:
            if owner is not None:
                owner.close()
    return [dict(entry, aliases=sorted(entry['aliases']), scripts=sorted(entry['scripts'])) for entry in sorted(families.values(), key=lambda e: e['family'].casefold())]


def text_font(char, style):
    """Choose by script; shared Han characters use the fallback face."""
    return style.get(script_key(char) + 'FontName') or style.get('fontName', '')


def font_tag(family):
    # Names are data, never ASS overrides (also guard older permissive projects).
    return r'{\fn' + re.sub(r'[\\{},\x00-\x1f]', '', family) + '}'


def font_tags(text, style):
    """One prefix per character, emitted only at a script/font boundary."""
    current, result = style.get('fontName', ''), []
    for char in text:
        family = text_font(char, style)
        result.append(font_tag(family) if family != current else '')
        current = family
    return result


def styled_text(text, style):
    from maw.msw.subtitle_style import ass_text
    from maw.subtitle_wrapping import _characters
    if not any(style.get(k) and style[k] != style.get('fontName') for k in SCRIPT_FONTS):
        return ass_text(text)
    units = _characters(text)
    return ''.join(tag + ass_text(unit) for tag, unit in zip(font_tags(units, style), units))


@lru_cache(maxsize=64)
def family_metrics(family, bold=False, italic=False):
    """Read advances in ASS font-size units, including TTC face and weight.

    libass sizes TrueType fonts by OS/2 Win ascent + descent, rather than em.
    Keep only numbers in the cache, and close every font file after reading.
    """
    paths = installed_fonts().get(family.casefold(), ())
    if not paths:
        return {}
    from fontTools.ttLib import TTFont, TTCollection
    candidates = []
    for path in sorted(paths):
        owner = None
        try:
            owner = TTCollection(str(path), lazy=True) if path.suffix.lower() in {'.ttc', '.otc'} else TTFont(str(path), lazy=True)
            for font in owner.fonts if hasattr(owner, 'fonts') else [owner]:
                names = {r.toUnicode().strip().casefold() for r in font['name'].names if r.nameID in {1, 16}}
                if family.casefold() not in names:
                    continue
                os2, head, hhea = font.get('OS/2'), font['head'], font['hhea']
                height = (getattr(os2, 'usWinAscent', 0) + getattr(os2, 'usWinDescent', 0)) or hhea.ascent-hhea.descent or head.unitsPerEm
                weight = getattr(os2, 'usWeightClass', 400)
                slanted = bool(head.macStyle & 2)
                score = abs(weight-(700 if bold else 400)) + (1000 if slanted != italic else 0)
                cmap, widths = font.getBestCmap() or {}, font['hmtx'].metrics
                advances = {code: widths[glyph][0]/height for code, glyph in cmap.items() if glyph in widths}
                candidates.append((score, advances))
        except Exception:
            # Corrupt/unusable installed fonts must not break preview or export.
            continue
        finally:
            if owner is not None:
                owner.close()
    return min(candidates, key=lambda item: item[0])[1] if candidates else {}


def wrapped_line_count(text, style, width):
    """Measure actual advances before wrapping at ASS soft-break spaces.

    ASS without WrapUnicode never splits an unbroken word by character count.
    Hard line breaks (including the user's per-line character limit) are kept.
    """
    family = style.get('font_family', '')
    metrics = family_metrics(family, style.get('bold', False), style.get('italic', False)) if family else {}
    fonts = {'fontName':family, 'latinFontName':style.get('latin_font_family'), **style.get('script_fonts', {})}
    tables = {family: metrics}
    for key in SCRIPT_FONTS:
        if fonts.get(key):
            tables[fonts[key]] = family_metrics(fonts[key], style.get('bold', False), style.get('italic', False))
    fallback = None
    size, scale, spacing = style['font_size'], style.get('scale_x', 100)/100, style.get('spacing', 0)
    def advance(char):
        nonlocal fallback
        table = tables[text_font(char, fonts)]
        value = table.get(ord(char))
        if value is None and family:
            if fallback is None:
                registry = installed_fonts()
                name = next((n for n in ('microsoft yahei', 'pingfang sc', 'noto sans cjk sc', 'arial', 'dejavu sans') if n in registry), '')
                fallback = family_metrics(name, style.get('bold', False), style.get('italic', False)) if name else {}
            value = fallback.get(ord(char))
        return ((value if value is not None else (1.1 if ord(char) > 255 else .55))*size+spacing)*scale
    count = 0
    available = max(1, width*style['width'])
    for line in str(text).replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        used, space = 0, 0
        count += 1
        for token in re.findall(r'[ \t]+|[^ \t]+', line.strip(' \t')):
            length = sum(advance(c) for c in token)
            if token[0] in ' \t':
                space += length
            else:
                if used and used+space+length > available:
                    count += 1
                    used = 0
                used += (space if used else 0)+length
                space = 0
    return count
