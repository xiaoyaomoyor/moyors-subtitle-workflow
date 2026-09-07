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


class ProcessingAPI:
    def __init__(self, server, env_path, data_root):
        self.server = server
        self.env_path = env_path
        self.data_root = data_root
        self.lock = threading.RLock()
        self._manager = None
        self._project_path = object()
        self.binding = ""

    @property
    def jobs(self):
        with self.lock:
            if self._manager is None:
                port = self.server.server_address[1]
                self._manager = JobManager(self.data_root / "editor-jobs" / f"port-{port}.sqlite3")
            return self._manager

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

    def authorize(self, handler):
        token = handler.headers.get("X-MSW-Token", "")
        if not token or not compare_digest(token, self.server.request_token):
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
            self.authorize(handler)
            route = url.path[len("/api/msw/"):]
            if post:
                if handler.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("需要 JSON 请求")
                length = int(handler.headers.get("Content-Length", "0"))
                limit = 64 * 1024 * 1024 if route == "project" else 4 * 1024 * 1024
                if not 0 < length <= limit:
                    raise ValueError("请求为空或超过大小限制")
                payload = handler.read_json_request()
            else:
                payload = {key: values[0] for key, values in parse_qs(url.query).items()}
            if route == "capabilities" and not post:
                result = {"translation": True, "persistentJobs": True, **self.context()}
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
                if route == "jobs" and post:
                    provider = payload.get("provider", {})
                    if not isinstance(provider, dict):
                        raise ValueError("翻译服务配置无效")
                    settings = resolve_settings(self.env_path, provider)
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
        except (ValueError, TypeError, UnicodeError) as error:
            handler.send_json(status if status == HTTPStatus.CONFLICT else HTTPStatus.BAD_REQUEST,
                              {"ok": False, "error": str(error)})
        except Exception:
            # Do not send arbitrary transport/configuration exception strings:
            # they can contain secrets or internal paths.
            handler.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "本机处理服务暂时不可用，请重试"})
        return True

    def close(self):
        if self._manager:
            self._manager.close()
