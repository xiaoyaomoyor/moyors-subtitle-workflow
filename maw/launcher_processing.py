"""Track-scoped launcher processing. Provider batches never replace the source project.

Only the selected, editable cues enter legacy timed-text algorithms. Results
are applied by stable identity to a detached v4 project, then validated before
publication. Other tracks, bindings and audio assets remain in the native model.
"""
from copy import deepcopy
from uuid import uuid4

from maw.msw.flat_subtitles import SubtitleIndex, migrate_project, normalize_groups, validate
from maw.speaker import inherit_speaker_color


def native_project(project):
    result = migrate_project(project)
    if project.get('schema') != 'msw.project.v4':
        normalize_groups(result, infer=True)
    return result


def source_track(project, track_id=None, *, editable=True):
    index = SubtitleIndex(project)
    if not track_id:
        track_id = next(iter(index.tracks))
    track = index.tracks.get(track_id)
    if track is None:
        raise ValueError('所选字幕轨道已不存在，请重新选择处理轨道。')
    if not track['enabled'] or editable and track['locked']:
        raise ValueError(f"{track['name']} 已禁用或锁定，请选择已启用且未锁定的处理轨道。")
    return track


def selected_cues(project, track_id, *, editable=True, allow_empty=False):
    track = source_track(project, track_id, editable=editable)
    cues = sorted(SubtitleIndex(project).records(track_id=track['id'], include_disabled=False),
                  key=lambda c: (c['content']['start'], c['content']['end'], c['id']))
    if not allow_empty and not any(c['content']['text'].strip() for c in cues):
        raise ValueError(f"{track['name']} 没有可处理的字幕文本；禁用和隐藏字幕不会参与处理。")
    return cues


def check_structure(project, cue_ids):
    wanted = set(cue_ids)
    if any(b['source_id'] in wanted or b['target_id'] in wanted for b in project['subtitles']['bindings']):
        raise ValueError('所选轨道包含已绑定字幕。重新识别、重分句和文稿匹配可能改变对应关系；请在编辑器中使用联动切分／合并，或选择未绑定轨道。')
    if any(c['id'] not in wanted and any((c['content'].get(k) or {}).get('cue_id') in wanted
                                       for k in ('color_ref', 'sticker_ref')) for c in project['subtitles']['cues']):
        raise ValueError('其他字幕仍引用所选字幕的颜色或贴图，请先在编辑器中调整引用后再改变字幕结构。')


def processing_snapshot(project, track_id):
    cues = selected_cues(project, track_id)
    segments = []
    for cue in cues:
        # Visual references belong to native cue IDs, not the provider protocol.
        content = {k: deepcopy(v) for k, v in cue['content'].items()
                   if k not in ('color_ref', 'sticker_ref', 'subtitle_position')}
        segments.append({**content, 'id': cue['id']})
    return {'segments': segments, 'language': source_track(project, track_id).get('language', project.get('language', ''))}


def apply_processed(project, track_id, segments, *, replace_all=False):
    result = deepcopy(project)
    selected = selected_cues(project, track_id, allow_empty=replace_all)
    before = {c['id']: c for c in selected}
    if replace_all:
        check_structure(project, before)
    after = {}
    new_ids = {str(s['id']): 'cue-' + uuid4().hex for s in segments if s.get('id')} if replace_all else {}
    for segment in segments:
        cue_id = str(segment.get('id') or '')
        if replace_all or not cue_id:
            cue_id = new_ids.get(cue_id) or 'cue-' + uuid4().hex
        if cue_id in after:
            raise ValueError('处理结果包含重复字幕 ID，未写入工程。')
        old = before.get(cue_id)
        content = deepcopy(segment)
        content.pop('id', None)
        if replace_all:
            for field in ('color_ref', 'sticker_ref'):
                ref = content.get(field)
                if ref and ref.get('cue_id') in new_ids:
                    ref['cue_id'] = new_ids[ref['cue_id']]
        if old:
            for key in ('color_ref', 'sticker_ref', 'subtitle_position'):
                if key in old['content']:
                    content[key] = deepcopy(old['content'][key])
        after[cue_id] = {**deepcopy(old or {}), 'id': cue_id, 'track_id': track_id, 'content': content}
    changed_structure = set(before) != set(after) or any(
        any(after[k]['content'][field] != c['content'][field] for field in ('start', 'end'))
        for k, c in before.items() if k in after)
    if changed_structure:
        check_structure(project, before)
    untouched = [c for c in result['subtitles']['cues'] if c['id'] not in before]
    if set(after) & {c['id'] for c in untouched}:
        raise ValueError('处理结果与其他轨道的字幕 ID 冲突，未写入工程。')
    result['subtitles']['cues'] = [*untouched, *after.values()]
    validate(result)
    return result


