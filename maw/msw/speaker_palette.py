"""Project-owned speaker identities. Legacy color.name stores the stable row ID.

Names and RGB values are editable attributes, never the identity of a speaker.
"""
import re
from maw.msw import cue_style, subtitle_animation

MODES = {'none', 'text', 'stroke', 'background', 'speaker'}


def language(value):
    raw = value.strip().lower().replace('_', '-') if isinstance(value, str) else ''
    aliases = {'zh': 'zh-hans', 'zh-cn': 'zh-hans', 'zh-sg': 'zh-hans', 'zh-tw': 'zh-hant',
               'zh-hk': 'zh-hant', 'zh-mo': 'zh-hant', 'chinese': 'zh-hans', 'english': 'en', 'japanese': 'ja', 'korean': 'ko'}
    code = aliases.get(raw, raw)
    return code if len(code) <= 35 and re.fullmatch(r'[a-z]{2,3}(?:-[a-z0-9]{2,8})*', code) and code not in ('und', 'mul') else ''


def display_name(row, locale=''):
    if not row:
        return ''
    code = language(locale)
    keys = [code]
    if code.startswith(('zh-hans-', 'zh-hant-')):
        keys.append('-'.join(code.split('-')[:2]))
    keys.append(code.split('-')[0])
    return next((row.get('names', {}).get(k) for k in keys if row.get('names', {}).get(k)), row['name'])


def name_visible(row, locale=''):
    code = language(locale)
    keys = [code]
    if code.startswith(('zh-hans-', 'zh-hant-')):
        keys.append('-'.join(code.split('-')[:2]))
    keys.append(code.split('-')[0])
    flags = (row or {}).get('name_visibility', {})
    return next((flags[k] for k in keys if type(flags.get(k)) is bool), True)


def validate(value):
    if not isinstance(value, dict) or type(value.get('version')) is not int or value['version'] != 1 or not isinstance(value.get('rows'), list) or not 1 <= len(value['rows']) <= 1024:
        raise ValueError('说话人色系必须包含 1–1024 个说话人')
    ids = set()
    for row in value['rows']:
        if not isinstance(row, dict):
            raise ValueError('说话人配置无效')
        identity = row.get('id')
        if not isinstance(identity, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,160}', identity) or identity in ids:
            raise ValueError('说话人编号无效或重复')
        ids.add(identity)
        if 'scheme_ref' in row:
            ref = row['scheme_ref']
            if (not isinstance(ref, dict) or set(ref) != {'scheme_id', 'person_id'}
                    or any(not isinstance(v, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,160}', v) for v in ref.values())):
                raise ValueError('说话人方案对应无效')
        if 'names' in row:
            names = row['names']
            if not isinstance(names, dict) or len(names) > 64 or any(
                    not k or k != language(k) or not isinstance(v, str) or not v.strip() or len(v) > 64
                    or any(ord(c) < 32 or ord(c) == 127 for c in v) for k, v in names.items()):
                raise ValueError('说话人多语言名称无效')
        if 'name_visibility' in row:
            flags = row['name_visibility']
            if not isinstance(flags, dict) or len(flags) > 65 or any(
                    k != language(k) or type(v) is not bool for k, v in flags.items()):
                raise ValueError('说话人名称显示配置无效')
        for field, limit in [('name', 64), ('separator', 16)]:
            text = row.get(field)
            if not isinstance(text, str) or len(text) > limit or any(ord(c) < 32 or ord(c) == 127 for c in text) or field == 'name' and not text.strip():
                raise ValueError('说话人名称或分隔符无效')
        if not isinstance(row.get('mode'), str) or row['mode'] not in MODES or not isinstance(row.get('color'), str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', row['color']):
            raise ValueError('说话人颜色或着色模式无效')
        if 'style' in row and not cue_style.valid(row['style']) or 'animation' in row and not subtitle_animation.valid(row['animation']):
            raise ValueError('说话人样式或动画参数无效')
        if 'style_preset' in row and (not isinstance(row['style_preset'], str) or len(row['style_preset']) > 160):
            raise ValueError('说话人样式预设无效')
    return value


def profiles(project):
    value = (project.get('preview') or {}).get('speaker_palette')
    return {row['id']: row for row in validate(value)['rows']} if value is not None else None


def prefix(project, row, locale=''):
    if not row:
        return ''
    preview = project.get('preview') or {}
    show = preview.get('speaker_label_export', preview.get('speaker_labels_visible'))
    return display_name(row, locale) + row['separator'] if (show if type(show) is bool else row['mode'] == 'speaker') and name_visible(row, locale) else ''


def appearance(style, cue, row):
    result = dict(style)
    if not row:
        return result
    overrides = cue.get('subtitle_style') or {}
    field = {'text': 'primaryColor', 'stroke': 'outlineColor', 'background': 'backgroundColor'}.get(row['mode'])
    if field and field not in overrides:
        result[field] = row['color']
    if row['mode'] == 'background':
        if 'backgroundShape' not in overrides and result.get('backgroundShape', 'none') == 'none':
            result['backgroundShape'] = 'rounded'
        if 'backgroundOpacity' not in overrides and not result.get('backgroundOpacity'):
            result['backgroundOpacity'] = 80
    result.update(row.get('style') or {})
    result.update(overrides)
    if row.get('animation'):
        result['animation'] = subtitle_animation.resolve(style.get('animation'), row['animation'])
    return result
