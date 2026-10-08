"""Installed font registry and ASS advance metrics; no user font paths accepted."""
from functools import lru_cache
import re
import os
import sys
from pathlib import Path


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
    fallback = None
    size, scale, spacing = style['font_size'], style.get('scale_x', 100)/100, style.get('spacing', 0)
    def advance(char):
        nonlocal fallback
        value = metrics.get(ord(char))
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
