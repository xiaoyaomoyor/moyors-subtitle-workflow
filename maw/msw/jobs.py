"""Bounded background editor jobs with durable snapshots and no stored secrets."""

from __future__ import annotations

import copy
import hashlib
import json
import queue
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from maw.msw.project_codec import valid_cue_id, valid_id
from maw.postprocess import LlmPostprocessRequest, OutputMode, process_llm_snapshot
from maw.postprocess_llm import LlmSettings, complete_subtitle_groups, test_llm_connection
from maw.project import normalize_project

TERMINAL = frozenset({"succeeded", "failed", "cancelled", "interrupted"})


class JobCancelled(Exception):
    pass


def validate_snapshot(raw: object) -> dict:
    if not isinstance(raw, dict) or not valid_id(raw.get("project_id")):
        raise ValueError("翻译任务缺少有效工程标识")
    entries = raw.get("entries")
    if not isinstance(entries, list) or not 1 <= len(entries) <= 10000:
        raise ValueError("请选择 1–10000 条可翻译主字幕")
    track_id = raw.get("track_id")
    if track_id is not None and not valid_cue_id(track_id):
        raise ValueError("副字幕轨标识无效")
    clean = []
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("source"), dict):
            raise ValueError("翻译来源格式无效")
        source = entry["source"]
        if not valid_cue_id(source.get("id")) or source["id"] in seen:
            raise ValueError("主字幕标识无效或重复")
        seen.add(source["id"])
        if not isinstance(source.get("text"), str) or not source["text"].strip() or len(source["text"]) > 20000:
            raise ValueError("翻译文本不能为空或超过长度限制")
        target = entry.get("target")
        if target is not None:
            if not isinstance(target, dict) or not valid_cue_id(target.get("id")) or not isinstance(target.get("text"), str):
                raise ValueError("副字幕目标格式无效")
            target = {key: copy.deepcopy(target[key]) for key in ("id", "start", "end", "text", "items", "disabled") if key in target}
        binding_id = entry.get("binding_id")
        if binding_id is not None and not valid_cue_id(binding_id):
            raise ValueError("字幕绑定标识无效")
        clean.append({
            "source": {key: source[key] for key in ("id", "start", "end", "text", "disabled") if key in source},
            "target": target, "binding_id": binding_id,
        })
    # Validate source times without allowing user-supplied fields into the task.
    normalize_project({"segments": [entry["source"] for entry in clean]})
    if sum(len(entry["source"]["text"]) for entry in clean) > 1000000:
        raise ValueError("单次翻译文本过长，请分批选择字幕")
    return {"project_id": raw["project_id"], "track_id": track_id, "entries": clean}


def translate_snapshot(snapshot: dict, language: str, prompt: str, settings: LlmSettings,
                       cancel: threading.Event, progress) -> dict:
    def check():
        if cancel.is_set():
            raise JobCancelled()

    def complete(system_prompt, cues):
        check()
        result = complete_subtitle_groups(settings, system_prompt, cues)
        check()
        return result

    def on_status(stage, details):
        check()
        progress(stage, dict(details))

    request = LlmPostprocessRequest(None, None, OutputMode.JSON, f"translate_{language}", prompt)
    result = process_llm_snapshot(
        {"segments": [entry["source"] for entry in snapshot["entries"]]}, request,
        complete=complete, on_status=on_status,
    )
    check()
    return {"translations": [{"id": cue["id"], "text": cue["text"]} for cue in result.project["segments"]],
            "warnings": list(result.warnings), "language": language}


