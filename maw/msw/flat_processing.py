"""Explicit v4 processing snapshots; providers still consume timed text batches.

The captured native model is a conflict guard, never a lossy v3 project. Old
requests retain their existing validation and cannot accidentally enter v4.
"""
from copy import deepcopy

from maw.msw.flat_subtitles import SCHEMA, validate


def context(raw, *, target=False):
    if raw.get('project_schema') != SCHEMA:
        raise ValueError('平级字幕任务版本无效')
    model = raw.get('flat_model')
    validate({'schema': SCHEMA, 'subtitles': model})
    if len(model['cues']) > 10000 or 'migration' in model:
        raise ValueError('处理快照过大或包含不需要的迁移记录')
    tracks = {t['id']: t for t in model['tracks']}
    owner = raw.get('subtitle_track_id')
    if target and (owner not in tracks or tracks[owner]['locked'] or not tracks[owner]['enabled']):
        raise ValueError('请选择已启用且未锁定的目标字幕轨道')
    return {'project_schema': SCHEMA, 'flat_model': deepcopy(model),
            **({'subtitle_track_id': owner} if target else {})}


def translation_snapshot(raw):
    from maw.msw.jobs import validate_snapshot
    extra = context(raw, target=True)
    rows = {c['id']: c for c in extra['flat_model']['cues']}
    entries = raw.get('entries')
    if not isinstance(entries, list):
        raise ValueError('翻译来源无效')
    for entry in entries:
        source = entry.get('source') if isinstance(entry, dict) else None
        cue = rows.get(source.get('id')) if isinstance(source, dict) else None
        if not cue or any(source.get(k) != cue['content'].get(k) for k in ('start', 'end', 'text')):
            raise ValueError('翻译来源与平级字幕快照不一致')
        if cue['track_id'] == extra['subtitle_track_id']:
            raise ValueError('译文请选择另一条轨道')
    # Validate the provider's timed-text batch through the existing overlap-safe
    # validator. This is a task input, never a serialized legacy project.
    clean = validate_snapshot({**raw, 'project_schema': 'msw.project.v2'})
    return {**clean, **extra}


def asr_snapshot(raw):
    from maw.msw.asr import validate_snapshot
    extra = context(raw, target=True)
    span = raw.get('range')
    if not isinstance(span, dict) or any(type(span.get(k)) is not int for k in ('start', 'end')):
        raise ValueError('识别范围无效')
    expected = [{**c['content'], 'id': c['id']} for c in extra['flat_model']['cues']
                if c['track_id'] == extra['subtitle_track_id']
                and c['content']['start'] < span['end'] and span['start'] < c['content']['end']]
    if raw.get('targets') != expected:
        raise ValueError('识别目标与平级字幕快照不一致')
    clean = validate_snapshot({**raw, 'project_schema': 'msw.project.v2'})
    return {**clean, **extra}


def tts_snapshot(raw, provider_id):
    from maw.msw.tts import validate_snapshot
    extra = context(raw)
    rows = {c['id']: c for c in extra['flat_model']['cues']}
    clean = validate_snapshot({k: v for k, v in raw.items() if k != 'project_schema'}, provider_id)
    for source in clean['entries']:
        cue = rows.get(source['id'])
        if not cue or source['track_id'] != cue['track_id'] or any(
                source[k] != cue['content'][k] for k in ('start', 'end', 'text')):
            raise ValueError('配音来源与平级字幕快照不一致')
        source['subtitle_cue_id'] = cue['id']
    return {**clean, **extra}
