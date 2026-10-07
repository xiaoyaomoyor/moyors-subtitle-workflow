"""Portable project subtitle styles and user presets, independent of preview UI."""
from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path

from maw.ass_styles import (DEFAULT_ASS_STYLE, DEFAULT_ASS_EXTENSION_STYLE,
    _normalize_style, _normalize_animation, default_ass_styles_path)
from maw.file_io import atomic_write_text
from maw.subtitle_wrapping import normalize_wrapping, render_project

SCHEMA = 'msw.subtitle-style.v1'


def builtin_presets():
    base=normalize_project_style({'schema':SCHEMA,'main':dict(DEFAULT_ASS_STYLE,fontSize=48,marginV=108,marginL=96,marginR=96),
        'secondary':dict(DEFAULT_ASS_EXTENSION_STYLE,fontSize=40,marginV=48,marginL=96,marginR=96)})
    def variant(key,name,main,secondary):
        return dict(normalize_project_style(dict(base,name=name,main=dict(base['main'],**main),secondary=dict(base['secondary'],**secondary))),id=key)
    default=normalize_project_style(dict(base,main=dict(base['main'],marginV=96),pairLayout={'order':'main-above','gap':0}))
    return [dict(default,id='default'),variant('large','大字清晰',dict(fontSize=72,outline=3),dict(fontSize=56)),
        variant('contrast','高对比底框',dict(borderStyle=3,outline=5,backColor='#000000'),dict(borderStyle=3,outline=4)),
        variant('bilingual','双语紧凑',dict(fontSize=44,marginV=100),dict(fontSize=36,marginV=48))]


def normalize_project_style(raw):
    if not isinstance(raw, dict) or raw.get('schema') != SCHEMA:
        raise ValueError('工程字幕样式格式无效或版本不受支持')
    for role in ('main', 'secondary'):
        if not isinstance(raw.get(role), dict):
            raise ValueError('工程字幕样式缺少主／副字幕参数')
    result = dict(schema=SCHEMA, name=str(raw.get('name') or '默认白字')[:80],
        main=_normalize_style(raw['main'], DEFAULT_ASS_STYLE, style_id='main'),
        secondary=_normalize_style(raw['secondary'], DEFAULT_ASS_EXTENSION_STYLE, style_id='secondary'),
        animations=_normalize_animation(raw.get('animations')))
    for role in ('main', 'secondary'):
        result[role].update(normalize_wrapping(raw[role]))
    if 'legacyBurn' in raw:
        from maw.msw.subtitle_style import normalize_styles
        result['legacyBurn'] = normalize_styles(raw['legacyBurn'])
    if 'pairLayout' in raw:
        pair = raw['pairLayout']
        if (not isinstance(pair, dict) or pair.get('order') not in ('main-above', 'secondary-above')
                or type(pair.get('gap')) is not int or not -240 <= pair['gap'] <= 240):
            raise ValueError('主副字幕排列设置无效')
        result['pairLayout'] = dict(order=pair['order'], gap=pair['gap'])
    return result


def style_library(raw):
    style = normalize_project_style(raw)
    return {'styles': [dict(style['main'], id='project-main'), dict(style['secondary'], id='project-secondary')],
        'assProfiles': [{'id': 'project', 'name': style['name'], 'styleId': 'project-main', 'animations': style['animations']}],
        'assignments': {'assExportProfileId': 'project', 'assExtensionStyleId': 'project-secondary'}}


def apply_project_style(project):
    """Adapt an immutable render snapshot to the existing, tested ASS compiler."""
    raw = (project.get('preview') or {}).get('project_style')
    if raw is None:
        return project
    style = normalize_project_style(raw)
    result = dict(render_project(project, style), preview=dict(project.get('preview') or {}))
    result['preview'].pop('project_style', None)
    result['preview'].pop('subtitle_pair_layout', None)
    if 'pairLayout' in style:
        result['preview']['subtitle_pair_layout'] = style['pairLayout']
    if 'legacyBurn' in style:
        result['preview'].update(ass_library_exports=False, burn_subtitles=style['legacyBurn'])
    else:
        result['preview'].update(ass_library_exports=True, burn_ass_library=style_library(style))
    return result


