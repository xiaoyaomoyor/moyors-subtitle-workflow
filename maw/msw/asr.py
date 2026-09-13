"""ASR candidates from an immutable source/range snapshot; never save a project."""

import copy
from dataclasses import replace
import json
from pathlib import Path
import tempfile
import time
import wave

from maw.gui_workflow import run_transcription, TranscriptionProcessError
from maw.msw.audio_render import check_cancel, command_prefix, run
from maw.msw.project_codec import valid_id
from maw.project import normalize_project


def validate_snapshot(raw):
    if not isinstance(raw, dict) or not valid_id(raw.get('project_id')):
        raise ValueError('ASR 缺少工程快照')
    source, span = raw.get('source'), raw.get('range')
    if not isinstance(source, dict) or not valid_id(source.get('id')) or not isinstance(source.get('revision'), str):
        raise ValueError('ASR 缺少有效源媒体版本')
    duration = source.get('duration_ms')
    if type(duration) is not int or not 0 < duration <= 7 * 86400000:
        raise ValueError('源媒体时长不可用')
    if not isinstance(span, dict) or any(type(span.get(key)) is not int for key in ('start', 'end')):
        raise ValueError('ASR 范围必须使用整数毫秒')
    if not 0 <= span['start'] < span['end'] <= duration:
        raise ValueError('ASR 范围必须位于源媒体内')
    mode = raw.get('mode')
    if mode not in {'whole', 'range'} or (mode == 'whole' and (span['start'] != 0 or span['end'] != duration)):
        raise ValueError('整个源视频与时间选区不能混用')
    targets = raw.get('targets')
    if not isinstance(targets, list) or len(targets) > 10000:
        raise ValueError('ASR 目标字幕快照过大或无效')
    normalized = normalize_project({'segments': [{key: copy.deepcopy(cue[key]) for key in
        ('id', 'start', 'end', 'text', 'items', 'disabled', 'start_frame', 'end_frame') if key in cue}
        for cue in targets]})['segments']
    if mode == 'range' and any(cue['start'] < span['start'] or cue['end'] > span['end'] for cue in normalized):
        raise ValueError('选区切穿已有字幕；请调整范围或先扩展到完整字幕边界')
    return {'project_id': raw['project_id'], 'source': {key: copy.deepcopy(source[key]) for key in
            ('id', 'revision', 'reference', 'name', 'audio_index', 'duration_ms') if key in source},
            'range': {'start': span['start'], 'end': span['end']}, 'mode': mode, 'targets': copy.deepcopy(targets)}


def map_candidates(project, span, job_id):
    cues = normalize_project(project)['segments']
    length = span['end'] - span['start']
    output, originals = [], []
    for original_index, cue in enumerate(cues):
        start, end = max(0, cue['start']), min(length, cue['end'])
        if end <= start:
            continue
        result = {key: copy.deepcopy(value) for key, value in cue.items() if key not in
                  {'id', 'items', '_dirty', 'start_frame', 'end_frame', 'sticker', 'sticker_ref', 'color', 'color_ref'}}
        result.update(id=f'asr-{job_id}-{len(output)}', start=start + span['start'], end=end + span['start'])
        if 'items' in cue:
            items = []
            for item in cue['items']:
                low, high = max(start, item['start']), min(end, item['end'])
                if high > low:
                    items.append({**{key:value for key,value in item.items() if key not in ('start_frame','end_frame')},
                                  'start': low + span['start'], 'end': high + span['start']})
            if items:
                result['items'] = items
        output.append(result)
        originals.append(original_index)
    # Preserve speaker/style groups while remapping both their timing and any
    # head indices affected by clipping. No crop-local times reach the editor.
    for head, ref in [('color','color_ref'), ('sticker','sticker_ref')]:
        groups = {}
        for index, original_index in enumerate(originals):
            cue = cues[original_index]
            head_index = original_index if cue.get(head) else (cue.get(ref) or {}).get('headIdx')
            if type(head_index) is int and 0 <= head_index < len(cues) and cues[head_index].get(head):
                groups.setdefault(head_index, []).append(index)
        for head_index, members in groups.items():
            first, last = members[0], members[-1]
            style = copy.deepcopy(cues[head_index][head])
            style.update(start=output[first]['start'], end=output[last]['end'])
            style.pop('start_frame', None)
            style.pop('end_frame', None)
            output[first][head] = style
            for index in members[1:]:
                output[index][ref] = {'headIdx':first}
    return output


