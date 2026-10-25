"""Bounded local recovery snapshots, independent of project auto-save."""

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import time
import uuid
import zlib

from maw.project import normalize_project


class RecoveryStore:
    PER_PROJECT_HISTORY = 20
    MAX_RECORDS = 200
    MAX_BYTES = 128 * 1024 * 1024

    def __init__(self, root):
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / "editor-recovery.sqlite3"
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slot TEXT NOT NULL,
                kind TEXT NOT NULL, name TEXT NOT NULL, created REAL NOT NULL,
                digest TEXT NOT NULL, body BLOB NOT NULL, origin TEXT, media TEXT,
                UNIQUE(project_id, slot))""")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, project, *, kind, name, origin=None, media=None, session="", now=None):
        if kind not in {"draft", "history", "saved"}:
            raise ValueError("恢复记录类型无效")
        snapshot = normalize_project({key: value for key, value in project.items()
                                      if key not in {"waveform", "spectral", "waveform_reapeaks", "loudness"}})
        return self._put_normalized(snapshot, kind=kind, name=name, origin=origin, media=media, session=session, now=now)

    def _put_normalized(self, snapshot, *, kind, name, origin=None, media=None, session="", now=None):
        """Internal save path: snapshot already passed the project boundary."""
        if kind not in {"draft", "history", "saved"}:
            raise ValueError("恢复记录类型无效")
        project_id = (snapshot.get("msw") or {}).get("project_id")
        # Older projects without an MSW namespace still get stable history.
        project_id = project_id or hashlib.sha256(str(origin or name).encode()).hexdigest()
        now = time.time() if now is None else now
        if kind == "history":
            # History already has a one-minute sampling policy. Check it before
            # encoding an entire validated project just to discard the result.
            with self.connect() as db:
                recent = db.execute("SELECT id,created FROM snapshots WHERE project_id=? AND kind='history' ORDER BY created DESC LIMIT 1",
                                    (project_id,)).fetchone()
            if recent and now - recent['created'] < 60:
                return recent['id']
        raw = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        if len(raw) > 64 * 1024 * 1024:
            raise ValueError("恢复快照超过 64 MB")
        digest = hashlib.sha256(raw).hexdigest()
        slot = "draft:" + session if kind == "draft" else "saved" if kind == "saved" else str(uuid.uuid4())
        with self.connect() as db:
            latest = db.execute("SELECT * FROM snapshots WHERE project_id=? AND kind=? ORDER BY created DESC LIMIT 1",
                                (project_id, kind)).fetchone()
            if kind == "history" and latest and (latest["digest"] == digest or now - latest["created"] < 60):
                return latest["id"]
            if latest and latest["slot"] == slot and latest["digest"] == digest and latest["origin"] == (str(origin) if origin else None) and latest["media"] == (str(media) if media else None):
                return latest["id"]
            body = zlib.compress(raw)
            existing = db.execute("SELECT id FROM snapshots WHERE project_id=? AND slot=?", (project_id, slot)).fetchone()
            record_id = existing["id"] if existing else uuid.uuid4().hex
            db.execute("""INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(project_id, slot) DO UPDATE SET name=excluded.name,
                created=excluded.created, digest=excluded.digest, body=excluded.body,
                origin=excluded.origin, media=excluded.media""",
                (record_id, project_id, slot, kind, Path(name).name[:200], now, digest, body,
                 str(origin) if origin else None, str(media) if media else None))
            for category, limit in (("history", self.PER_PROJECT_HISTORY), ("draft", 3)):
                db.execute("""DELETE FROM snapshots WHERE project_id=? AND kind=? AND id NOT IN
                    (SELECT id FROM snapshots WHERE project_id=? AND kind=? ORDER BY created DESC LIMIT ?)""",
                    (project_id, category, project_id, category, limit))
            rows = db.execute("SELECT id,length(body) AS size FROM snapshots ORDER BY created DESC").fetchall()
            size = 0
            for index, row in enumerate(rows):
                size += row["size"]
                if index >= self.MAX_RECORDS or size > self.MAX_BYTES:
                    db.execute("DELETE FROM snapshots WHERE id=?", (row["id"],))
            return record_id

    def list(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute("""SELECT id,project_id,kind,name,created
                FROM snapshots ORDER BY created DESC LIMIT ?""", (self.MAX_RECORDS,))]

    def get(self, record_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM snapshots WHERE id=?", (record_id,)).fetchone()
        if not row:
            raise KeyError("恢复记录不存在或已超过保留期限")
        project = normalize_project(json.loads(zlib.decompress(row["body"])))
        return {"id": row["id"], "name": row["name"], "project": project,
                "origin": Path(row["origin"]) if row["origin"] else None,
                "media": Path(row["media"]) if row["media"] else None}
