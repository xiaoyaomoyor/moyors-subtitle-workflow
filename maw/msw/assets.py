"""Immutable generated assets, staged locally and copied alongside saved projects."""

from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import sqlite3
import struct
import threading
import time
import uuid
import wave
from pathlib import Path

from maw.msw.project_codec import valid_id


def audio_info(data):
    from maw.msw.tts import MAX_AUDIO_BYTES
    if not isinstance(data, bytes) or not 44 <= len(data) <= MAX_AUDIO_BYTES:
        raise ValueError("音频文件为空或超过大小限制")
    try:
        with wave.open(io.BytesIO(data), "rb") as reader:
            rate, channels, frames, width = reader.getframerate(), reader.getnchannels(), reader.getnframes(), reader.getsampwidth()
            if not 8000 <= rate <= 192000 or not 1 <= channels <= 8 or not 1 <= width <= 4 or not frames:
                raise ValueError("WAV 音频参数无效")
            actual = len(reader.readframes(frames))
            if actual != frames * channels * width:
                raise ValueError(f"WAV 音频不完整（头部声明 {frames * channels * width} 字节，实际读取 {actual} 字节）")
    except (wave.Error, EOFError) as error:
        raise ValueError("百炼返回的文件不是可播放的 PCM WAV") from error
    return {"sample_rate": rate, "channels": channels, "sample_count": frames,
            "sha256": hashlib.sha256(data).hexdigest(), "byte_size": len(data)}


def _streaming_wav_size(size):
    # Streaming writers may subtract a variable-sized RIFF/metadata header
    # from the signed/unsigned 32-bit maximum. These narrow 64 KiB bands are
    # far beyond our 32 MiB download cap; ordinary size mismatches stay errors.
    return any(limit - 65536 < size <= limit for limit in (0x7FFFFFFF, 0xFFFFFFFF))