class AsrService:
    def __init__(self, api, *, transcribe=run_transcription):
        self.api, self.transcribe = api, transcribe
        self.root = api.data_root / 'editor-asr'
        self.root.mkdir(parents=True, exist_ok=True)

    def source(self, snapshot, *, require_active=False):
        source = snapshot['source']
        record = self.api.media.get(source['id'], snapshot['project_id'])
        if record.get('track_conflict'):
            raise ValueError('工程的公共音轨与旧 MSW 音轨冲突，请在媒体设置中确认源音轨后再识别')
        public = self.api.media.public(record)
        if source['revision'] != public['revision'] or source['duration_ms'] != record['metadata'].get('duration_ms'):
            raise ValueError('媒体或音轨已改变，旧 ASR 任务不能应用到当前媒体')
        if source.get('audio_index') != record['audio_index']:
            raise ValueError('ASR 音轨与媒体登记不一致')
        if not record['metadata'].get('audio_tracks'):
            raise ValueError('媒体没有可识别的音轨')
        if require_active:
            active = self.api.media.active(snapshot['project_id'])
            if not active or active['id'] != record['id']:
                raise ValueError('当前媒体已切换，请重新创建 ASR 任务')
        return record

    def prepare(self, payload):
        self.api.media.check_context(payload)
        snapshot = validate_snapshot(payload.get('snapshot'))
        if snapshot['project_id'] != payload['project_id']:
            raise ValueError('ASR 工程快照不一致')
        record = self.source(snapshot, require_active=True)
        public = self.api.media.public(record)
        snapshot['source'] = {key: public[key] for key in ('id', 'revision', 'reference', 'name', 'audio_index')}
        snapshot['source']['duration_ms'] = record['metadata']['duration_ms']
        if not self.api.exports.tools().complete:
            raise ValueError('ASR 需要 FFmpeg 与 FFprobe，请先配置媒体工具')
        return snapshot, record

    def run(self, job, settings, cancel, progress):
        snapshot = job['snapshot']
        record = self.source(snapshot)
        tools = self.api.exports.tools()
        if not tools.complete:
            raise ValueError('找不到 FFmpeg 或 FFprobe')
        check_cancel(cancel)
        with tempfile.TemporaryDirectory(prefix=f"asr-{job['id']}-", dir=self.root) as directory:
            root = Path(directory)
            source = root / 'source.wav'
            span = snapshot['range']
            progress('extracting', {'message': '正在提取所选源音轨', 'start_ms': span['start'], 'end_ms': span['end']})
            run(command_prefix(tools.ffmpeg) + ['-protocol_whitelist', 'file,pipe', '-copyts', '-start_at_zero',
                '-i', record['path'], '-map', f"0:a:{record['audio_index']}", '-vn', '-af',
                f"aresample=16000:async=1:first_pts=0,atrim=start_sample={span['start'] * 16}:end_sample={span['end'] * 16},asetpts=PTS-STARTPTS",
                '-ac', '1', '-c:a', 'pcm_s16le', str(source)], cancel, timeout=6 * 3600,
                failure_message='提取 ASR 音频失败，请检查源媒体、所选音轨和缓存空间')
            with wave.open(str(source), 'rb') as audio:
                actual_ms = round(audio.getnframes() * 1000 / audio.getframerate())
            if actual_ms <= 0:
                raise ValueError('所选范围没有可用音频')
            self.source(snapshot)
            progress('recognizing', {'message': '正在识别源音频', 'duration_ms': actual_ms})
            isolated_env = root / 'isolated.env'
            isolated_env.write_bytes(b'')
            request = replace(settings.request, media_path=source, srt_path=root / 'result.srt', audio_track=0,
                              default_audio_track=0, env_path=isolated_env)
            last_progress = 0
            def on_event(_line):
                nonlocal last_progress
                now = time.monotonic()
                if now - last_progress >= 1:
                    progress('recognizing', {'message': '正在等待识别结果'})
                    last_progress = now
            try:
                result = self.transcribe(request, cancel_event=cancel, on_event=on_event)
            except TranscriptionProcessError as error:
                # Provider diagnostics can include URLs and credentials. Never
                # persist raw child output in the shared job store.
                raise ValueError(f'ASR 进程失败（退出码 {error.exit_code}），请检查模型、服务配置、额度及音频大小限制') from error
            check_cancel(cancel)
            self.source(snapshot)
            if result.json_path.stat().st_size > 32 * 1024 * 1024:
                raise ValueError('识别结果过大，请缩小时间范围')
            project = json.loads(result.json_path.read_text(encoding='utf-8'))
            candidates = map_candidates(project, span, job['id'])
            if len(candidates) > 10000:
                raise ValueError('识别结果超过 10000 条，请分段处理')
            progress('ready', {'message': '识别完成，等待结果应用'})
            return {'segments': candidates, 'source': snapshot['source'], 'range': span,
                    'extraction_start_ms': span['start'], 'extracted_duration_ms': actual_ms,
                    'language': project.get('language', ''), 'model': settings.model,
                    'warnings': ['所选音轨在范围终点前结束'] if actual_ms + 100 < span['end'] - span['start'] else []}