def translation_target(project, source_id, target_id=None):
    index = SubtitleIndex(project)
    source_track(project, source_id)
    if not target_id:
        target_id = next((t['id'] for t in index.tracks.values() if t.get('secondary_for') == source_id), 'new')
    if target_id != 'new':
        target = source_track(project, target_id)
        if target['id'] == source_id:
            raise ValueError('译文轨道必须与来源轨道不同。')
    else:
        target = None
    for cue in selected_cues(project, source_id, allow_empty=True):
        partners = index.partners(cue['id'])
        if partners and (target is None or partners[0]['track_id'] != target_id):
            raise ValueError('来源字幕已绑定到其他轨道，请选择其对应轨道保存译文，避免解除原有绑定。')
        if target and not partners and any(
            other['track_id'] == target_id and other['content']['start'] < cue['content']['end']
            and cue['content']['start'] < other['content']['end'] for other in index.cues.values()):
            raise ValueError('译文目标范围已有未对应的字幕，请选择新轨道或先在编辑器中建立对应关系。')
        if partners and (partners[0].get('hidden') or partners[0]['content'].get('disabled')):
            raise ValueError('对应译文含隐藏或禁用字幕，请先在编辑器中启用后再翻译。')
    return target


def apply_translation(project, source_id, target_id, segments, *, language='zh'):
    result = deepcopy(project)
    selected = selected_cues(result, source_id)
    target = translation_target(result, source_id, target_id)
    rows = {s['id']: s for s in segments}
    if len(rows) != len(segments) or set(rows) != {c['id'] for c in selected}:
        raise ValueError('译文与来源字幕 ID 不一致，未写入工程。')
    if target is None:
        target = dict(id='track-' + uuid4().hex, name='译文', purpose='translation', layout='auto',
                      enabled=True, locked=False, collapsed=False, language=language,
                      style={'base': 'dialogue', 'slot': 'secondary', 'mode': 'inherit'})
        source = source_track(result, source_id)
        if 'secondary_for' not in source and not any(t.get('secondary_for') == source_id for t in result['subtitles']['tracks']):
            target['secondary_for'] = source_id
        result['subtitles']['tracks'].append(target)
    index = SubtitleIndex(result)
    for cue in selected:
        translated = rows[cue['id']]
        if any(translated[k] != cue['content'][k] for k in ('start', 'end')):
            raise ValueError('译文改变了来源字幕时间，未写入工程。')
        partners = index.partners(cue['id'])
        if partners:
            content = partners[0]['content']
            content['text'] = translated['text']
            content.pop('items', None)
        else:
            cue_id = 'cue-' + uuid4().hex
            content = {'start': translated['start'], 'end': translated['end'], 'text': translated['text']}
            result['subtitles']['cues'].append(dict(id=cue_id, track_id=target['id'], content=content))
            result['subtitles']['bindings'].append(dict(id='binding-' + uuid4().hex, source_id=cue['id'], target_id=cue_id,
                                                       start_offset_ms=0, end_offset_ms=0))
        head = index.cues.get((cue['content'].get('color_ref') or {}).get('cue_id'), {})
        inherit_speaker_color(cue['content'], content, head.get('content'))
    normalize_groups(result)
    validate(result)
    return result, target['id']


def preflight(project, source_id, steps, *, recognize=False, target_id=None):
    track = source_track(project, source_id)
    cues = selected_cues(project, track['id'], allow_empty=recognize or not steps)
    if recognize and any(c['track_id'] == track['id'] and (c.get('hidden') or c['content'].get('disabled'))
                         for c in project['subtitles']['cues']):
        raise ValueError('重新识别的轨道包含禁用或隐藏字幕，请选择空轨道，或先在编辑器中明确要保留的范围。')
    if recognize or any(s['id'] in {'match', 'resegment'} for s in steps):
        check_structure(project, [c['id'] for c in cues])
    if any(s['id'] == 'translate' and not s.get('embedTranslations') for s in steps):
        translation_target(project, track['id'], target_id)
    return track['id']


