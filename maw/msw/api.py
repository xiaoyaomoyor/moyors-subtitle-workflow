"""Thin localhost adapter for editor jobs, configuration and guarded saves."""

from __future__ import annotations

import hashlib
import secrets
import threading
import uuid
from hmac import compare_digest
from http import HTTPStatus
from urllib.parse import parse_qs, urlsplit

from maw.msw.config import provider_payloads, resolve_settings, save_settings
from maw.msw.jobs import JobManager
from maw.msw.project_codec import valid_id
from maw.msw.assets import AssetStore
from maw.msw import tts


class ProcessingAPI:
    def __init__(self, server, env_path, data_root):
        self.server = server
        self.env_path = env_path
        self.data_root = data_root
        self.lock = threading.RLock()
        self._manager = None
        self._assets = None
        self._persistence = None
        self._exports = None
        self._yukkuri = None
        self._importer = None
        self._qwen_voices = None
        self._index_tts = None
        self._project_path = object()
        self.binding = ""
        self._preview_lock = threading.Lock()
        self._preview_cancel = threading.Event()

    @property
    def jobs(self):
        with self.lock:
            if self._manager is None:
                port = self.server.server_address[1]
                self._manager = JobManager(self.data_root / "editor-jobs" / f"port-{port}.sqlite3",
                                           tts=tts.TtsService(self.assets))
            return self._manager

    @property
    def persistence(self):
        from maw.msw.persistence import ProjectPersistence
        with self.lock:
            if self._persistence is None:
                self._persistence = ProjectPersistence(self)
            return self._persistence

    @property
    def exports(self):
        from maw.msw.audio_exports import AudioExports
        with self.lock:
            if self._exports is None:
                self._exports = AudioExports(self)
            return self._exports

    @property
    def qwen_voices(self):
        from maw.msw.qwen_voices import QwenVoices
        with self.lock:
            if self._qwen_voices is None:
                self._qwen_voices = QwenVoices(self.data_root / 'qwen-voices', self.server.server_address[1], lambda: self.exports.tools())
            return self._qwen_voices

    @property
    def index_tts(self):
        from maw.msw.index_tts import IndexTts
        with self.lock:
            if self._index_tts is None:
                self._index_tts = IndexTts(self.data_root, self.importer.convert)
            return self._index_tts

    def tts_engine(self, engine=None):
        import json
        from maw.msw.assets import atomic_bytes
        path = self.data_root / 'tts-engine.json'
        if engine is not None:
            if engine not in {'qwen', 'yukkuri', 'indextts'}:
                raise ValueError('不支持的 TTS 引擎')
            atomic_bytes(path, (json.dumps({'engine': engine}) + '\n').encode())
            return engine
        try:
            value = json.loads(path.read_text(encoding='utf-8')).get('engine')
            if value in {'qwen', 'yukkuri', 'indextts'}:
                return value
        except (OSError, ValueError, AttributeError):
            pass
        return self.yukkuri.payload()['engine']

    @property
    def importer(self):
        from maw.msw.audio_import import AudioImporter
        with self.lock:
            if self._importer is None:
                self._importer = AudioImporter(self)
            return self._importer

    @property
    def yukkuri(self):
        from maw.msw.yukkuri_runtime import RuntimeController
        with self.lock:
            if self._yukkuri is None:
                self._yukkuri = RuntimeController(self.data_root)
            return self._yukkuri

    @property
    def assets(self):
        with self.lock:
            if self._assets is None:
                self._assets = AssetStore(self.data_root / "editor-assets")
            return self._assets

    def asset_reference(self, project_id, asset_id):
        staged = self.assets.get(project_id, asset_id)
        with self.server.save_lock:
            extension = self.server.project.data.get("msw") or {}
            bound = extension.get("project_id") == project_id
            asset = next((item for item in extension.get("assets", []) if item["id"] == asset_id), None) if bound else None
            if asset:
                return asset, self.server.project.json_path
            recovered = self._persistence.recovered.get(project_id) if self._persistence else None
            if recovered:
                asset = next((item for item in recovered["project"].get("msw", {}).get("assets", []) if item["id"] == asset_id), None)
                if asset:
                    return asset, recovered["origin"]
            return staged, None

    def send_bundle(self, handler, payload):
        import json
        import shutil
        import tempfile
        import zipfile
        from maw.project import normalize_project
        project = normalize_project(payload.get("project"))
        extension = project.get("msw") or {}
        project_id = extension.get("project_id")
        if project_id != payload.get("project_id"):
            raise ValueError("工程与素材不匹配")
        with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024) as stream:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as archive:
                for asset in extension.get("assets", []):
                    trusted, project_path = self.asset_reference(project_id, asset["id"])
                    if not trusted or trusted["sha256"] != asset["sha256"]:
                        raise ValueError("素材尚未被本机服务接管，请在本机服务重新打开工程")
                    path = self.assets.resolve(project_id, trusted, project_path)
                    archive.write(path, asset["path"])
                archive.writestr("project.mosp", json.dumps(project, ensure_ascii=False, indent=2) + "\n")
            size = stream.tell()
            stream.seek(0)
            handler.send_response(HTTPStatus.OK)
            handler.send_header("Content-Type", "application/zip")
            handler.send_header("Content-Disposition", 'attachment; filename="project-with-audio.zip"')
            handler.send_header("Content-Length", str(size))
            handler.send_header("Cache-Control", "no-store")
            handler.end_headers()
            shutil.copyfileobj(stream, handler.wfile)

    def context(self):
        path = self.server.project.json_path
        key = str(path.resolve()) if path else ""
        with self.lock:
            if key != self._project_path:
                self._project_path = key
                self.binding = secrets.token_urlsafe(24)
            project_id = (self.server.project.data.get("msw") or {}).get("project_id")
            if not valid_id(project_id):
                project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, key or self.server.request_token))
            revision = hashlib.sha256(path.read_bytes()).hexdigest() if path and path.is_file() else None
            return {"projectId": project_id, "binding": self.binding, "saveRevision": revision}

    def invalidate_binding(self):
        with self.lock:
            self._project_path = object()

    def check_save(self, binding, revision):
        current = self.context()
        if binding != current["binding"] or revision != current["saveRevision"]:
            raise ValueError("工程绑定或磁盘内容已变化；未覆盖保存，请另存为或重新打开工程。")

    def authorize(self, handler, *, require_token=True):
        token = handler.headers.get("X-MSW-Token", "")
        if require_token and (not token or not compare_digest(token, self.server.request_token)):
            raise PermissionError("请求令牌无效，请重新打开编辑器")
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if handler.headers.get("Host") not in hosts:
            raise PermissionError("请求主机无效")
        origin = handler.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in hosts}:
            raise PermissionError("不允许跨站访问本机处理服务")
        if handler.headers.get("Sec-Fetch-Site") == "cross-site":
            raise PermissionError("不允许跨站访问本机处理服务")

    def handle(self, handler, *, post=False):
        url = urlsplit(handler.path)
        if not url.path.startswith("/api/msw/"):
            return False
        status = HTTPStatus.OK
        try:
            if url.path == "/api/msw/audio-download" and not post:
                # A short-lived, single-use file grant allows native streaming
                # downloads without placing the editor request token in a URL.
                self.authorize(handler, require_token=False)
                if handler.command != "GET":
                    raise ValueError("下载需要 GET 请求")
                ticket = parse_qs(url.query).get("ticket", [""])[0]
                stream, name = self.exports.download(ticket)
                import os
                import shutil
                with stream:
                    handler.send_response(HTTPStatus.OK)
                    handler.send_header("Content-Type", "application/zip" if name.endswith(".otioz") else "video/mp4" if name.endswith(".mp4") else "audio/wav")
                    handler.send_header("Content-Disposition", f'attachment; filename="{name}"')
                    handler.send_header("Content-Length", str(os.fstat(stream.fileno()).st_size))
                    handler.send_header("Cache-Control", "no-store")
                    handler.send_header("Referrer-Policy", "no-referrer")
                    handler.end_headers()
                    try:
                        shutil.copyfileobj(stream, handler.wfile, length=256 * 1024)
                    except (BrokenPipeError, ConnectionResetError):
                        pass  # A cancelled download must not receive JSON in its WAV response.
                return True
            self.authorize(handler)
            route = url.path[len("/api/msw/"):]
            if post:
                if handler.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("需要 JSON 请求")
                length = int(handler.headers.get("Content-Length", "0"))
                limit = 64 * 1024 * 1024 if route in {"project", "save-as", "asset-bundle", "recovery-draft", "audio-exports", "asset-import", "qwen-voices", "index-tts"} else 4 * 1024 * 1024
                if not 0 < length <= limit:
                    raise ValueError("请求为空或超过大小限制")
                payload = handler.read_json_request()
            else:
                payload = {key: values[0] for key, values in parse_qs(url.query).items()}
            if route == "capabilities" and not post:
                result = {"translation": True, "tts": True, "assets": True, "audioExport": True, "videoExport": True, "timelineExport": True, "persistentJobs": True, "projectPersistence": True, **self.context()}
            elif route == "save-target" and post:
                result = self.persistence.choose_target(payload)
            elif route == "save-as" and post:
                result = self.persistence.save_as(payload, self.server.write_project)
            elif route == "project-health" and not post:
                result = {"assets": self.persistence.health(), **self.context()}
            elif route == "recovery-draft" and post:
                result = self.persistence.draft(payload)
            elif route == "recovery-list" and not post:
                result = {"records": self.persistence.recovery.list()}
            elif route == "recovery-load" and post:
                result = self.persistence.restore(payload.get("id"))
            elif route in {'tts-settings', 'tts-environment'}:
                with self.lock:
                    if post:
                        engine = (payload.get('recipe') or {}).get('provider', 'qwen')
                        if engine == 'indextts':
                            self.index_tts.save(payload)
                        elif engine == 'yukkuri':
                            self.yukkuri.save(engine='yukkuri' if route == 'tts-settings' else self.yukkuri.payload()['engine'], recipe=payload["recipe"])
                        else:
                            tts.save_settings(self.env_path, payload)
                            if route == 'tts-settings':
                                self.yukkuri.save(engine="qwen")
                        if route == 'tts-settings':
                            self.tts_engine(engine)
                    result = {**tts.config_payload(self.env_path), "yukkuri": self.yukkuri.payload(),
                              "engine": self.tts_engine(), 'index_tts': self.index_tts.payload(), 'workspace_version': 2}
            elif route == 'index-tts':
                result = self.index_tts.action(payload) if post else self.index_tts.payload()
            elif route == 'index-reference' and not post:
                identity = payload.get('id')
                self.index_tts.reference(identity)
                handler.send_file(self.index_tts.root / 'references' / (identity + '.wav'), handler.command != 'HEAD')
                return True
            elif route == 'qwen-voices' and post:
                settings = tts.resolve_settings(self.env_path, payload.get('provider', {}), require_voice=False)
                if payload.get('action') == 'create':
                    result = {'operation': self.qwen_voices.start(payload, settings)}
                    status = HTTPStatus.ACCEPTED
                elif payload.get('action') == 'list':
                    result = self.qwen_voices.catalog(settings)
                elif payload.get('action') in {'register', 'rename'}:
                    result = self.qwen_voices.manage(payload, settings)
                else:
                    raise ValueError('未知音色操作')
            elif route.startswith('qwen-voice-jobs/') and not post:
                parts = route.split('/')
                if len(parts) == 3 and parts[2] == 'preview':
                    handler.send_file(self.qwen_voices.preview(parts[1]), handler.command != 'HEAD')
                    return True
                if len(parts) != 2:
                    raise KeyError('未知音色任务')
                result = {'operation': self.qwen_voices.get(parts[1])}
            elif route == "yukkuri-runtime":
                result = {"runtime": self.yukkuri.start(payload.get("action"), payload.get("directory", ""))
                          if post else self.yukkuri.payload()}
            elif route == 'yukkuri-preview' and post:
                from maw.msw.yukkuri import resolve_settings as local_settings, synthesize
                if not self._preview_lock.acquire(blocking=False):
                    raise ValueError('油库里试听正在生成，请稍后重试')
                try:
                    settings = local_settings(self.yukkuri, payload)
                    sample = 'Hello, welcome to our story.' if settings.recipe['language_type'] == 'English' else '你好，欢迎使用字幕配音。'
                    audio, _ = synthesize(settings, sample, self._preview_cancel)
                finally:
                    self._preview_lock.release()
                handler.send_response(HTTPStatus.OK)
                handler.send_header('Content-Type', 'audio/wav')
                handler.send_header('Content-Length', str(len(audio)))
                handler.send_header('Cache-Control', 'no-store')
                handler.end_headers()
                try:
                    handler.wfile.write(audio)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return True
            elif route == "providers":
                with self.lock:
                    result = save_settings(self.env_path, payload) if post else provider_payloads(self.env_path)
            elif route == "project" and post:
                if not isinstance(payload.get("binding"), str) or not isinstance(payload.get("saveRevision"), str):
                    raise ValueError("缺少工程保存版本，请重新打开编辑器")
                try:
                    target, backup, context = self.server.save_project(
                        payload.get("project"), payload.get("filename"),
                        expected_binding=payload["binding"], expected_revision=payload["saveRevision"],
                        include_context=True,
                    )
                except ValueError as error:
                    status = HTTPStatus.CONFLICT
                    raise ValueError(str(error)) from error
                result = {"filename": target.name, "backup": backup.name if backup else None, **context}
            else:
                project_id = payload.get("project_id")
                if not valid_id(project_id):
                    raise ValueError("缺少有效工程标识")
                if route == "asset-bundle" and post:
                    self.send_bundle(handler, payload)
                    return True
                if route in {"audio-export-context", "video-export-context", "timeline-export-context"} and not post:
                    result = self.exports.context(project_id, video=route != "audio-export-context")
                elif route == "audio-exports" and post:
                    result = {"job": self.exports.submit(payload)}
                    status = HTTPStatus.ACCEPTED
                elif route == "audio-exports" and not post:
                    result = {"jobs": self.exports.list(project_id)}
                elif route.startswith("audio-exports/") and post:
                    parts = route.split("/")
                    if len(parts) != 3 or not valid_id(parts[1]):
                        raise KeyError("未知导出操作")
                    if parts[2] == "cancel":
                        result = {"job": self.exports.cancel(parts[1], project_id)}
                    elif parts[2] == "download":
                        result = {"url": "/api/msw/audio-download?ticket=" + self.exports.ticket(parts[1], project_id)}
                    else:
                        raise KeyError("未知导出操作")
                elif route == "assets" and not post:
                    result = self.assets.list(project_id, max(0, int(payload.get("since", 0))))
                elif route == "asset-import" and post:
                    result = {"asset": self.importer.import_audio(payload)}
                elif route == "asset-audio" and not post:
                    asset, project_path = self.asset_reference(project_id, payload.get("asset_id"))
                    if asset is None:
                        raise KeyError("素材不存在")
                    path = self.assets.resolve(project_id, asset, project_path)
                    handler.send_file(path, handler.command != "HEAD")
                    return True
                elif route == "jobs" and post:
                    provider = payload.get("provider", {})
                    if not isinstance(provider, dict):
                        raise ValueError("翻译服务配置无效")
                    if payload.get("kind") == "tts" and isinstance(provider.get("recipe"), dict) and provider["recipe"].get("provider") == "yukkuri":
                        from maw.msw.yukkuri import resolve_settings as resolve_local_tts
                        settings = resolve_local_tts(self.yukkuri, provider)
                    elif payload.get('kind') == 'tts' and isinstance(provider.get('recipe'), dict) and provider['recipe'].get('provider') == 'indextts':
                        settings = self.index_tts.resolve(provider)
                    else:
                        settings = tts.resolve_settings(self.env_path, provider) if payload.get("kind") == "tts" else resolve_settings(self.env_path, provider)
                        if payload.get('kind') == 'tts' and settings.recipe.get('model_type') != 'CustomVoice':
                            self.qwen_voices.validate_voice(settings)
                    result = {"job": self.jobs.submit(payload, settings)}
                    status = HTTPStatus.ACCEPTED
                elif route == "jobs" and not post:
                    since = max(0, int(payload.get("since", 0)))
                    result = self.jobs.list(project_id, since)
                else:
                    parts = route.split("/")
                    if len(parts) != 3 or parts[0] != "jobs" or not valid_id(parts[1]):
                        raise KeyError("未知处理接口")
                    job_id, action = parts[1:]
                    if action == "result" and not post:
                        result = {"job": self.jobs.get(job_id, project_id)}
                    elif action == "cancel" and post:
                        result = {"job": self.jobs.cancel(job_id, project_id)}
                    elif action == "ack" and post:
                        result = {"job": self.jobs.acknowledge(job_id, project_id, payload.get("application"))}
                    else:
                        raise KeyError("未知任务操作")
            handler.send_json(status, {"ok": True, **result})
        except PermissionError as error:
            handler.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": str(error)})
        except KeyError:
            handler.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "任务或接口不存在"})
        except FileNotFoundError as error:
            handler.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": str(error)})
        except (ValueError, TypeError, UnicodeError) as error:
            handler.send_json(status if status == HTTPStatus.CONFLICT else HTTPStatus.BAD_REQUEST,
                              {"ok": False, "error": str(error)})
        except Exception:
            # Do not send arbitrary transport/configuration exception strings:
            # they can contain secrets or internal paths.
            handler.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "本机处理服务暂时不可用，请重试"})
        return True

    def close(self):
        self._preview_cancel.set()
        if self._index_tts:
            self._index_tts.close()
        if self._qwen_voices:
            self._qwen_voices.close()
        if self._importer:
            self._importer.close()
        if self._yukkuri:
            self._yukkuri.close()
        if self._exports:
            self._exports.close()
        if self._manager:
            self._manager.close()
