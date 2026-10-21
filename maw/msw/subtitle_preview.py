"""ASS preview payloads and a bounded installed-font registry for localhost."""
from __future__ import annotations

import hashlib
import threading

from maw.msw.subtitle_fonts import installed_fonts
from maw.project import normalize_project
from maw.msw.subtitle_style import styled_ass

_lock = threading.RLock()
_files = {}
# Bump together with MSWProjectStyle.layoutVersion when the shared layout
# contract changes. A page refresh cannot reload an already running Python VM.
LAYOUT_VERSION = 14


def preview_ass(payload):
    raw = payload.get('project')
    if isinstance(raw, dict) and raw.get('schema') == 'msw.project.v4':
        from maw.msw.flat_subtitles import validate
        from copy import deepcopy
        validate(raw)
        project = deepcopy(raw)
    else:
        project = normalize_project(raw)
    target = payload.get('target', 'both')
    if target not in {'main', 'secondary', 'both', 'none'}:
        raise ValueError('字幕预览轨道无效')
    video = payload.get('video') or {}
    for key in ('width', 'height'):
        if type(video.get(key)) is not int or not 16 <= video[key] <= 7680:
            raise ValueError('字幕预览画面尺寸无效')
    plan = payload.get('plan') or {'intervals':[{'start_ms':0,'end_ms':12*3600*1000,'output_start_ms':0}]}
    intervals=plan.get('intervals')
    if not isinstance(intervals,list) or len(intervals)>10000:
        raise ValueError('字幕时间映射无效')
    previous=output=0
    for span in intervals:
        if not isinstance(span,dict) or any(type(span.get(k)) is not int for k in ('start_ms','end_ms','output_start_ms')) or not previous<=span['start_ms']<span['end_ms']<=12*3600*1000 or span['output_start_ms']!=output:
            raise ValueError('字幕时间映射必须为有序保留区间')
        previous=span['end_ms'];output+=span['end_ms']-span['start_ms']
    geometry=[]
    if project.get('schema')=='msw.project.v4' or project.get('schema')=='msw.project.v3' and project['subtitle_tracks'].get('presentation')=='fixed':
        from maw.msw.track_presentation import layout, position_anchor
        for i, r in enumerate(layout(project,round(1080*video['width']/video['height']))):
            role = 'main' if r['role'] == 'main' else 'secondary'
            if project.get('schema') == 'msw.project.v4' and 'secondary_cue_ids' in project.get('subtitle_view', {}):
                role = 'secondary' if r['cue_id'] in project['subtitle_view']['secondary_cue_ids'] else 'main'
            # Include render identity and lifetimes for temporary player-only
            # control avoidance. The export layout itself remains untouched.
            geometry.append(dict(key=r['key'],x=r['x'],y=r['y'],width=r['width'],height=r['height'],text=r['size']['text'],
                                 groupId=r['groupId'],style=f'cue-{i}',start=r['cue']['start'],end=r['cue']['end'],
                                 visible=target in ('both',role) and bool(r['size']['text'].strip()),
                                 position=position_anchor(r,round(1080*video['width']/video['height'])),
                                 move={'enabled':False} if r['motion'] is not None else r['animations']['move'],motion=r['motion'],
                                 backgroundSize={k:r['size'][k] for k in ('padding','textWidth','textHeight')}))
    return {'ass':styled_ass(project,plan,target,video), 'geometry':geometry, 'layoutVersion':LAYOUT_VERSION}



def font_manifest(families):
    if not isinstance(families,list) or len(families)>64 or any(not isinstance(s,str) or not 1<=len(s)<=128 for s in families):
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