def presets_path():
    return default_ass_styles_path().with_name('subtitle-presets.json')


def normalize_presets(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get('presets'), list) or len(raw['presets']) > 256:
        raise ValueError('字幕预设库无效（最多 256 个自定义预设）')
    if raw.get('version',1)!=1:
        raise ValueError('字幕预设库版本不受支持，请使用兼容的编辑器')
    items, seen = [], set()
    for entry in raw['presets']:
        if not isinstance(entry, dict):
            raise ValueError('字幕预设无效')
        key = entry.get('id')
        if not isinstance(key, str) or not key or len(key)>80 or key in seen or key in {'default','large','contrast','bilingual'}:
            raise ValueError('字幕预设标识无效或重复')
        seen.add(key)
        items.append(dict(normalize_project_style(entry), id=key))
    return {'version':1, 'presets':items}


def load_presets(path: Path | None = None):
    try:
        return normalize_presets(json.loads((path or presets_path()).read_text(encoding='utf-8')))
    except FileNotFoundError:
        if path is not None:
            return {'version':1, 'presets':[]}
        # Read-only migration. The first explicit preset save persists the new
        # library; merely opening an editor never overwrites the user's old one.
        from maw.ass_styles import load_ass_style_library, default_ass_style_library, find_ass_style
        old=load_ass_style_library(); baseline=default_ass_style_library()
        original={s['id']:s for s in baseline['styles']}
        secondary=find_ass_style(old,old['assignments']['assExtensionStyleId'])
        changed={s['id']:s for s in old['styles'] if s!=original.get(s['id'])}
        migrated=[]
        for profile in old['assProfiles']:
            if profile not in baseline['assProfiles'] or profile['styleId'] in changed or secondary['id'] in changed:
                migrated.append(dict(normalize_project_style({'schema':SCHEMA,'name':'旧版：'+profile['name'],
                    'main':find_ass_style(old,profile['styleId']),'secondary':secondary,'animations':profile['animations']}),id='legacy-profile-'+profile['id']))
        for key,style in changed.items():
            migrated.append(dict(normalize_project_style({'schema':SCHEMA,'name':'旧版：'+style['name'],
                'main':style,'secondary':secondary}),id='legacy-style-'+key))
        srt_id=old['assignments']['srtBurnStyleId']
        if srt_id in changed or srt_id!=baseline['assignments']['srtBurnStyleId']:
            # FFmpeg's implicit SRT ASS canvas is 288 high. Convert its numeric
            # styling to the shared 1080p reference when importing that slot.
            srt=dict(find_ass_style(old,srt_id))
            for field in ('fontSize','outline','shadow','spacing','marginL','marginR','marginV'):
                srt[field]*=1080/288
            migrated.append(dict(normalize_project_style({'schema':SCHEMA,'name':'旧版 SRT 烧录：'+srt['name'],
                'main':srt,'secondary':secondary}),id='legacy-srt-burn'))
        return {'version':1,'presets':migrated}


def save_presets(raw, path: Path | None = None):
    value = normalize_presets(raw)
    target = path or presets_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_text(target, json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    return value


def preserve_style_source(target, project):
    """Keep the first original file when adding project styles, before overwriting."""
    target=Path(target)
    if not target.is_file() or not (project.get('preview') or {}).get('project_style'):
        return None
    original=target.read_bytes()
    previous=json.loads(original.decode('utf-8-sig'))
    if (previous.get('preview') or {}).get('project_style'):
        return None
    key=hashlib.sha256(str(target.resolve()).encode()+original).hexdigest()[:20]
    backup=target.with_name(f'.msw-style-backup-{key}.mosp')
    try:
        with backup.open('xb') as stream:
            stream.write(original);stream.flush();os.fsync(stream.fileno())
    except FileExistsError:
        if backup.read_bytes()!=original:
            raise ValueError('字幕样式迁移备份冲突，未覆盖原工程')
    return backup
