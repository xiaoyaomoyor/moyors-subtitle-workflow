"""Read-only launcher inventory and explicit operation support by project version.

Never project flat cues back into the legacy root segments array. The inventory
is a detached snapshot; disabled/hidden/locked cues still make a project nonempty.
"""
from __future__ import annotations

from maw.msw.flat_subtitles import SCHEMA as FLAT_SCHEMA, SubtitleIndex, migrate_project, normalize_groups
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
    return {'supported': True, 'reason': ''}


def require_operation(project: dict, operation: str, *, scoped=False) -> None:
    support = operation_support(project, operation)
    if not support['supported']:
        raise ValueError(support['reason'])
    # Unadapted direct legacy helpers must still fail before touching root segments.
    if not scoped and operation in {'asr', 'postprocess'} and project.get('schema') in (*LAYERED_SCHEMAS, FLAT_SCHEMA):
        raise ValueError('请在启动器的任务详情中选择处理轨道，或在编辑器中按轨道处理；此旧入口不能处理完整多轨工程。')


def project_inventory(project: dict) -> dict:
    """Return real track/cue identities for a validated, normalized project."""
    view = project if project.get('schema') == FLAT_SCHEMA else normalize_groups(migrate_project(project), infer=True)
    index = SubtitleIndex(view)
    tracks = []
    bound = {b[k] for b in view['subtitles']['bindings'] for k in ('source_id', 'target_id')}
    for track in index.tracks.values():
        cues = index.records(track_id=track['id'], include_hidden=True)
        active = index.records(track_id=track['id'], include_disabled=False)
        tracks.append({
            'id': track['id'], 'label': track['name'], 'secondaryFor': track.get('secondary_for'),
            'boundCueCount': sum(cue['id'] in bound for cue in active),
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