class JobManager:
    """One store per localhost port; only one server can own that port.

    Reopening the same port marks unfinished jobs interrupted instead of blindly
    repeating billable requests. Completed results survive page/server restarts.
    A different port owns a separate store and cannot interrupt another editor.
    """

    def __init__(self, path: Path, *, translate=translate_snapshot, test_connection=test_llm_connection, tts=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(project_id, request_key))")
        self.db.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS job_inputs (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS job_items (job_id TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(job_id,key))")
        self.db.execute("CREATE INDEX IF NOT EXISTS jobs_project_revision ON jobs(project_id, revision)")
        self.db.execute("INSERT OR IGNORE INTO metadata VALUES ('revision', 0)")
        self.db.commit()
        self.translate = translate
        self.test_connection = test_connection
        self.tts = tts
        self.pending = queue.Queue(maxsize=32)
        self.cancel_events = {}
        self.closed = False
        self.close_complete = threading.Event()
        for (payload,) in self.db.execute("SELECT payload FROM jobs").fetchall():
            job = json.loads(payload)
            if job["status"] not in TERMINAL:
                job.update(status="interrupted", error="编辑器服务已重启；请求可能已到达服务商，未自动重新发送。")
                self._write(job)
            elif job.get("snapshot") is not None:
                self._write(job)  # Migrate legacy snapshots once, before workers start.
        self.workers = [threading.Thread(target=self._worker, daemon=True, name=f"msw-processing-{i}") for i in range(2)]
        for worker in self.workers:
            worker.start()

    def _write(self, job: dict):
        with self.lock:
            revision = self.db.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0] + 1
            job.update(revision=revision, updated_at=time.time())
            with self.db:
                stored = dict(job)
                snapshot = stored.pop("snapshot", None)
                if snapshot is not None:
                    self.db.execute("INSERT OR IGNORE INTO job_inputs VALUES (?,?)", (job["id"], json.dumps(snapshot, ensure_ascii=False)))
                self.db.execute("UPDATE metadata SET value=? WHERE key='revision'", (revision,))
                self.db.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
                                (job["id"], job["project_id"], job["request_key"], job["fingerprint"], revision,
                                 json.dumps(stored, ensure_ascii=False)))

    def _get(self, job_id: str, project_id: str, *, details=True) -> dict:
        row = self.db.execute("SELECT payload FROM jobs WHERE id=? AND project_id=?", (job_id, project_id)).fetchone()
        if row is None:
            raise KeyError("任务不存在或不属于当前工程")
        job = json.loads(row[0])
        if details:
            source = self.db.execute("SELECT snapshot FROM job_inputs WHERE id=?", (job_id,)).fetchone()
            if source:
                job["snapshot"] = json.loads(source[0])
            if job["kind"] == "tts":
                rows = self.db.execute("SELECT payload FROM job_items WHERE job_id=? ORDER BY rowid", (job_id,)).fetchall()
                if rows:
                    job["result"] = {"items": [json.loads(row[0]) for row in rows]}
        return job

    @staticmethod
    def public(job: dict, *, with_result=False) -> dict:
        hidden = {"request_key", "fingerprint", "snapshot", "result", "prompt"}
        result = {key: value for key, value in job.items() if key not in hidden}
        if with_result:
            result.update(snapshot=job.get("snapshot"), result=job.get("result"))
        return result

    def submit(self, payload: dict, settings: LlmSettings) -> dict:
        kind = payload.get("kind", "translation")
        if kind not in {"translation", "connection_test", "tts"}:
            raise ValueError("未知处理任务")
        project_id = payload.get("project_id")
        request_key = payload.get("request_key")
        client_token = payload.get("client_token", "legacy")
        if not valid_id(project_id) or not valid_id(request_key) or not valid_id(client_token):
            raise ValueError("任务缺少工程标识或请求标识")
        snapshot = validate_snapshot(payload.get("snapshot")) if kind == "translation" else None
        if kind == "tts":
            from maw.msw.tts import validate_snapshot as validate_tts_snapshot
            if self.tts is None:
                raise ValueError("TTS 服务尚未启用")
            snapshot = validate_tts_snapshot(payload.get("snapshot"))
        if snapshot and snapshot["project_id"] != project_id:
            raise ValueError("任务工程标识与快照不一致")
        language = payload.get("language", "en")
        prompt = payload.get("prompt", "")
        if language not in {"zh", "en"} or not isinstance(prompt, str) or len(prompt) > 8000:
            raise ValueError("翻译目标或补充要求无效")
        recipe = {"kind": kind, "snapshot": snapshot, "language": language, "prompt": prompt,
                  "provider": settings.provider_id, "model": settings.model, "base_url": settings.base_url,
                  "reasoning_mode": settings.reasoning_mode, "client_token": client_token}
        if kind == "tts":
            recipe["tts"] = settings.recipe
            recipe["retry_of"] = payload.get("retry_of")
        fingerprint = hashlib.sha256(json.dumps(recipe, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            if self.closed:
                raise ValueError("处理服务正在关闭")
            row = self.db.execute("SELECT payload FROM jobs WHERE project_id=? AND request_key=?", (project_id, request_key)).fetchone()
            if row:
                previous = json.loads(row[0])
                if previous["fingerprint"] != fingerprint:
                    raise ValueError("相同请求标识不能提交不同任务")
                return self.public(previous)
            if len(self.cancel_events) >= 16:
                raise ValueError("待处理任务较多，请等待或取消已有任务")
            if kind == "tts":
                library_size = payload.get("library_size", 0)
                if type(library_size) is not int or not 0 <= library_size <= 10000:
                    raise ValueError("素材数量无效")
                reserved = 0
                for pending_id in self.cancel_events:
                    row = self.db.execute("SELECT payload FROM jobs WHERE id=? AND project_id=?", (pending_id, project_id)).fetchone()
                    if row:
                        pending_job = json.loads(row[0])
                        if pending_job["kind"] == "tts" and pending_job["status"] not in TERMINAL:
                            reserved += max(0, pending_job["count"] - pending_job.get("progress", {}).get("current", 0))
                if max(library_size, self.tts.assets.count(project_id)) + reserved + len(snapshot["entries"]) > 10000:
                    raise ValueError("本批将超过工程 10000 条素材上限，请等待已有任务或在新工程中处理")
            if kind == "tts" and payload.get("retry_of"):
                previous = self._get(payload["retry_of"], project_id)
                if previous["kind"] != "tts" or previous["status"] not in TERMINAL:
                    raise ValueError("只能重试已结束的 TTS 任务")
                ready = {row["key"] for row in (previous.get("result") or {}).get("items", []) if row["status"] == "ready"}
                ready.update(self.tts.assets.ready_keys(project_id))
                allowed = {row["key"]: row for row in previous["snapshot"]["entries"] if row["key"] not in ready}
                if any(allowed.get(row["key"]) != row for row in snapshot["entries"]):
                    raise ValueError("重试只允许原任务中未成功的字幕")
                requested_keys = {row["key"] for row in snapshot["entries"]}
                for pending_id in self.cancel_events:
                    pending_row = self.db.execute("SELECT project_id FROM jobs WHERE id=?", (pending_id,)).fetchone()
                    if pending_row[0] != project_id:
                        continue
                    other = self._get(pending_id, project_id)
                    if other["kind"] == "tts" and other["status"] not in TERMINAL and any(row["key"] in requested_keys for row in other["snapshot"]["entries"]):
                        raise ValueError("这些字幕正在其他 TTS 任务中处理，请等待完成")
            job = {"id": str(uuid.uuid4()), "project_id": project_id, "request_key": request_key,
                   "client_token": client_token,
                   "fingerprint": fingerprint, "kind": kind, "status": "queued", "application": "pending",
                   "snapshot": snapshot, "result": None, "language": language, "prompt": prompt,
                   "provider": settings.provider_id, "model": settings.model,
                   "count": len(snapshot["entries"]) if snapshot else 0, "stage": "queued", "progress": {},
                   "created_at": time.time(), "error": ""}
            if kind == "tts":
                job["recipe"] = copy.deepcopy(settings.recipe)
                job["retry_of"] = payload.get("retry_of")
            self._write(job)
            cancel = threading.Event()
            self.cancel_events[job["id"]] = cancel
            self.pending.put_nowait((job["id"], project_id, settings, cancel))
            return self.public(job)

    def list(self, project_id: str, since=0) -> dict:
        with self.lock:
            rows = self.db.execute("SELECT payload FROM jobs WHERE project_id=? AND revision>? ORDER BY revision", (project_id, since)).fetchall()
            revision = self.db.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]
            return {"jobs": [self.public(json.loads(row[0])) for row in rows], "revision": revision}

    def get(self, job_id: str, project_id: str) -> dict:
        with self.lock:
            return self.public(self._get(job_id, project_id), with_result=True)

    def cancel(self, job_id: str, project_id: str) -> dict:
        with self.lock:
            job = self._get(job_id, project_id, details=False)
            if job["status"] not in TERMINAL:
                event = self.cancel_events.get(job_id)
                if event:
                    event.set()
                job["status"] = "cancelled" if job["status"] == "queued" else "cancel_requested"
                self._write(job)
            return self.public(job)

    def acknowledge(self, job_id: str, project_id: str, application: str) -> dict:
        if application not in {"applied", "discarded", "stale"}:
            raise ValueError("无效结果状态")
        with self.lock:
            job = self._get(job_id, project_id, details=False)
            if job["status"] != "succeeded":
                raise ValueError("任务尚未成功")
            job["application"] = application
            self._write(job)
            return self.public(job)

    def _worker(self):
        while True:
            work = self.pending.get()
            if work is None:
                self.pending.task_done()
                return
            job_id, project_id, settings, cancel = work
            try:
                with self.lock:
                    job = self._get(job_id, project_id)
                    if cancel.is_set():
                        raise JobCancelled()
                    job["status"] = "running"
                    self._write(job)
                def progress(stage, details, partial_result=None):
                    with self.lock:
                        if cancel.is_set() and partial_result is None:
                            raise JobCancelled()
                        current = self._get(job_id, project_id, details=False)
                        current.update(stage=stage, progress=details)
                        if partial_result is not None:
                            if current["kind"] == "tts":
                                with self.db:
                                    for item in partial_result["items"]:
                                        self.db.execute("INSERT OR REPLACE INTO job_items VALUES (?,?,?)",
                                                        (job_id, item["key"], json.dumps(item, ensure_ascii=False)))
                            else:
                                current["result"] = partial_result
                        self._write(current)
                        if cancel.is_set():
                            raise JobCancelled()
                if job["kind"] == "connection_test":
                    self.test_connection(settings)
                    result = {"connected": True}
                elif job["kind"] == "tts":
                    result = self.tts.run(job, settings, cancel, progress)
                else:
                    result = self.translate(job["snapshot"], job["language"], job["prompt"], settings, cancel, progress)
                with self.lock:
                    if cancel.is_set():
                        raise JobCancelled()
                    current = self._get(job_id, project_id, details=False)
                    current.update(status="succeeded", result=None if current["kind"] == "tts" else result, stage="done")
                    self._write(current)
            except JobCancelled:
                with self.lock:
                    current = self._get(job_id, project_id, details=False)
                    if current["status"] != "interrupted":
                        current["status"] = "cancelled"
                        self._write(current)
            except Exception as error:
                with self.lock:
                    current = self._get(job_id, project_id, details=False)
                    if current["status"] != "interrupted":
                        # Never persist provider credentials, including in error text.
                        detail = str(error).replace(settings.api_key, "[已隐藏]") if settings.api_key else str(error)
                        current.update(status="cancelled" if cancel.is_set() else "failed", error=detail[:800])
                        self._write(current)
            finally:
                with self.lock:
                    self.cancel_events.pop(job_id, None)
                self.pending.task_done()

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            for job_id, event in self.cancel_events.items():
                event.set()
                row = self.db.execute("SELECT project_id FROM jobs WHERE id=?", (job_id,)).fetchone()
                job = self._get(job_id, row[0])
                if job["status"] not in TERMINAL:
                    job.update(status="interrupted", error="处理服务已关闭，任务未自动重试。")
                    self._write(job)
            for _ in self.workers:
                self.pending.put_nowait(None)
        # An in-flight HTTP request cannot be killed safely. Daemon workers stop
        # after its bounded timeout; close the DB only after all workers finish.
        def finish():
            for worker in self.workers:
                worker.join()
            with self.lock:
                self.db.close()
            self.close_complete.set()
        threading.Thread(target=finish, daemon=True, name="msw-processing-close").start()
