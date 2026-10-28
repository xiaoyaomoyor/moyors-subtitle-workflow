"""Portable speaker schemes contain descriptions, never project cue references."""
import re
from maw.msw.speaker_palette import validate as validate_palette


def validate(library):
    if (not isinstance(library, dict) or set(library) != {'version', 'schemes'}
            or type(library['version']) is not int or library['version'] != 1
            or not isinstance(library['schemes'], list) or len(library['schemes']) > 64):
        raise ValueError('说话人方案库无效（最多 64 个方案）')
    ids, names = set(), set()
    fields = {'id', 'name', 'names', 'name_visibility', 'color', 'mode', 'separator', 'style', 'animation'}
    for scheme in library['schemes']:
        if (not isinstance(scheme, dict) or set(scheme) != {'id', 'name', 'rows'}
                or not isinstance(scheme['id'], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,160}', scheme['id'])
                or scheme['id'] in ids or not isinstance(scheme['name'], str) or not scheme['name'].strip()
                or len(scheme['name']) > 80 or re.search(r'[\x00-\x1f\x7f]', scheme['name']) or scheme['name'] in names):
            raise ValueError('说话人方案标识或名称无效')
        validate_palette({'version': 1, 'rows': scheme['rows']})
        if any(set(row) - fields for row in scheme['rows']):
            raise ValueError('说话人方案不能包含工程引用或未知字段')
        ids.add(scheme['id'])
        names.add(scheme['name'])
    return library