def export_srt(project, track_ids=None, *, combine=False, reverse=False, cue_ids=None):
    from maw.msw.subtitle_export import srt
    index = SubtitleIndex(project)
    if track_ids is None:
        track_ids = [t['id'] for t in index.tracks.values() if t['enabled']]
    if not isinstance(track_ids, list) or any(t not in index.tracks for t in track_ids):
        raise ValueError('导出的字幕轨道已不存在，请重新选择。')
    order = {track_id: i for i, track_id in enumerate(track_ids)}
    cues = sorted((c for c in index.records(include_disabled=False) if c['track_id'] in order and c['content']['text'].strip() and (cue_ids is None or c['id'] in cue_ids)),
                  key=lambda c: (c['content']['start'], order[c['track_id']], c['id']))
    if not combine:
        return srt([{**c['content'], 'text': '\n'.join(line for line in c['content']['text'].strip().splitlines() if line.strip())} for c in cues])
    events, active, rows, previous = {}, {}, [], 0
    for cue in cues:
        events.setdefault(cue['content']['start'], []).append((cue, True))
        events.setdefault(cue['content']['end'], []).append((cue, False))
    for at, changes in sorted(events.items()):
        if at > previous and active:
            texts = sorted(active.values(), key=lambda c: (order[c['track_id']], c['content']['start']), reverse=reverse)
            blocks = dict.fromkeys(c['content']['text'].strip() for c in texts)
            rows.append(dict(start=previous, end=at, text='\n'.join(line for text in blocks for line in text.splitlines() if line.strip())))
        for cue, entering in changes:
            if entering:
                active[cue['id']] = cue
            else:
                active.pop(cue['id'], None)
        previous = at
    return srt(rows)


def run_track_step(step, *, scope, runner, **kwargs):
    """Adapt a provider operation without exposing any other track to it."""
    import json
    from dataclasses import replace
    from pathlib import Path
    from tempfile import TemporaryDirectory
    from maw.file_io import atomic_copy
    from maw.postprocess_io import read_project, write_derived_project, _atomic_write

    source_path = kwargs['project_path']
    project = native_project(read_project(source_path))
    track_id = preflight(project, scope.get('sourceTrackId'), [step], target_id=scope.get('targetTrackId'))
    with TemporaryDirectory(prefix='msw-track-process-') as directory:
        temporary = Path(directory)
        batch_path = temporary / 'batch.mosp'
        snapshot = processing_snapshot(project, track_id)
        _atomic_write(batch_path, json.dumps(snapshot, ensure_ascii=False))
        artifact = runner(step, **{**kwargs, 'project_path': batch_path, 'srt_path': temporary / 'batch.srt',
                                   'output_directory': temporary})
        if not artifact.project_path:
            raise ValueError('字幕处理未返回有效工程结果。')
        segments = read_project(artifact.project_path)['segments']
        translation = step['id'] == 'translate'
        translated = None
        target_id = None
        translated_ids = None
        if translation and not step.get('embedTranslations'):
            processed, target_id = apply_translation(project, track_id, scope.get('targetTrackId'), segments,
                                                      language=str(step.get('target') or 'zh'))
            source_ids = {c['id'] for c in selected_cues(project, track_id)}
            translated_ids = {b['target_id'] if b['source_id'] in source_ids else b['source_id']
                              for b in processed['subtitles']['bindings'] if b['source_id'] in source_ids or b['target_id'] in source_ids}
            translated = export_srt(processed, [target_id], cue_ids=translated_ids)
        else:
            processed = apply_processed(project, track_id, segments)
            if translation:
                translated = export_srt(processed, [track_id])
        output = kwargs['output_directory'] / artifact.project_path.name
        seed, suffix = output, 2
        while (output.exists() or output.with_suffix('.srt').exists() or output.with_name(output.stem + '.translated.srt').exists()
               or getattr(artifact, 'report_path', None) and output.with_suffix(artifact.report_path.suffix).exists()):
            output = seed.with_name(f'{seed.stem}-{suffix}{seed.suffix}')
            suffix += 1
        warnings = (*artifact.warnings, *write_derived_project(processed, output, source_path))
        output_srt = output.with_suffix('.srt')
        export_ids = scope.get('exportTrackIds', [track_id])
        bilingual = translation and step.get('mergeBilingual') and target_id
        line_order = step.get('bilingualLineOrder') or ('translation_first' if step.get('target', 'zh') == 'zh' else 'original_first')
        _atomic_write(output_srt, export_srt(processed, [track_id, target_id] if bilingual else export_ids,
                                           combine=bool(bilingual), reverse=line_order == 'translation_first',
                                           cue_ids=(source_ids | translated_ids) if bilingual else None))
        translated_path = None
        if translated is not None:
            translated_path = output.with_name(output.stem + '.translated.srt')
            _atomic_write(translated_path, translated)
        extra = {}
        if getattr(artifact, 'report_path', None):
            report_path = output.with_suffix(artifact.report_path.suffix)
            atomic_copy(artifact.report_path, report_path)
            extra['report_path'] = report_path
        if hasattr(artifact, 'translated_srt_path'):
            extra['translated_srt_path'] = translated_path
        return replace(artifact, source_project_path=source_path, source_srt_path=kwargs['srt_path'],
                       project_path=output, srt_path=output_srt, warnings=warnings, **extra)
