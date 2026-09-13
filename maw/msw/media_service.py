"""Registered editor media. Paths originate in native pickers or owned uploads."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import threading
import time
import uuid

from maw.media import MEDIA_EXTENSIONS, read_bwf_time_reference
from maw.msw.assets import atomic_bytes
from maw.msw.audio_render import fingerprint, probe_source
from maw.msw.dialogs import pick_media_source
from maw.msw.project_codec import valid_id
from maw.project_io import (selected_audio_track_from_project, selected_audio_track_from_metadata,
                            default_audio_track_from_metadata, audio_track_conflict)

CHUNK_BYTES = 4 * 1024 * 1024
MAX_BYTES = 64 * 1024 ** 3


class MediaService:
    def __init__(self, api):
        self.api = api
        self.root = api.data_root / 'editor-media'
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.picker_lock = threading.Lock()
        self.picker = pick_media_source
        self.records = {}
        self.uploads = {}
        self.closed = False
        self._waveforms = None
        self.manifest = self.root / 'registrations.json'
        try:
            records = json.loads(self.manifest.read_text(encoding='utf-8'))
            if isinstance(records, dict):
                self.records = {key: value for key, value in records.items()
                                if valid_id(key) and isinstance(value, dict) and valid_id(value.get('project_id'))}
        except (OSError, ValueError):
            pass

    def check_context(self, payload):
        if not valid_id(payload.get('project_id')) or payload.get('binding') != self.api.context()['binding']:
            raise ValueError('工程已切换，请重新导入媒体')
        if not valid_id(payload.get('client_token')):
            raise ValueError('缺少媒体导入会话')

    @property
    def jobs(self):
        with self.lock:
            if self._waveforms is None:
                from maw.msw.media_jobs import MediaJobs
                self._waveforms = MediaJobs(self)
            return self._waveforms

    def select_track(self, payload):
        self.check_context(payload)
        record = self.get(payload.get('media_id'), payload['project_id'])
        index = payload.get('audio_index')
        tracks = record['metadata'].get('audio_tracks', [])
        if type(index) is not int or index not in [track['audio_index'] for track in tracks]:
            raise ValueError('源音轨不存在')
        if index != record['audio_index'] or record.get('track_conflict'):
            record.update(id='media-' + uuid.uuid4().hex, audio_index=index, track_conflict=False, committed=False, created=time.time())
            record['metadata']['selected_audio_track'] = index
            with self.lock:
                self.records[record['id']] = record
                self.persist()
        return {'media': self.public(record)}

    def tools_settings(self, payload=None):
        from maw.gui_config import load_env, save_env
        from maw.ffmpeg import resolve_ffmpeg_tools
        if payload is not None:
            configured = payload.get('ffmpeg_path', '')
            if not isinstance(configured, str) or len(configured) > 4096 or '\0' in configured:
                raise ValueError('FFmpeg 路径无效')
            if os.environ.get('FFMPEG_PATH'):
                raise ValueError('FFmpeg 路径由启动环境设置，请修改启动环境后重开编辑器')
            tools = resolve_ffmpeg_tools(configured_path=configured.strip() or None)
            if configured.strip() and not tools.complete:
                raise ValueError('所选路径没有完整的 FFmpeg 和 FFprobe')
            save_env(self.api.env_path, {'FFMPEG_PATH': configured.strip()})
        tools = self.api.exports.tools()
        return {'ffmpeg_path': os.environ.get('FFMPEG_PATH') or load_env(self.api.env_path).get('FFMPEG_PATH', ''),
                'read_only': bool(os.environ.get('FFMPEG_PATH')), 'ready': tools.complete}

    def persist(self):
        atomic_bytes(self.manifest, (json.dumps(self.records, ensure_ascii=False) + '\n').encode('utf-8'))

    def active(self, project_id, reference=None):
        with self.lock:
            candidates = [item for item in self.records.values() if item['project_id'] == project_id and item.get('committed')
                          and (reference is None or item['reference'] == reference)]
            return copy.deepcopy(max(candidates, key=lambda item: item['created'], default=None))

    def get(self, media_id, project_id, *, verify=True):
        with self.lock:
            record = copy.deepcopy(self.records.get(media_id))
        if not record or record['project_id'] != project_id:
            raise KeyError('媒体不属于当前工程')
        if verify and list(fingerprint(record['path'])) != record['stamp']:
            raise ValueError('源媒体已改变，请重新导入；未使用旧缓存或识别结果')
        return record

    def public(self, record):
        return {key: copy.deepcopy(record[key]) for key in
                ('id', 'project_id', 'name', 'reference', 'metadata', 'video', 'audio_index', 'stamp', 'time_reference')} | {
                    'url': f"/api/msw/media-source?project_id={record['project_id']}&media_id={record['id']}",
                    'managed': record.get('managed', False),
                    'track_conflict': record.get('track_conflict', False),
                    'revision': hashlib.sha256(json.dumps([record['path'], record['stamp'], record['audio_index']]).encode()).hexdigest()}

    def register(self, path, project_id, *, name=None, audio_index=None, managed=False, metadata=None):
        path = Path(path).resolve(strict=True)
        if path.suffix.lower() not in MEDIA_EXTENSIONS or not path.is_file():
            raise ValueError('请选择支持的音视频文件')
        if not 0 < path.stat().st_size <= MAX_BYTES:
            raise ValueError('媒体文件为空或超过 64 GiB')
        stamp = list(fingerprint(path))
        tools = self.api.exports.tools()
        info = probe_source(tools.ffprobe, path, threading.Event()) if tools.ffprobe else {}
        media_metadata = copy.deepcopy(metadata or {})
        if info:
            media_metadata['duration_ms'] = info['duration_ms']
            media_metadata['audio_tracks'] = info['audio_tracks']
            video = info.get('video')
            if video and video.get('frame_rate'):
                try:
                    from fractions import Fraction
                    fps = float(Fraction(video['frame_rate']))
                    if math.isfinite(fps) and 1 <= fps <= 240:
                        media_metadata.update(video_fps=fps, video_fps_ratio=video['frame_rate'])
                except (ValueError, ZeroDivisionError):
                    pass
        if list(fingerprint(path)) != stamp:
            raise ValueError('读取时媒体文件发生变化，请重试')
        if audio_index is None:
            audio_index = selected_audio_track_from_metadata(media_metadata)
            if audio_index is None:
                audio_index = default_audio_track_from_metadata(media_metadata)
        media_metadata['selected_audio_track'] = audio_index
        identity = 'media-' + uuid.uuid4().hex
        record = dict(id=identity, project_id=project_id, name=name or path.name, path=str(path),
                      reference=str(path), stamp=stamp, metadata=media_metadata, video=info.get('video'),
                      audio_index=audio_index, managed=managed, committed=False, created=time.time(),
                      time_reference=read_bwf_time_reference(path))
        with self.lock:
            self.records[identity] = record
            self.persist()
        return record

    def context(self, project_id, reference=None):
        record = self.active(project_id, reference)
        if record:
            with self.api.server.save_lock:
                bound = self.api.server.project
                if self.api.context()['projectId'] == project_id and record['reference'] == bound.data.get('media'):
                    if record['audio_index'] != selected_audio_track_from_project(bound.data):
                        record = None
                    else:
                        with self.lock:
                            self.records[record['id']]['track_conflict'] = audio_track_conflict(bound.data)
            if record:
                return self.public(self.get(record['id'], project_id))
        pending = None
        with self.api.server.save_lock:
            bound = self.api.server.project
            context = self.api.context()
            source = bound.source_media_path or bound.media_path
            if context['projectId'] == project_id and source and (reference is None or reference == bound.data.get('media')):
                pending = (source, selected_audio_track_from_project(bound.data), copy.deepcopy(bound.data.get('media_metadata')),
                           bound.data.get('media') or str(source), audio_track_conflict(bound.data))
            else:
                recovered = self.api._persistence.recovered.get(project_id) if self.api._persistence else None
                if recovered and recovered.get('media') and reference == recovered['project'].get('media'):
                    pending = (recovered['media'], selected_audio_track_from_project(recovered['project']),
                               copy.deepcopy(recovered['project'].get('media_metadata')), reference,
                               audio_track_conflict(recovered['project']))
        if pending is None:
            return None
        # FFprobe may take seconds. Never hold the save lock while discovering
        # media in the background (including immediately after Save As).
        source, audio_index, metadata, saved_reference, conflict = pending
        record = self.register(source, project_id, audio_index=audio_index, metadata=metadata)
        record['track_conflict'] = conflict
        with self.api.server.save_lock:
            if self.api.context()['binding'] != context['binding']:
                return None
            if context['projectId'] == project_id:
                current = self.api.server.project
                if ((current.source_media_path or current.media_path) != source
                        or (current.data.get('media') or str(source)) != saved_reference):
                    return None
            # Concurrent windows share an already committed registration.
            # A late probe must not replace a newer source or its identity.
            existing = self.active(project_id, saved_reference)
            if existing and existing['audio_index'] == audio_index:
                return self.public(self.get(existing['id'], project_id))
            record['reference'] = saved_reference
            record['committed'] = True
        with self.lock:
            self.persist()
        return self.public(record)

    def bind(self, payload):
        from dataclasses import replace
        self.check_context(payload)
        record = self.get(payload.get('media_id'), payload['project_id'])
        if record.get('track_conflict'):
            raise ValueError('工程的公共音轨与旧 MSW 音轨冲突，请先确认源音轨')
        with self.api.server.save_lock:
            self.check_context(payload)
            with self.lock:
                self.records[record['id']].update(committed=True, created=time.time())
                self.persist()
            bound = self.api.server.project
            if self.api.context()['projectId'] == payload['project_id']:
                data = copy.deepcopy(bound.data)
                data.update(media=record['reference'], media_metadata=record['metadata'])
                if isinstance(data.get('msw'), dict):
                    data['msw']['source_audio_index'] = record['audio_index']
                for key in ('waveform', 'spectral', 'waveform_reapeaks'):
                    data.pop(key, None)
                self.api.server.project = replace(bound, data=data, media_path=Path(record['path']),
                                                  source_media_path=Path(record['path']), audio_track=record['audio_index'])
        return {'media': self.public(record)}

    def choose(self, payload):
        self.check_context(payload)
        if not self.picker_lock.acquire(blocking=False):
            raise ValueError('媒体选择窗口已经打开')
        try:
            path = self.picker()
            if path is None:
                return {'cancelled': True}
            self.check_context(payload)
            record = self.register(path, payload['project_id'])
            self.check_context(payload)
            return {'media': self.public(record)}
        finally:
            self.picker_lock.release()

    def begin_upload(self, payload):
        self.check_context(payload)
        name, size = payload.get('name'), payload.get('size')
        if not isinstance(name, str) or not 1 <= len(name) <= 255 or any(c in name for c in '/\\\x00\r\n'):
            raise ValueError('媒体文件名无效')
        if Path(name).suffix.lower() not in MEDIA_EXTENSIONS or type(size) is not int or not 0 < size <= MAX_BYTES:
            raise ValueError('媒体格式或大小无效，最大 64 GiB')
        with self.lock:
            if self.closed or len(self.uploads) >= 8:
                raise ValueError('待导入媒体过多，请取消未完成的导入')
            if shutil.disk_usage(self.root).free < size + 128 * 1024 ** 2:
                raise ValueError('本机缓存空间不足，请使用本机文件选择导入原文件')
            identity = 'upload-' + uuid.uuid4().hex
            path = self.root / (identity + Path(name).suffix.lower() + '.part')
            path.touch(exist_ok=False)
            self.uploads[identity] = dict(id=identity, path=path, name=name, size=size, offset=0,
                                          project_id=payload['project_id'], binding=payload['binding'],
                                          client_token=payload['client_token'])
        return {'upload_id': identity, 'chunk_bytes': CHUNK_BYTES, 'offset': 0}

    def upload(self, identity, project_id):
        item = self.uploads.get(identity)
        if not item or item['project_id'] != project_id:
            raise KeyError('媒体上传不存在')
        self.check_context(item)
        return item

    def chunk(self, identity, project_id, offset, data):
        with self.lock:
            item = self.upload(identity, project_id)
            if type(offset) is not int or offset < 0 or not 0 < len(data) <= CHUNK_BYTES or offset + len(data) > item['size']:
                raise ValueError('媒体分块范围无效')
            if offset < item['offset']:
                with item['path'].open('rb') as stream:
                    stream.seek(offset)
                    if stream.read(len(data)) == data:
                        return {'offset': item['offset']}
                raise ValueError('重试分块与已有内容不一致')
            if offset != item['offset']:
                raise ValueError('媒体分块顺序无效')
            with item['path'].open('ab') as stream:
                stream.write(data)
            item['offset'] += len(data)
            return {'offset': item['offset']}

    def finish_upload(self, payload):
        self.check_context(payload)
        with self.lock:
            item = self.upload(payload.get('upload_id'), payload['project_id'])
            if item['offset'] != item['size']:
                raise ValueError('媒体尚未完整传输')
            target = self.root / (item['id'] + Path(item['name']).suffix.lower())
            os.replace(item['path'], target)
            self.uploads.pop(item['id'])
        record = self.register(target, item['project_id'], name=item['name'], managed=True)
        self.check_context(payload)
        return {'media': self.public(record)}

    def cancel_upload(self, payload):
        with self.lock:
            item = self.uploads.get(payload.get('upload_id'))
            if item and item['project_id'] == payload.get('project_id'):
                item['path'].unlink(missing_ok=True)  # Only our incomplete upload, never source media.
                self.uploads.pop(item['id'])
        return {'cancelled': True}

    def close(self):
        with self.lock:
            self.closed = True
            for item in list(self.uploads.values()):
                self.cancel_upload({'upload_id': item['id'], 'project_id': item['project_id']})
        if self._waveforms:
            self._waveforms.close()
