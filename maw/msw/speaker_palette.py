"""Project-owned speaker identities. Legacy color.name stores the stable row ID.

Names and RGB values are editable attributes, never the identity of a speaker.
"""
import re

MODES = {'none', 'text', 'stroke', 'background', 'speaker'}


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
        for field, limit in [('name', 64), ('separator', 16)]:
            text = row.get(field)
            if not isinstance(text, str) or len(text) > limit or any(ord(c) < 32 or ord(c) == 127 for c in text) or field == 'name' and not text.strip():
                raise ValueError('说话人名称或分隔符无效')
        if not isinstance(row.get('mode'), str) or row['mode'] not in MODES or not isinstance(row.get('color'), str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', row['color']):
            raise ValueError('说话人颜色或着色模式无效')
    return value


def profiles(project):
    value = (project.get('preview') or {}).get('speaker_palette')
    return {row['id']: row for row in validate(value)['rows']} if value is not None else None


def prefix(project, row):
    if not row:
        return ''
    show = (project.get('preview') or {}).get('speaker_label_export')
    return row['name'] + row['separator'] if (show if type(show) is bool else row['mode'] == 'speaker') else ''


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
    return result
