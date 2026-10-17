"""Read-only launcher inventory and explicit operation support by project version.

Never project flat cues back into the legacy root segments array. The inventory
is a detached snapshot; disabled/hidden/locked cues still make a project nonempty.
"""
from __future__ import annotations

from maw.msw.flat_subtitles import SCHEMA as FLAT_SCHEMA, SubtitleIndex, migrate_project
from maw.project import LAYERED_SCHEMAS, project_schema_errors


def subtitle_count(project: dict) -> int:
    """Stored blocks, including disabled tracks and hidden cues (also for cards).

    Cards use this lightweight query before full validation. Operations must use
    read_project/normalize_project, never treat these tolerant counts as validity.
    """
    def count(value):
        return sum(isinstance(item, dict) for item in value) if isinstance(value, list) else 0

    if project.get('schema') == FLAT_SCHEMA:
        model = project.get('subtitles')
        return count(model.get('cues')) if isinstance(model, dict) else 0
    total = count(project.get('segments'))
    multi = project.get('multi_subtitle')
    if isinstance(multi, dict) and isinstance(multi.get('tracks'), list):
        total += sum(count(t.get('segments')) for t in multi['tracks'] if isinstance(t, dict)
                     and str(t.get('id', '')) not in {'main', 'primary'})
    overlay = project.get('overlay_track')
    return total + (count(overlay.get('segments')) if isinstance(overlay, dict) else 0)


def operation_support(project: dict, operation: str) -> dict:
    if operation not in {'inspect', 'media', 'waveform', 'copy', 'asr', 'postprocess', 'srt', 'alignment'}:
        raise ValueError(f'未知工程操作：{operation}')
    errors = project_schema_errors(project)
    if errors:
        return {'supported': False, 'reason': '不支持此工程版本，请使用支持该版本的 MSWE 打开。'}
    flat = project.get('schema') == FLAT_SCHEMA
    blocked = (flat and operation in {'asr', 'postprocess', 'srt', 'alignment'}) or (
        project.get('schema') in LAYERED_SCHEMAS and operation in {'asr', 'postprocess'})
    if not blocked:
        return {'supported': True, 'reason': ''}
    name = {'asr': '重新识别', 'postprocess': '字幕后处理', 'srt': 'SRT 导出', 'alignment': '字词时间码对齐'}[operation]
    kind = '平级轨道工程' if flat else '多层字幕工程'
    action = ('请关闭 SRT 输出，仅生成工程；字幕导出请在编辑器中选择轨道。' if operation == 'srt'
              else '请在编辑器中选择字幕轨道处理。' if operation != 'alignment'
              else '启动器尚未适配按平级轨道对齐，未运行对齐模型。')
    return {'supported': False, 'reason': f'{kind}暂不支持启动器的{name}。{action}原工程未修改。'}


def require_operation(project: dict, operation: str) -> None:
    support = operation_support(project, operation)
    if not support['supported']:
        raise ValueError(support['reason'])


def project_inventory(project: dict) -> dict:
    """Return real track/cue identities for a validated, normalized project."""
    view = project if project.get('schema') == FLAT_SCHEMA else migrate_project(project)
    index = SubtitleIndex(view)
    tracks = []
    for track in index.tracks.values():
        cues = index.records(track_id=track['id'], include_hidden=True)
        active = index.records(track_id=track['id'], include_disabled=False)
        tracks.append({
            'id': track['id'], 'label': track['name'],
            'enabled': track['enabled'], 'locked': track['locked'], 'collapsed': track['collapsed'],
            'cueIds': [cue['id'] for cue in cues], 'subtitleCount': len(cues),
            'activeSubtitleCount': len(active),
            'editableSubtitleCount': 0 if track['locked'] else len(active),
        })
    return {
        'projectSchema': project.get('schema'), 'subtitleTracks': tracks,
        'subtitleCount': subtitle_count(project), 'hasSubtitles': subtitle_count(project) > 0,
        'activeSubtitleCount': sum(t['activeSubtitleCount'] for t in tracks),
        'editableSubtitleCount': sum(t['editableSubtitleCount'] for t in tracks),
        'operations': {op: operation_support(project, op) for op in
                       ('inspect', 'media', 'waveform', 'copy', 'asr', 'postprocess', 'srt', 'alignment')},
    }
