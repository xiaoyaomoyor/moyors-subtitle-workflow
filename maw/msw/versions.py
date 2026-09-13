"""Disk versions for the bound project, sharing immutable backup audio assets."""

import copy
from contextlib import closing
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import uuid

from send2trash import send2trash

from maw.gui_config import load_env, save_env
from maw.output_naming import maw_root
from maw.project import normalize_project
from maw.project_io import strip_inline_caches


def directory(project, env_path=None):
    parent = project.parent
    root = parent if parent.name.endswith('_msw') else maw_root(project, env_path=env_path)
    return root / 'backups'


def scope(project, project_id):
    # Stable after moving the entire project directory.
    return hashlib.sha256((project.name + '\0' + project_id).encode()).hexdigest()[:24]


def relocate(data, source, target):
    data = strip_inline_caches(copy.deepcopy(data))
    def reference(value):
        if not isinstance(value, str) or not value or '://' in value or value.startswith('data:'):
            return value
        path = Path(value)
        if not path.is_absolute():
            path = source.parent / path
        try:
            return Path(os.path.relpath(path.resolve(), target.parent.resolve())).as_posix()
        except ValueError:  # Different Windows drives.
            return str(path.resolve())
    if data.get('media'):
        data['media'] = reference(data['media'])
    # Sticker references are rooted by the project sticker directory.
    for key in ('sticker_root', 'sticker_dir', 'stickers_dir'):
        if data.get(key):
            data[key] = reference(data[key])
    return data


class DiskVersions:
    def __init__(self, persistence):
        self.persistence = persistence
        self.api = persistence.api

    def settings(self, raw=None):
        if raw is None:
            try:
                raw = json.loads(load_env(self.api.env_path).get('MSW_EDITOR_VERSION_BACKUP', '{}'))
            except ValueError:
                raw = {}
        if not isinstance(raw, dict):
            raise ValueError('版本备份设置无效')
        enabled, interval, limit = raw.get('enabled', True), raw.get('interval', 300), raw.get('limit', 20)
        if type(enabled) is not bool or type(interval) is not int or not 30 <= interval <= 86400 or type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('备份间隔为 30–86400 秒，版本上限为 1–1000')
        return {'enabled': enabled, 'interval': interval, 'limit': limit}

    def configure(self, raw):
        settings = self.settings(raw)
        save_env(self.api.env_path, {'MSW_EDITOR_VERSION_BACKUP': json.dumps(settings)})
        return settings

    def _location(self):
        bound = self.api.server.project
        if not bound.json_path or bound.json_path.suffix.lower() not in {'.mosp', '.json'}:
            raise ValueError('请先另存为工程，再使用磁盘版本备份；未命名工程仍有本机恢复草稿')
        key = scope(bound.json_path, self.api.context()['projectId'])
        return bound.json_path, directory(bound.json_path, self.api.env_path), key

    def _versions(self, folder, key):
        if not folder.exists():
            return []
        return sorted((p for p in folder.glob(f'msw-{key}-*.mosp-bak')
                       if p.is_file() and not p.is_symlink()), key=lambda p: p.name, reverse=True)

    def list(self):
        _source, folder, key = self._location()
        return {'versions': [{'name': p.name, 'created': p.stat().st_mtime} for p in self._versions(folder, key)]}

    def open_directory(self, payload):
        if payload.get('binding') != self.api.context()['binding']:
            raise ValueError('工程已切换')
        _source, folder, _key = self._location()
        if not folder.is_dir():
            raise ValueError('尚无版本备份目录，请先创建一个版本')
        from maw.gui_web import _open_existing_path
        return _open_existing_path(folder)

    def write(self, payload):
        if payload.get('backupOnly') is not True:
            raise ValueError('版本接口仅接受 backupOnly 快照')
        server = self.api.server
        if not server.save_lock.acquire(blocking=False):
            raise ValueError('工程正在保存，请稍后重试版本备份')
        try:
            self.api.check_save(payload.get('binding'), payload.get('saveRevision'))
            source, folder, key = self._location()
            data = normalize_project(copy.deepcopy(payload.get('project')))
            if (data.get('msw') or {}).get('project_id') != self.api.context()['projectId']:
                raise ValueError('备份内容不属于当前绑定工程')
            if data.get('media') != server.project.data.get('media'):
                raise ValueError('媒体已改变，请先保存工程后再备份')
            folder.mkdir(parents=True, exist_ok=True)
            if folder.is_symlink() or folder.resolve() != folder.absolute():
                raise ValueError('版本目录不能通过链接指向其他位置')
            limits = self.settings()
            # Serialize different server processes and deduplicate unchanged snapshots.
            with closing(sqlite3.connect(folder / '.msw-versions.sqlite3', timeout=3)) as db, db:
                db.execute('CREATE TABLE IF NOT EXISTS latest (scope TEXT PRIMARY KEY, digest TEXT, name TEXT)')
                db.execute('BEGIN IMMEDIATE')
                target = folder / 'snapshot.mosp-bak'
                data = relocate(data, source, target)
                encoded = (json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')
                digest = hashlib.sha256(encoded).hexdigest()
                last = db.execute('SELECT digest,name FROM latest WHERE scope=?', (key,)).fetchone()
                report = self.api.assets.persist_project(data, target, source)
                if report['missing']:
                    raise ValueError('版本备份存在缺失音频素材，未创建不完整版本')
                self.api.check_save(payload.get('binding'), payload.get('saveRevision'))
                if last and last[0] == digest and (folder / last[1]).is_file():
                    return {'name': last[1], 'deduplicated': True, 'assets': report}
                stamp = datetime.now().strftime('%Y-%m-%d_%H%M%S')
                sequence = 0
                while True:
                    target = folder / f'msw-{key}-{stamp}-{sequence:06d}.mosp-bak'
                    if not target.exists():
                        break
                    sequence += 1
                fd, pending = tempfile.mkstemp(prefix='.msw-version-', suffix='.pending', dir=folder)
                with os.fdopen(fd, 'wb') as output:
                    output.write(encoded)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(pending, target)
                db.execute('INSERT OR REPLACE INTO latest VALUES (?,?,?)', (key, digest, target.name))
            warning = None
            for old in self._versions(folder, key)[limits['limit']:]:
                try:
                    send2trash(str(old))
                except OSError:
                    warning = '新版本已保存，但旧版本未能移入回收站；请稍后重试清理'
            return {'name': target.name, 'deduplicated': False, 'warning': warning, 'assets': report}
        finally:
            server.save_lock.release()

    def restore(self, payload):
        with self.api.server.save_lock:
            if payload.get('binding') != self.api.context()['binding']:
                raise ValueError('工程已切换，未载入版本')
            _source, folder, key = self._location()
            target = next((p for p in self._versions(folder, key) if p.name == payload.get('name')), None)
            if target is None:
                raise ValueError('版本不存在或不属于当前工程')
            project = normalize_project(json.loads(target.read_text(encoding='utf-8')))
            extension = project['msw']
            source_id = extension['project_id']
            project_id = 'project-' + uuid.uuid4().hex
            extension.update(project_id=project_id, source_project_id=source_id)
            self.api.assets.adopt(project_id, extension.get('assets', []), source_id)
            media = project.get('media')
            record = {'project': project, 'origin': target, 'media': (folder / media).resolve() if media else None}
            self.persistence.recovered[project_id] = record
            return {'project': project, 'filename': 'recovered.mosp'}
