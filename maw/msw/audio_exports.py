"""Local audio export jobs, immutable submissions and scoped downloads."""

import copy
import hashlib
import json
import os
from pathlib import Path
import queue
import secrets
import shutil
import sqlite3
import threading
import time
import uuid

from maw.ffmpeg import resolve_ffmpeg_tools
from maw.gui_config import load_env
from maw.msw.audio_plan import VERSION, compile_plan, options
from maw.msw.audio_render import RenderCancelled, check_cancel, fingerprint, probe_source, render
from maw.msw.project_codec import valid_id
from maw.msw.video_render import prepare as prepare_video, render_video
from maw.msw.timeline_export import editable_plan, render_bundle
from maw.project import normalize_project

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}


class AudioExports:
    def __init__(self, api, *, renderer=render):
        self.api, self.renderer = api, renderer
        self.root = api.data_root / "editor-exports" / f"port-{api.server.server_address[1]}"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / "jobs.sqlite3", check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT, request_key TEXT, fingerprint TEXT, payload TEXT, UNIQUE(project_id, request_key))")
        self.db.commit()
        self.events, self.downloads = {}, {}
        self.pending = queue.Queue()
        self.closed = False
        self.close_complete = threading.Event()
        for (body,) in self.db.execute("SELECT payload FROM jobs").fetchall():
            job = json.loads(body)
            if job["status"] not in TERMINAL:
                job.update(status="interrupted", error="编辑器服务已重启，请重新导出")
                self.write(job)
                self.artifact(job).unlink(missing_ok=True)
            # A hard shutdown can bypass TemporaryDirectory's cleanup. Remove
            # only scratch directories owned by a known job in this store.
            job_id = self.artifact(job).stem
            for scratch in self.root.glob(f"render-{job_id}-*"):
                if scratch.is_dir() and not scratch.is_symlink() and scratch.resolve().parent == self.root.resolve():
                    shutil.rmtree(scratch)
        self.worker = threading.Thread(target=self.work, daemon=True, name="msw-audio-export")
        self.worker.start()

    def tools(self):
        configured = os.environ.get("FFMPEG_PATH") or load_env(self.api.env_path).get("FFMPEG_PATH", "")
        return resolve_ffmpeg_tools(configured_path=configured or None)

    def source_scope(self, project_id, binding=None):
        with self.api.server.save_lock:
            context = self.api.context()
            if binding is not None and context["binding"] != binding:
                raise ValueError("工程已切换，请重新打开音频导出面板")
            bound = self.api.server.project
            if context["projectId"] == project_id:
                return bound.source_media_path or bound.media_path, bound.data, bound.audio_track
            record = self.api._persistence.recovered.get(project_id) if self.api._persistence else None
            if record:
                return record.get("media"), record["project"], 0
            return None, {}, 0

    def context(self, project_id, *, video=False):
        source, project, selected = self.source_scope(project_id)
        tools = self.tools()
        info = probe_source(tools.ffprobe, source, threading.Event()) if video and tools.complete and source and Path(source).is_file() else {}
        return dict(available=bool(tools.ffmpeg and tools.ffprobe), plan_schema=VERSION, source_available=bool(source and Path(source).is_file()),
                    media_reference=project.get("media"), audio_index=selected,
                    video=info.get("video"), duration_ms=info.get("duration_ms"),
                    audio_tracks=info.get("audio_tracks", (project.get("media_metadata") or {}).get("audio_tracks", [])))

    def write(self, job):
        job["updated_at"] = time.time()
        with self.db:
            self.db.execute("INSERT INTO jobs VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                            (job["id"], job["project_id"], job["request_key"], job["fingerprint"], json.dumps(job, ensure_ascii=False)))

    @staticmethod
    def public(job):
        return {key: value for key, value in job.items() if key not in {"fingerprint", "request_key"}}

    def get(self, job_id, project_id):
        row = self.db.execute("SELECT payload FROM jobs WHERE id=? AND project_id=?", (job_id, project_id)).fetchone()
        if not row:
            raise KeyError("导出任务不存在")
        return json.loads(row[0])

    def list(self, project_id):
        with self.lock:
            rows = self.db.execute("SELECT payload FROM jobs WHERE project_id=? ORDER BY rowid DESC LIMIT 20", (project_id,)).fetchall()
            return [self.public(json.loads(row[0])) for row in rows]

    def submit(self, payload):
        project_id, request_key = payload.get("project_id"), payload.get("request_key")
        if not valid_id(project_id) or not valid_id(request_key) or not valid_id(payload.get("client_token")):
            raise ValueError("缺少导出请求标识")
        if payload.get("plan_schema") != VERSION:
            raise ValueError("音频导出版本已变化，请刷新编辑器")
        project = normalize_project(payload.get("project"))
        if (project.get("msw") or {}).get("project_id") != project_id:
            raise ValueError("导出快照不属于当前工程")
        for cache in ("waveform", "spectral", "waveform_reapeaks"):
            project.pop(cache, None)
        settings = options(payload.get("options"))
        settings.setdefault("format", "wav")
        settings.setdefault("video_tail", "ask")
        settings.setdefault("video_encoding", "auto")
        settings.setdefault("collect_media", True)
        settings.setdefault('burn_subtitles', 'none')
        if (settings["format"] not in {"wav", "mp4", "otioz"} or settings["video_tail"] not in {"ask", "truncate", "freeze"}
                or settings["video_encoding"] not in {"auto", "h264"} or type(settings["collect_media"]) is not bool):
            raise ValueError("导出格式或视频选项无效")
        if settings['burn_subtitles'] not in {'none', 'main', 'secondary', 'both'}:
            raise ValueError('字幕压制选项无效')
        plan = compile_plan(project, settings)
        if settings["format"] == "otioz":
            plan = editable_plan(project, plan)
        signature = hashlib.sha256(json.dumps(dict(project=project, options=settings), sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            row = self.db.execute("SELECT payload FROM jobs WHERE project_id=? AND request_key=?", (project_id, request_key)).fetchone()
            if row:
                job = json.loads(row[0])
                if job["fingerprint"] != signature:
                    raise ValueError("相同导出请求不能提交不同快照")
                return self.public(job)
            if self.closed or len(self.events) >= 3:
                raise ValueError("已有较多音频导出任务，请等待或取消后重试")
        tools = self.tools()
        if not tools.ffmpeg or not tools.ffprobe:
            raise ValueError("音频导出需要 FFmpeg 与 FFprobe，请在启动器配置后重试")
        if not isinstance(payload.get("binding"), str):
            raise ValueError("缺少本机工程绑定，请重新打开编辑器")
        source, owner, _ = self.source_scope(project_id, payload["binding"])
        if (settings["mode"] == "mix" or settings["format"] == "mp4"
                or settings["format"] == "otioz" and source and project.get("media") == owner.get("media")):
            if not source or project.get("media") != owner.get("media") or not Path(source).is_file():
                raise ValueError("原媒体尚未由本机服务接管，请保存并在本机服务中重新打开工程")
            source = Path(source)
        else:
            source = None
        trusted = {}
        asset_map = {a["id"]: a for a in project.get("msw", {}).get("assets", [])}
        for asset_id in {p["asset_id"] for p in plan["pieces"]}:
            asset, origin = self.api.asset_reference(project_id, asset_id)
            requested = asset_map[asset_id]
            if not asset or any(asset.get(k) != requested[k] for k in ("sha256", "sample_rate", "channels", "sample_count", "byte_size")):
                raise ValueError("贴片素材尚未由本机接管或音频属性已变化，请重新打开工程")
            trusted[asset_id] = copy.deepcopy(asset), origin
        source_stamp = fingerprint(source) if source else None
        with self.lock:
            # Recheck after work outside the lock (concurrent HTTP submissions).
            row = self.db.execute("SELECT payload FROM jobs WHERE project_id=? AND request_key=?", (project_id, request_key)).fetchone()
            if row:
                job = json.loads(row[0])
                if job["fingerprint"] != signature:
                    raise ValueError("相同导出请求不能提交不同快照")
                return self.public(job)
            if self.closed or len(self.events) >= 3:
                raise ValueError("已有较多音频导出任务，请等待或取消后重试")
            self.prune()
            job = dict(id=uuid.uuid4().hex, project_id=project_id, request_key=request_key, fingerprint=signature,
                       client_token=payload["client_token"], plan_schema=VERSION, mode=settings["mode"], format=settings["format"],
                       status="queued", stage="queued", progress=0, created_at=time.time(), error="", result=None,
                       options=settings, clip_count=len({p["clip_id"] for p in plan["pieces"]}))
            event = threading.Event()
            self.events[job["id"]] = event
            self.write(job)
            self.pending.put((job["id"], project_id, project, settings, tools, trusted, source, source_stamp, event))
            return self.public(job)

    def prune(self):
        # Only generated output files belonging to retained job records; never
        # source media or project assets. Keep the newest result even above 2 GB.
        rows = self.db.execute("SELECT payload FROM jobs ORDER BY rowid DESC").fetchall()
        protected = {entry[1] for entry in self.downloads.values() if entry[0] > time.monotonic()}
        used, kept = 0, 0
        for (body,) in rows:
            job = json.loads(body)
            if job["status"] not in TERMINAL or job["id"] in protected:
                continue
            path = self.artifact(job)
            size = path.stat().st_size if path.is_file() else 0
            if kept >= 19 or (kept > 0 and used + size > 2 * 1024**3):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    continue  # A download may still own the file on Windows.
                with self.db:
                    self.db.execute("DELETE FROM jobs WHERE id=?", (job["id"],))
            else:
                kept, used = kept + 1, used + size

    def artifact(self, job):
        # Job IDs are generated UUID hex, never a user supplied path.
        if len(job["id"]) != 32 or any(c not in "0123456789abcdef" for c in job["id"]):
            raise ValueError("导出任务标识无效")
        suffix = {"wav": ".wav", "mp4": ".mp4", "otioz": ".otioz"}[job.get("format", "wav")]
        return self.root / (job["id"] + suffix)

    def cancel(self, job_id, project_id):
        with self.lock:
            job = self.get(job_id, project_id)
            if job["status"] not in TERMINAL:
                self.events[job_id].set()
                job["status"] = "cancel_requested"
                self.write(job)
            return self.public(job)

    def ticket(self, job_id, project_id):
        with self.lock:
            job = self.get(job_id, project_id)
            if job["status"] != "succeeded" or not self.artifact(job).is_file():
                raise ValueError("导出文件不可用，请重新导出")
            self.downloads = {k: v for k, v in self.downloads.items() if v[0] > time.monotonic()}
            if len(self.downloads) >= 32:
                self.downloads.pop(next(iter(self.downloads)))
            ticket = secrets.token_urlsafe(32)
            self.downloads[ticket] = (time.monotonic() + 300, job_id, project_id)
            return ticket

    def download(self, ticket):
        with self.lock:
            entry = self.downloads.pop(ticket, None)
            if not entry or entry[0] <= time.monotonic():
                raise PermissionError("下载链接已失效，请再次点击下载 WAV")
            job = self.get(entry[1], entry[2])
            name = "msw-video.mp4" if job.get("format") == "mp4" else "msw-voice.wav" if job["mode"] == "voice" else "msw-mix.wav"
            if job.get("format") == "otioz":
                name = "msw-timeline.otioz"
            return self.artifact(job).open("rb"), name

    def work(self):
        while item := self.pending.get():
            job_id, project_id, project, settings, tools, trusted, source, stamp, event = item
            try:
                check_cancel(event)
                with self.lock:
                    job = self.get(job_id, project_id)
                    job.update(status="running", stage="preparing")
                    self.write(job)
                source_channels = 0
                info = {}
                if source:
                    if fingerprint(source) != stamp:
                        raise ValueError("原媒体在排队期间发生变化，请重新导出")
                    info = probe_source(tools.ffprobe, source, event)
                    if settings["mode"] == "mix" and settings["source_audio_index"] >= len(info["audio_tracks"]):
                        raise ValueError("所选原声音轨不存在，请重新选择音轨")
                    if settings["mode"] == "mix":
                        source_channels = info["audio_tracks"][settings["source_audio_index"]]["channels"]
                    settings = {**settings, "duration_ms": max(settings["duration_ms"], info["duration_ms"])}
                plan = prepare_video(project, settings, info) if settings["format"] == "mp4" else compile_plan(project, settings)
                resolved = {}

                def resolve(asset_id):
                    if asset_id not in resolved:
                        check_cancel(event)
                        asset, origin = trusted[asset_id]
                        try:
                            resolved[asset_id] = asset, self.api.assets.resolve(project_id, asset, origin)
                        except FileNotFoundError as error:
                            raise ValueError("音频素材缺失或内容已变化，请恢复工程旁的 .assets 文件夹后重新导出") from error
                    return resolved[asset_id]

                for asset_id in trusted:
                    resolve(asset_id)  # Fail missing used assets before rendering.

                def progress(stage, fraction):
                    check_cancel(event)
                    with self.lock:
                        current = self.get(job_id, project_id)
                        current.update(stage=stage, progress=round(fraction * 100, 1))
                        self.write(current)

                if settings["format"] == "mp4":
                    result = render_video(plan, self.artifact(job), tools, event, progress, resolve,
                                          source=source, source_channels=source_channels, info=info, settings=settings, project=project)
                elif settings["format"] == "otioz":
                    result = render_bundle(project, plan, self.artifact(job), tools, event, progress, resolve,
                                           source=source, source_channels=source_channels, info=info, settings=settings)
                else:
                    result = self.renderer(plan, self.artifact(job), tools.ffmpeg, event, progress, resolve,
                                           source=source, source_channels=source_channels)
                with self.lock:
                    check_cancel(event)
                    job = self.get(job_id, project_id)
                    job.update(status="succeeded", stage="done", progress=100, result=result)
                    self.write(job)
            except Exception as error:
                with self.lock:
                    job = self.get(job_id, project_id)
                    if job["status"] != "interrupted":
                        cancelled = event.is_set() or isinstance(error, RenderCancelled)
                        job.update(status="cancelled" if cancelled else "failed",
                                   error="" if cancelled else str(error) if isinstance(error, (ValueError, FileNotFoundError)) and not isinstance(error, OSError)
                                   else "音频导出失败，请检查素材完整性及临时目录空间")
                        self.write(job)
                    self.artifact(job).unlink(missing_ok=True)
            finally:
                with self.lock:
                    self.events.pop(job_id, None)
                self.pending.task_done()
        with self.lock:
            self.db.close()
        self.close_complete.set()

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            for job_id, event in self.events.items():
                event.set()
                row = self.db.execute("SELECT project_id FROM jobs WHERE id=?", (job_id,)).fetchone()
                job = self.get(job_id, row[0])
                job.update(status="interrupted", error="编辑器服务已关闭，请重新导出")
                self.write(job)
            self.pending.put(None)
