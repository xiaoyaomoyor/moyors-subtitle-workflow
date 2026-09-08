"""Project save targets and collection; clients never choose writable paths."""

import copy
from dataclasses import replace
import hashlib
import os
from pathlib import Path
import secrets
import threading
import time
import uuid

from maw.msw.assets import asset_relative_path, confined_path
from maw.msw.dialogs import pick_project_target
from maw.msw.project_codec import valid_id
from maw.msw.recovery import RecoveryStore
from maw.project import normalize_project


def fingerprint(path):
    if not path or not Path(path).is_file():
        return None
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_media(source, root, relative_directory):
    """Stream the registered source; never accept an input path from the browser."""
    source = Path(source)
    signature = fingerprint(source)
    if not signature:
        raise ValueError("原媒体文件缺失，未完成素材收集")
    relative = f"{relative_directory}/{signature[:24]}{source.suffix.lower()}"
    destination = confined_path(root, relative)
    if destination == source.resolve():
        return relative
    if destination.exists():
        if fingerprint(destination) != signature:
            raise ValueError("目标目录有内容不同的同名媒体，未覆盖")
        return relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.pending")
    digest = hashlib.sha256()
    with source.open("rb") as inp, pending.open("xb") as out:
        for chunk in iter(lambda: inp.read(1024 * 1024), b""):
            digest.update(chunk)
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())
    if digest.hexdigest() != signature:
        raise ValueError("收集时原媒体发生变化，未发布不完整副本")
    os.replace(pending, destination)
    return relative


