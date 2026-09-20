"""One bounded worker for rebuildable editor peaks and playback proxies."""

import copy
import hashlib
import json
from pathlib import Path
import queue
import threading
import time
import uuid

from maw.msw.assets import atomic_bytes
from maw.msw.audio_render import RenderCancelled, check_cancel, command_prefix, run
from maw.waveform import extract_waveform, waveform_matches_media
from maw import mopeaks, quapeaks
from maw.project_io import default_audio_track_from_metadata, selected_audio_track_from_project

TERMINAL = {'succeeded', 'failed', 'cancelled', 'interrupted'}


class MediaJobs:
    def __init__(self, media):
        self.media = media
        self.root = media.root / 'analysis'
        self.root.mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.jobs, self.events = {}, {}
        self.pending = queue.Queue(maxsize=8)
        self.closed = False
        self.manifest = self.root / 'jobs.json'
        try:
            self.jobs = json.loads(self.manifest.read_text(encoding='utf-8'))
            for job in self.jobs.values():
                if job['status'] not in TERMINAL:
                    job.update(status='interrupted', error='服务已重启，请重试媒体分析')
        except (OSError, ValueError):
            self.jobs = {}
        self.worker = threading.Thread(target=self.work, daemon=True, name='msw-media-analysis')
        self.worker.start()

    def persist(self):
        atomic_bytes(self.manifest, (json.dumps(self.jobs, ensure_ascii=False) + '\n').encode('utf-8'))

    def public(self, job):
        return {k: copy.deepcopy(v) for k, v in job.items() if k not in {'key'}}

    def get(self, identity, project_id):
        with self.lock:
            job = self.jobs.get(identity)
            if not job or job['project_id'] != project_id:
                raise KeyError('媒体任务不存在')
            return self.public(job)

    def artifact(self, job):
        with self.lock:
            stored = self.jobs[job['id']]
            suffix = '.mopeaks' if stored.get('cache_version', 1) >= 2 else '.json'
            return self.root / (stored['key'] + (suffix if job['kind'] == 'waveform' else '.mp4'))

    def read_waveform(self, job, media):
        path = self.artifact(job)
        if path.suffix == '.mopeaks':
            return mopeaks.read_mopeaks(path, media['path'], audio_track=media['audio_index'])
        try:
            cached = json.loads(path.read_text(encoding='utf-8'))
            return cached if waveform_matches_media(cached, Path(media['path']), audio_track=media['audio_index']) else None
        except (OSError, ValueError):
            return None

    def submit(self, payload):
        self.media.check_context(payload)
        media = self.media.get(payload.get('media_id'), payload['project_id'])
        kind = payload.get('kind')
        if kind not in {'waveform', 'proxy'}:
            raise ValueError('未知媒体分析类型')
        tools = self.media.api.exports.tools()
        if not tools.ffmpeg:
            raise ValueError('找不到 FFmpeg，请在工具配置中设置路径后重试')
        if kind == 'waveform' and not media['metadata'].get('audio_tracks'):
            raise ValueError('媒体没有可分析的音轨')
        key = hashlib.sha256(json.dumps([media['path'], media['stamp'], media['audio_index'], kind, 2]).encode()).hexdigest()
        with self.lock:
            for job in self.jobs.values():
                if job['key'] == key and job['media_id'] == media['id'] and job['project_id'] == media['project_id']:
                    if job['status'] not in TERMINAL or (job['status'] == 'succeeded' and not payload.get('force') and self.artifact(job).is_file()):
                        return self.public(job)
            if self.closed or self.pending.full():
                raise ValueError('媒体分析队列已满，请稍后重试')
            job = dict(id='analysis-' + uuid.uuid4().hex, project_id=media['project_id'], media_id=media['id'],
                       kind=kind, key=key, cache_version=2, force=payload.get('force') is True, status='queued', progress=0, created=time.time(), error=None)
            self.jobs[job['id']] = job
            self.events[job['id']] = threading.Event()
            self.persist()
            self.pending.put_nowait((job['id'], media, str(tools.ffmpeg)))
            return self.public(job)

    def cancel(self, identity, project_id):
        with self.lock:
            self.get(identity, project_id)
            job = self.jobs[identity]
            if job['status'] not in TERMINAL:
                self.events[identity].set()
                job['status'] = 'cancelling'
                self.persist()
            return self.public(job)

    def result(self, identity, project_id):
        job = self.get(identity, project_id)
        media = self.media.get(job['media_id'], project_id)
        if job['status'] != 'succeeded':
            raise ValueError('媒体分析尚未完成')
        if job['kind'] == 'waveform':
            cached = self.read_waveform(job, media)
            if cached is None:
                raise ValueError('波形缓存失效，请重新生成')
            source = Path(media['path'])
            options = dict(audio_track=media['audio_index'], default_audio_track=default_audio_track_from_metadata(media['metadata']))
            layers = {'waveform': cached, 'spectral': quapeaks.load_spectral_payload(source, **options),
                      'waveform_reapeaks': quapeaks.load_waveform_payload(source, **options),
                      'loudness': quapeaks.load_loudness_stats(source, **options)}
            with self.media.api.server.save_lock:
                bound = self.media.api.server.project
                active = self.media.active(project_id)
                if (self.media.api.context()['projectId'] == project_id and active and active['id'] == media['id']
                        and (bound.source_media_path or bound.media_path) == source
                        and selected_audio_track_from_project(bound.data) == media['audio_index']):
                    bound.data.update(layers)  # Runtime-only under the save lock; disk writers strip these keys.
            return layers
        return {'url': f'/api/msw/media-proxy?project_id={project_id}&job_id={identity}'}

    def work(self):
        while True:
            task = self.pending.get()
            if task is None:
                return
            identity, media, ffmpeg = task
            with self.lock:
                job, cancel = self.jobs[identity], self.events[identity]
                job['status'] = 'running'
            target = self.artifact(job)
            scratch = target.with_name(identity + '.part.mp4')
            try:
                check_cancel(cancel)
                self.media.get(media['id'], media['project_id'])
                if job['kind'] == 'waveform':
                    path = Path(media['path'])
                    cached = self.read_waveform(job, media) if not job['force'] else None
                    options = dict(audio_track=media['audio_index'], default_audio_track=default_audio_track_from_metadata(media['metadata']))
                    if not job['force'] and not waveform_matches_media(cached, path, audio_track=media['audio_index']):
                        cached = quapeaks.load_self_wave_payload(path, **options) or mopeaks.load_waveform_cache(path, **options)
                        if cached is None:
                            cached = quapeaks.load_waveform_payload(path, **options)
                        if cached is None:
                            # Old manifests remain readable without bulk migration.
                            with self.lock:
                                old = [dict(item) for item in self.jobs.values() if item.get('cache_version', 1) == 1
                                       and item['kind'] == 'waveform' and item['media_id'] == media['id']
                                       and item['status'] == 'succeeded']
                            cached = next((value for item in old if (value := self.read_waveform(item, media)) is not None), None)
                    if not waveform_matches_media(cached, path, audio_track=media['audio_index']):
                        def progress(milliseconds):
                            with self.lock:
                                job['progress'] = min(99, round(milliseconds * 100 / max(1, media['metadata'].get('duration_ms', 0))))
                        cached = extract_waveform(path, ffmpeg_bin=ffmpeg, audio_track=media['audio_index'],
                                                  cancel_event=cancel, progress=progress)
                    check_cancel(cancel)
                    self.media.get(media['id'], media['project_id'])
                    atomic_bytes(target, mopeaks.encode_mopeaks(cached, path))
                    if not media.get('managed') and not quapeaks.find_self_wave_container(path, **options):
                        try:
                            mopeaks.save_mopeaks(cached, path, **options)
                        except OSError:
                            pass  # The verified managed artifact remains available.
                elif not target.is_file() or job['force']:
                    command = command_prefix(ffmpeg) + ['-protocol_whitelist', 'file,pipe', '-i', media['path']]
                    if media['video']:
                        command += ['-map', f"0:{media['video']['index']}", '-c:v', 'libx264', '-preset', 'veryfast',
                                    '-crf', '23', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p']
                    else:
                        command += ['-vn']
                    if media['metadata'].get('audio_tracks'):
                        command += ['-map', f"0:a:{media['audio_index']}", '-c:a', 'aac', '-b:a', '192k']
                    else:
                        command += ['-an']
                    run(command + ['-movflags', '+faststart', str(scratch)], cancel, timeout=6 * 3600,
                        failure_message='播放代理生成失败；可重试，原媒体仍可用于识别')
                    self.media.get(media['id'], media['project_id'])
                    check_cancel(cancel)
                    scratch.replace(target)
                check_cancel(cancel)
                with self.lock:
                    job.update(status='succeeded', progress=100)
            except Exception as error:
                with self.lock:
                    job.update(status='cancelled' if cancel.is_set() or isinstance(error, RenderCancelled) else 'failed',
                               error=None if cancel.is_set() else str(error))
            finally:
                scratch.unlink(missing_ok=True)  # Owned incomplete proxy only.
                with self.lock:
                    self.events.pop(identity, None)
                    self.persist()

    def close(self):
        with self.lock:
            self.closed = True
            for event in self.events.values():
                event.set()
        self.pending.put(None)
        self.worker.join(timeout=15)
