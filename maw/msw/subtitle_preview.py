"""ASS preview payloads and a bounded installed-font registry for localhost."""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
import threading

from maw.project import normalize_project
from maw.msw.subtitle_style import styled_ass

_lock = threading.RLock()
_files = {}
# Bump together with MSWProjectStyle.layoutVersion when the shared layout
# contract changes. A page refresh cannot reload an already running Python VM.
LAYOUT_VERSION = 3


def preview_ass(payload):
    project = normalize_project(payload.get('project'))
    target = payload.get('target', 'both')
    if target not in {'main', 'secondary', 'both', 'none'}:
        raise ValueError('字幕预览轨道无效')
    video = payload.get('video') or {}
    for key in ('width', 'height'):
        if type(video.get(key)) is not int or not 16 <= video[key] <= 7680:
            raise ValueError('字幕预览画面尺寸无效')
    plan = {'intervals':[{'start_ms':0,'end_ms':12*3600*1000,'output_start_ms':0}]}
    return {'ass':styled_ass(project,plan,target,video), 'layoutVersion':LAYOUT_VERSION}


@lru_cache(maxsize=1)
def installed_fonts():
    from maw.lottie_glyphs import _font_roots
    from fontTools.ttLib import TTFont, TTCollection
    result = {}
    for root in _font_roots():
        for path in root.rglob('*'):
            if path.suffix.lower() not in {'.ttf','.otf','.ttc','.otc'} or not path.is_file():
                continue
            # Follow only files physically inside known font roots.
            if not path.resolve().is_relative_to(root.resolve()):
                continue
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
                owner.close()
            except Exception:
                # A damaged third-party font must not prevent other families loading.
                continue
    return result


def font_manifest(families):
    if not isinstance(families,list) or len(families)>8 or any(not isinstance(s,str) or not 1<=len(s)<=128 for s in families):
        raise ValueError('字幕字体列表无效')
    registry=installed_fonts()
    fallback=next((name for name in ('microsoft yahei','pingfang sc','noto sans cjk sc','arial','dejavu sans') if name in registry),None)
    requested=list(dict.fromkeys(families))
    missing=[name for name in requested if name.casefold() not in registry]
    paths=set()
    for name in requested + ([fallback] if fallback else []):
        paths.update(registry.get(name.casefold(),set()))
    fonts=[]
    for path in sorted(paths)[:24]:
        if path.stat().st_size>64*1024*1024:
            continue
        key=hashlib.sha256(str(path).encode()).hexdigest()[:32]
        with _lock:
            _files[key]=path
        fonts.append({'id':key})
    return {'fonts':fonts,'missing':missing,'fallback':fallback or 'sans-serif'}


def font_file(key):
    with _lock:
        path=_files.get(key)
    if path is None or not path.is_file():
        raise ValueError('字体资源不存在，请重新加载字幕预览')
    return path