class ProjectPersistence:
    def __init__(self, api):
        self.api = api
        self.targets = {}
        self.target_lock = threading.Lock()
        self.picker = pick_project_target
        self._recovery = None
        self.recovered = {}
        self.recovery_warning = None

    @property
    def recovery(self):
        with self.api.lock:
            if self._recovery is None:
                self._recovery = RecoveryStore(self.api.data_root)
            return self._recovery

    def draft(self, payload):
        if not valid_id(payload.get("session")):
            raise ValueError("恢复会话标识无效")
        project = normalize_project(copy.deepcopy(payload.get("project")))
        with self.api.server.save_lock:
            if payload.get("binding") != self.api.context()["binding"]:
                raise ValueError("工程已切换，未更新恢复草稿")
            bound = self.api.server.project
            project_id = (project.get("msw") or {}).get("project_id")
            same = project_id == self.api.context()["projectId"] and payload.get("recovery") is not True
            recovered = self.recovered.get(project_id, {}) if not same else {}
            origin = bound.json_path if same else recovered.get("origin")
            media = ((bound.source_media_path or bound.media_path) if same and project.get("media") == bound.data.get("media")
                     else recovered.get("media") if project.get("media") == recovered.get("project", {}).get("media") else None)
            return {"id": self.recovery.put(project, kind="draft", name=str(payload.get("filename") or "untitled.mosp"),
                        origin=origin, media=media, session=payload["session"])}

    def restore(self, record_id):
        record = self.recovery.get(record_id)
        project = record["project"]
        extension = project.setdefault("msw", {"schema": "msw.editor.v1", "project_id": "project-" + uuid.uuid4().hex})
        with self.api.server.save_lock:
            self.recovered[extension["project_id"]] = record
            while len(self.recovered) > 16:
                self.recovered.pop(next(iter(self.recovered)))
        return {"project": project, "filename": record["name"]}

    def choose_target(self, payload):
        context = self.api.context()
        if payload.get("binding") != context["binding"]:
            raise ValueError("工程已切换，请重新选择保存位置")
        if not self.target_lock.acquire(blocking=False):
            raise ValueError("保存对话框已经打开")
        try:
            path = self.picker(payload.get("filename", "untitled.mosp"))
            if path is None:
                return {"cancelled": True}
            path = Path(path).resolve()
            if path.suffix.lower() not in {".mosp", ".json"} or not path.parent.is_dir():
                raise ValueError("请选择现存目录中的 .mosp 或 .json 工程文件")
            if self.api.context()["binding"] != context["binding"]:
                raise ValueError("选择位置时工程已切换，请重试")
            token = secrets.token_urlsafe(32)
            now = time.monotonic()
            self.targets = {key: value for key, value in self.targets.items() if value["expires"] > now}
            if len(self.targets) >= 16:
                raise ValueError("待保存目标过多，请完成现有保存")
            self.targets[token] = {"path": path, "revision": fingerprint(path),
                                   "binding": context["binding"], "expires": now + 600}
            return {"target": token, "filename": path.name, "directory": str(path.parent), "cancelled": False}
        finally:
            self.target_lock.release()

    def save_as(self, payload, write_project):
        with self.target_lock:
            target_info = self.targets.pop(payload.get("target"), None)
        if not target_info or target_info["expires"] < time.monotonic():
            raise ValueError("保存位置已失效，请重新选择")
        if payload.get("binding") != target_info["binding"]:
            raise ValueError("保存位置不属于当前工程窗口")
        collect = payload.get("collectMedia", False)
        if not isinstance(collect, bool):
            raise ValueError("收集原媒体必须是开关值")
        project = normalize_project(copy.deepcopy(payload.get("project")))
        source_id = (project.get("msw") or {}).get("project_id")
        trusted_sources = {}
        source_extension = project.get("msw") or {}
        if source_extension.get("source_project_id"):
            self.api.assets.adopt(source_id, source_extension.get("assets", []), source_extension["source_project_id"])
        for asset in (project.get("msw") or {}).get("assets", []):
            trusted, source_path = self.api.asset_reference(source_id, asset["id"])
            if not trusted or trusted["sha256"] != asset["sha256"]:
                raise ValueError("素材未被本机服务接管，请用服务器重新打开工程")
            trusted_sources[asset["id"]] = source_path
        server = self.api.server
        if not server.save_lock.acquire(blocking=False):
            raise ValueError("另一个工程保存正在进行")
        try:
            if self.api.context()["binding"] != target_info["binding"]:
                raise ValueError("工程已切换，未写入新文件")
            target = target_info["path"]
            if fingerprint(target) != target_info["revision"]:
                raise ValueError("选择位置后目标文件发生变化，未覆盖")
            old = server.project
            if old.json_path and target == old.json_path.resolve():
                raise ValueError("另存为请选择不同文件；保存当前文件请使用保存工程")
            new_id = "project-" + uuid.uuid4().hex
            extension = project.setdefault("msw", {"schema": "msw.editor.v1"})
            extension.update(project_id=new_id, source_project_id=source_id, applied_results=[])
            extension.pop("translation_applications", None)
            extension.pop("translation_target_tracks", None)
            # Keep asset IDs and paths immutable. Only the project identity forks.
            # Resolve using the source identity before committing the new one.
            report = {"total": 0, "available": 0, "copied": 0, "missing": []}
            for asset in extension.get("assets", []):
                original_extension = {**extension, "project_id": source_id, "assets": [asset]}
                one = self.api.assets.persist_project({"msw": original_extension}, target, trusted_sources[asset["id"]])
                for key in ("total", "available", "copied"):
                    report[key] += one[key]
                report["missing"].extend(one["missing"])
            recovered = self.recovered.get(source_id, {})
            recovering = bool(recovered) and payload.get("recovery") is True
            bound_source = source_id == self.api.context()["projectId"]
            media_source = recovered.get("media") if recovering else (old.source_media_path or old.media_path) if bound_source else None
            media_owner = recovered.get("project", {}) if recovering else old.data
            origin_path = recovered.get("origin") if recovering else old.json_path if bound_source else None
            original_reference = project.get("media")
            if collect:
                if not media_source or original_reference != media_owner.get("media"):
                    raise ValueError("当前原媒体尚未由服务器接管，请从本机服务器重新打开含媒体的工程")
                directory = asset_relative_path(new_id, "unused").split("/audio/")[0] + "/media"
                project["media"] = collect_media(media_source, target.parent, directory)
            elif isinstance(original_reference, str) and original_reference and origin_path:
                candidate = Path(original_reference)
                if not candidate.is_absolute():
                    project["media"] = str((origin_path.parent / candidate).resolve())
            normalized = normalize_project(project)
            self.api.assets.adopt(new_id, extension.get("assets", []), source_id)
            saved_media = (target.parent / normalized["media"]) if collect else (media_source if original_reference == media_owner.get("media") else None)
            backup = write_project(target, normalized, media_source=saved_media)
            same_media = not recovering and bound_source and original_reference == old.data.get("media")
            server.project = replace(old, data=normalized, json_path=target,
                                     media_path=old.media_path if same_media and original_reference else None,
                                     source_media_path=(target.parent / normalized["media"]) if collect else (media_source if original_reference == media_owner.get("media") else None))
            self.api.invalidate_binding()
            server.remember_project(target)
            return {"project": normalized, "filename": target.name,
                    "backup": backup.name if backup else None,
                    "assets": report, "recoveryWarning": self.recovery_warning, **self.api.context()}
        finally:
            server.save_lock.release()

    def health(self):
        server = self.api.server
        with server.save_lock:
            project = copy.deepcopy(server.project.data)
            path = server.project.json_path
        extension = project.get("msw") or {}
        missing, staged_only = [], []
        for asset in extension.get("assets", []):
            try:
                resolved = self.api.assets.resolve(extension["project_id"], asset, path)
                if not path or resolved != confined_path(path.parent, asset["path"]):
                    staged_only.append(asset["id"])
            except FileNotFoundError:
                missing.append(asset["id"])
        total = len(extension.get("assets", []))
        return {"total": total, "available": total - len(missing), "missing": missing, "stagedOnly": staged_only}