def normalize_generated_wav(data):
    """Finalize known streaming PCM length sentinels after a complete download.

    Ordinary declared lengths remain authoritative: do not repair arbitrary
    size mismatches, which could hide a truncated download. A streaming data
    chunk extends to EOF; its samples must contain complete PCM frames.
    """
    from maw.msw.tts import MAX_AUDIO_BYTES
    if not isinstance(data, bytes) or not 44 <= len(data) <= MAX_AUDIO_BYTES:
        raise ValueError("音频文件为空或超过大小限制")
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return data  # The strict decoder reports unsupported formats.
    riff_size = struct.unpack_from("<I", data, 4)[0]
    offset, fmt = 12, None
    while offset + 8 <= len(data):
        kind, size = struct.unpack_from("<4sI", data, offset)
        start = offset + 8
        if kind == b"data":
            streaming = _streaming_wav_size(size)
            if not streaming and not _streaming_wav_size(riff_size):
                return data
            if fmt is None:
                raise ValueError("WAV 缺少有效 PCM 格式信息")
            encoding, channels, rate, byte_rate, block_align, bits = fmt
            if (encoding != 1 or not 1 <= channels <= 8 or not 8000 <= rate <= 192000
                    or bits not in {8, 16, 24, 32} or block_align != channels * (bits // 8)
                    or byte_rate != rate * block_align):
                raise ValueError("WAV 音频参数无效")
            if streaming:
                if not _streaming_wav_size(riff_size) and riff_size not in {len(data) - 8, size + start - 8}:
                    raise ValueError("WAV 音频不完整（RIFF 长度与文件不符）")
                size = len(data) - start
            if not size or size % block_align or start + size > len(data):
                raise ValueError("WAV 音频不完整（PCM 数据缺失或采样帧不完整）")
            normalized = bytearray(data)
            if streaming:
                struct.pack_into("<I", normalized, offset + 4, size)
            # RIFF chunks are word-aligned; a streaming 8-bit/24-bit tail may
            # need a pad byte. The data length itself excludes this padding.
            if start + size == len(normalized) and size % 2:
                normalized.append(0)
            struct.pack_into("<I", normalized, 4, len(normalized) - 8)
            return bytes(normalized)
        if start + size > len(data):
            raise ValueError("WAV 音频不完整（音频头或元数据被截断）")
        if kind == b"fmt " and size >= 16:
            fmt = struct.unpack_from("<HHIIHH", data, start)
        offset = start + size + (size % 2)
    return data


def asset_relative_path(project_id, asset_id):
    # Hash the namespace: legacy valid IDs may contain Windows-special characters.
    namespace = hashlib.sha256(project_id.encode()).hexdigest()[:24]
    return f"msw-{namespace}.assets/audio/{asset_id}.wav"


def confined_path(root, relative):
    base = Path(root).resolve()
    path = (base / relative).resolve()
    if path == base or not path.is_relative_to(base):
        raise ValueError("素材路径不在工程目录内")
    return path


def atomic_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(f".{path.name}.{uuid.uuid4().hex}.pending")
    with pending.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(pending, path)


class AssetStore:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        # Connections are short-lived, so shutdown never races in-flight workers.
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS assets (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL, job_id TEXT NOT NULL, payload TEXT NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS assets_project ON assets(project_id, seq)")
            db.execute("CREATE TABLE IF NOT EXISTS asset_links (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, asset_id TEXT NOT NULL, UNIQUE(project_id, asset_id))")
            db.execute("INSERT OR IGNORE INTO asset_links(project_id,asset_id) SELECT project_id,id FROM assets ORDER BY seq")

    def connect(self):
        # sqlite context managers commit but don't close connections.
        from contextlib import contextmanager
        @contextmanager
        def connection():
            db = sqlite3.connect(self.root / "index.sqlite3", timeout=30)
            try:
                with db:
                    yield db
            finally:
                db.close()
        return connection()

    def add(self, project_id, job_id, source, recipe, audio, *, spoken_text=None):
        audio = normalize_generated_wav(audio)
        info = audio_info(audio)
        asset_id = "audio-" + uuid.uuid4().hex
        asset = {"id": asset_id, "kind": "audio", "path": asset_relative_path(project_id, asset_id),
                 **info, "created_at": time.time(), "job_id": job_id,
                 "generation": {**copy.deepcopy(recipe), "display_text": source["text"],
                                "spoken_text": source["text"] if spoken_text is None else spoken_text},
                 "source_ref": copy.deepcopy(source)}
        if not valid_id(project_id) or not valid_id(job_id):
            raise ValueError("素材来源标识无效")
        with self.lock:
            atomic_bytes(confined_path(self.root, asset["path"]), audio)
            with self.connect() as db:
                db.execute("INSERT INTO assets(id,project_id,job_id,payload) VALUES (?,?,?,?)",
                           (asset_id, project_id, job_id, json.dumps(asset, ensure_ascii=False)))
                db.execute("INSERT INTO asset_links(project_id,asset_id) VALUES (?,?)", (project_id, asset_id))
        return asset

    def list(self, project_id, since=0):
        with self.connect() as db:
            rows = db.execute("SELECT l.seq,a.payload FROM asset_links l JOIN assets a ON a.id=l.asset_id WHERE l.project_id=? AND l.seq>? ORDER BY l.seq LIMIT 500",
                              (project_id, since)).fetchall()
        return {"assets": [json.loads(row[1]) for row in rows], "cursor": rows[-1][0] if rows else since,
                "more": len(rows) == 500}

    def get(self, project_id, asset_id):
        with self.connect() as db:
            row = db.execute("SELECT a.payload FROM assets a JOIN asset_links l ON a.id=l.asset_id WHERE l.project_id=? AND a.id=?", (project_id, asset_id)).fetchone()
        return json.loads(row[0]) if row else None

    def count(self, project_id, removed=()):
        with self.connect() as db:
            if removed:
                excluded = set(removed)
                return sum(row[0] not in excluded for row in db.execute("SELECT asset_id FROM asset_links WHERE project_id=?", (project_id,)))
            return db.execute("SELECT COUNT(*) FROM asset_links WHERE project_id=?", (project_id,)).fetchone()[0]

    def imported(self, project_id, job_id):
        with self.connect() as db:
            row = db.execute("SELECT a.payload FROM assets a JOIN asset_links l ON a.id=l.asset_id WHERE l.project_id=? AND a.job_id=?",
                             (project_id, job_id)).fetchone()
        return json.loads(row[0]) if row else None

    def ready_keys(self, project_id, job_id=None):
        with self.connect() as db:
            rows = db.execute("SELECT a.payload FROM assets a JOIN asset_links l ON a.id=l.asset_id WHERE l.project_id=?" + (" AND a.job_id=?" if job_id else ""),
                              (project_id, job_id) if job_id else (project_id,)).fetchall()
        return {json.loads(row[0])["source_ref"]["key"] for row in rows}

    def resolve(self, project_id, asset, project_path=None):
        """Read only a verified audio reference, never an arbitrary local path."""
        candidates = []
        if project_path:
            candidates.append(confined_path(Path(project_path).parent, asset["path"]))
        staged = self.get(project_id, asset["id"])
        if staged and staged["sha256"] == asset["sha256"]:
            candidates.append(confined_path(self.root, staged["path"]))
        for path in candidates:
            if path.is_file() and path.stat().st_size == asset["byte_size"]:
                data = path.read_bytes()
                if hashlib.sha256(data).hexdigest() == asset["sha256"]:
                    audio_info(data)
                    return path
        raise FileNotFoundError("音频素材缺失或内容已变化；请恢复工程同目录的 .assets 文件夹")

    def persist_project(self, project, target, source_path=None):
        msw = project.get("msw") or {}
        if msw.get("source_project_id"):
            self.adopt(msw["project_id"], msw.get("assets", []), msw["source_project_id"])
        missing = []
        copied = 0
        for asset in msw.get("assets", []):
            try:
                source = self.resolve(msw["project_id"], asset, source_path)
            except FileNotFoundError:
                # Preserve missing references: subtitle edits must still be saveable.
                missing.append(asset["id"])
                continue
            destination = confined_path(target.parent, asset["path"])
            if destination != source:
                data = source.read_bytes()
                if destination.is_file():
                    if hashlib.sha256(destination.read_bytes()).hexdigest() == asset["sha256"]:
                        continue
                    raise ValueError("目标位置存在不同内容的同名音频，未覆盖保存")
                atomic_bytes(destination, data)
                copied += 1
        total = len(msw.get("assets", []))
        return {"total": total, "available": total - len(missing), "copied": copied, "missing": missing}

    def adopt(self, project_id, assets, source_id):
        """Fork ownership without rewriting or duplicating immutable audio bytes."""
        if not valid_id(project_id) or not valid_id(source_id):
            return
        for asset in assets:
            staged = self.get(source_id, asset["id"])
            if staged and staged["sha256"] == asset["sha256"]:
                with self.connect() as db:
                    db.execute("INSERT OR IGNORE INTO asset_links(project_id,asset_id) VALUES (?,?)", (project_id, asset["id"]))
