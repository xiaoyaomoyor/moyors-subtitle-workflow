"""Versioned, local user preferences. Project documents and credentials never enter here.

The registry is also sent to the browser storage adapter. Arrays are atomic;
object leaves use compare-and-swap so independent windows cannot erase edits.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from maw.app_paths import SOURCE_ROOT, default_app_data_root, default_env_path
from maw.launcher_projects import _registry_file_lock

FORMAT = 'msw-config'
VERSION = 1
LIMIT = 4 * 1024 * 1024
MISSING = object()

# Missing values keep the owning module's defaults (see CONFIGURATION_INVENTORY).
REGISTRY = {}


def _register(keys, category, encoding='json', exportable=True):
    for key in keys.split():
        REGISTRY[key] = dict(category=category, encoding=encoding, exportable=exportable,
                             path=['browser', key], apply='next-open')


_register('moy.asr.editor.settings.v1', 'editor')
_register('moy.asr.waveform.settings.v1', 'waveform')
_register('moy.asr.editor.customThemes.v1 moy.asr.editor.themeCustomColors.v1', 'appearance')
_register('mawe.language', 'language', 'text')
_register('msw.subtitle-proof.v1', 'preview')
_register('msw.translation.call.v1 maw.launcher.llm.prompts maw.launcher.alignment.gap_remove', 'processing')
_register('msw.assets.columns msw.assets.showPlayer msw.assets.showChanges msw.waveform.auto', 'editor', 'text')
_register('moy.asr.editor.onboarding.v1', 'onboarding', 'text')
_register('moy.asr.editor.hideDisabledFlipped.v1 moy.asr.editor.charcountMigrated.v1', 'migration', 'text', False)
_register('moy.asr.gap_remove.advanced_open.v1 moy.asr.gap_remove.disable_open.v1 msw.editor.settings.category.v1', 'panels', 'text')
_register('''moy.asr.gap_remove.panel.v1 moy.asr.help.panel.v1 moy.asr.help.panel.size.v1
    moy.asr.auto_merge.panel.v2 moy.asr.subtitle_extend.panel.v1 moy.asr.editor.editorSettingsPanel.pos.v1
    moy.asr.ass_style.window.v1 moy.asr.editor.mediaSettingsPanel.pos.v1 moy.asr.editor.waveSettingsPanel.pos.v1
    moy.asr.editor.subtitleScalePanel.pos.v2 msw.subtitleCleanup.position.v1 msw.cueEditorSettings.pos.v1
    moy.asr.editor.cueListSettingsPanel.pos.v1 msw.translation.panel.position''', 'panels')
_register('MSW_SETTINGS_TAB_V1 MSW_LAUNCHER_PAGE MSW_TOOLS_PAGE_TOOL_V1 MSW_LAUNCHER_LOG_CARD_V1', 'launcher', 'text')
_register('MSW_HOME_GROUPS_V2', 'launcher')
_register('msw.subtitle-presets.v1', 'subtitlePresets')
REGISTRY['msw.subtitle-presets.v1']['path'] = ['subtitlePresets', 'presets']
_register('moy.asr.ass.styles.v1', 'assStyles')
REGISTRY['moy.asr.ass.styles.v1']['path'] = ['assStyles']

ENV_KEYS = frozenset('''MAW_GUI_LANG MAW_GUI_SHOW_RARE_LANGS MAW_GUI_OUTPUT_SUBFOLDER
    MAW_GUI_PER_VIDEO_SUBFOLDER MAW_GUI_ATTACH_MODEL_NAME MAW_GUI_LAST_MODEL MAW_GUI_LAST_LANGUAGE
    MAW_GUI_ZOOM_PERCENT MAW_GUI_THEME MAW_GUI_NOTIFY_ON_COMPLETE MAW_GUI_PREFAB_MODULES
    MAW_GUI_ASR_SEGMENTATION'''.split())
for key in ('MAW_GUI_LAST_MODEL', 'MAW_GUI_LAST_LANGUAGE', 'MAW_GUI_ZOOM_PERCENT', 'MAW_GUI_THEME'):
    REGISTRY[key] = dict(category='launcher', encoding='text', exportable=True,
                         path=['launcher', key], apply='next-open')
# The module-choice cache has a different shape and is migrated by LauncherApi.
SERVER_KEYS = frozenset(('auto_open_last_project', 'saved_workspaces', 'preset_workspaces', 'active_workspace_name'))


def config_path(env_path=None):
    if env_path is not None:
        candidate = Path(env_path).resolve()
        explicit_root = os.getenv('MSW_APP_DATA_ROOT') or os.getenv('MAW_APP_DATA_ROOT')
        if candidate != SOURCE_ROOT / '.env' and (candidate != default_env_path().resolve() or not explicit_root) and not getattr(sys, 'frozen', False):
            return candidate.with_name('user-settings.mswconfig')
    return default_app_data_root() / 'user-settings.mswconfig'


def _get(value, path):
    for part in path:
        if not isinstance(value, dict) or part not in value:
            return MISSING
        value = value[part]
    return value


def _put(value, path, item):
    for part in path[:-1]:
        if not isinstance(value.get(part), dict):
            value[part] = {}
        value = value[part]
    if item is MISSING:
        value.pop(path[-1], None)
    else:
        value[path[-1]] = copy.deepcopy(item)


def changes(before, after, prefix=()):
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(before.keys() | after.keys()):
            result.extend(changes(before.get(key, MISSING), after.get(key, MISSING), (*prefix, key)))
        return result
    if before == after:
        return []
    item = {'path': list(prefix), 'exists': before is not MISSING}
    if before is not MISSING:
        item['before'] = before
    if after is MISSING:
        item['delete'] = True
    else:
        item['value'] = after
    return [item]


def _safe_json(value, depth=0):
    if depth > 40:
        raise ValueError('配置层级过深')
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or key in ('__proto__', 'constructor', 'prototype'):
                raise ValueError('无效配置字段')
            if key.lower().replace('_', '').replace('-', '') in {
                    'apikey', 'accesstoken', 'refreshtoken', 'authorization', 'password', 'secret', 'requesttoken'}:
                raise ValueError('用户偏好不接受密钥或凭据')
            _safe_json(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _safe_json(child, depth + 1)


def validate(sections):
    if not isinstance(sections, dict) or set(sections) - {'browser', 'launcher', 'server', 'subtitlePresets', 'assStyles'}:
        raise ValueError('不支持的配置分类')
    _safe_json(sections)
    if len(json.dumps(sections, ensure_ascii=False, allow_nan=False).encode()) > LIMIT:
        raise ValueError('配置超过 4 MB')
    for section, allowed in [('browser', REGISTRY), ('launcher', ENV_KEYS), ('server', SERVER_KEYS)]:
        values = sections.get(section, {})
        if not isinstance(values, dict) or set(values) - set(allowed):
            raise ValueError(f'未登记的配置字段：{section}')
    for key, value in sections.get('browser', {}).items():
        if REGISTRY[key]['path'] != ['browser', key]:
            raise ValueError('配置保存位置不匹配')
        if REGISTRY[key]['encoding'] == 'text' and not isinstance(value, str):
            raise ValueError('配置类型不匹配')
        if REGISTRY[key]['encoding'] == 'json' and value is not None:
            expected = list if key == 'moy.asr.editor.customThemes.v1' else dict
            if not isinstance(value, expected):
                raise ValueError('配置类型不匹配')
    if any(not isinstance(value, str) for value in sections.get('launcher', {}).values()):
        raise ValueError('启动器偏好类型不匹配')
    if any('\x00' in value or (value and value.splitlines() != [value]) for value in sections.get('launcher', {}).values()):
        raise ValueError('启动器偏好不能包含控制字符')
    server = sections.get('server', {})
    if 'auto_open_last_project' in server and type(server['auto_open_last_project']) is not bool:
        raise ValueError('自动打开工程选项必须是布尔值')
    for key in ('saved_workspaces', 'preset_workspaces'):
        library = server.get(key, {})
        if not isinstance(library, dict) or len(library) > 20:
            raise ValueError('工作区库无效（最多 20 项）')
        if any(not 1 <= len(name) <= 60 or not isinstance(value, dict) or len(json.dumps(value).encode()) > 256 * 1024 for name, value in library.items()):
            raise ValueError('工作区名称或内容无效')
    if not isinstance(server.get('active_workspace_name', ''), str):
        raise ValueError('工作区名称无效')
    if 'subtitlePresets' in sections:
        from maw.project_subtitle_style import normalize_presets
        normalize_presets({'version': 1, **sections['subtitlePresets']})
    if 'assStyles' in sections:
        if not isinstance(sections['assStyles'], dict):
            raise ValueError('样式库格式无效')


def _atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, suffix='.tmp', dir=path.parent)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(name, path)


class ConfigConflict(ValueError):
    def __init__(self, paths):
        self.paths = paths
        super().__init__('配置已在其他窗口更新；本窗口改动已保留，请刷新后重试')


class UserConfig:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else config_path()

    def read(self):
        try:
            if self.path.stat().st_size > LIMIT:
                raise ValueError('配置文件过大，未覆盖原文件')
            data = json.loads(self.path.read_text(encoding='utf-8-sig'))
        except FileNotFoundError:
            return dict(format=FORMAT, version=VERSION, revision=0, sections={}, migrations=[])
        except (UnicodeError, json.JSONDecodeError) as error:
            raise ValueError('用户配置损坏，已保留原文件及备份') from error
        if not isinstance(data, dict) or data.get('format') != FORMAT or type(data.get('version')) is not int or data.get('version') != VERSION:
            raise ValueError('用户配置版本不受支持，未覆盖原文件')
        if type(data.get('revision')) is not int or data['revision'] < 0:
            raise ValueError('用户配置版本号无效')
        validate(data.get('sections'))
        return data

    def snapshot(self):
        return {**self.read(), 'registry': REGISTRY}

    def _write(self, before, after):
        validate(after['sections'])
        after['revision'] = before['revision'] + 1
        if len(json.dumps(after, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')) + 1 > LIMIT:
            raise ValueError('配置超过 4 MB，未覆盖原文件')
        if self.path.exists():
            _atomic(self.path.with_suffix(self.path.suffix + '.bak'), before)
        _atomic(self.path, after)

    def patch(self, operations):
        if not isinstance(operations, list) or len(operations) > 4096:
            raise ValueError('配置更新格式无效')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with _registry_file_lock(self.path):
            before = self.read()
            after = copy.deepcopy(before)
            conflicts = []
            applied = list(before.get('applied', []))
            markers = set(before.get('migrations', []))
            for op in operations:
                path = op.get('path') if isinstance(op, dict) else None
                if not isinstance(path, list) or not path or not all(isinstance(p, str) and p for p in path):
                    raise ValueError('配置字段路径无效')
                operation_id = op.get('id')
                if operation_id is not None:
                    if not isinstance(operation_id, str) or len(operation_id) > 80:
                        raise ValueError('配置操作标识无效')
                    if operation_id in applied:
                        continue
                    applied.append(operation_id)
                current = _get(after['sections'], path)
                expected = op.get('before') if op.get('exists') is True else MISSING
                desired = MISSING if op.get('delete') is True else op['value']
                if current != expected and current != desired:
                    conflicts.append(path)
                _put(after['sections'], path, desired)
                if len(path) >= 2 and path[0] in ('browser', 'launcher', 'subtitlePresets', 'assStyles'):
                    markers.add(f'browser:{path[0]}:{path[1]}')
            if conflicts:
                raise ConfigConflict(conflicts)
            after['applied'] = applied[-4096:]
            after['migrations'] = sorted(markers)
            if before['sections'] != after['sections'] or before.get('applied', []) != after['applied'] or before.get('migrations', []) != after['migrations']:
                self._write(before, after)
            return {**after, 'registry': REGISTRY}

    def migrate(self, values, source):
        """Fill missing leaves once per source key. Never overwrite or resurrect deletions."""
        validate(values)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with _registry_file_lock(self.path):
            before = self.read()
            after = copy.deepcopy(before)
            markers = set(after.get('migrations', []))
            for section, entries in values.items():
                for key, value in entries.items():
                    marker = f'{source}:{section}:{key}'
                    if marker in markers:
                        continue
                    path = [section, key]
                    current = _get(after['sections'], path)
                    # Server appearance may have seeded just the theme fields.
                    def fill(old, new):
                        if old is MISSING:
                            return copy.deepcopy(new)
                        if isinstance(old, dict) and isinstance(new, dict):
                            return {**old, **{k: fill(old.get(k, MISSING), v) for k, v in new.items()}}
                        return old
                    _put(after['sections'], path, fill(current, value))
                    markers.add(marker)
            after['migrations'] = sorted(markers)
            if after != before:
                digest = hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()[:20]
                backup = self.path.parent / 'config-migration-backups' / (digest + '.mswconfig')
                if not backup.exists():
                    _atomic(backup, dict(format=FORMAT, version=VERSION, revision=0, sections=values))
                self._write(before, after)
            return {**after, 'registry': REGISTRY}

    def update(self, path, value):
        before = self.read()['sections']
        return self.patch(changes(_get(before, path), value, path))

    def migrate_files(self):
        """Read old non-sensitive sidecars only; original files remain untouched."""
        root = self.path.parent
        for name, section in [('subtitle-presets.json', 'subtitlePresets'), ('ass-styles.json', 'assStyles')]:
            path = root / name
            if path.is_file():
                raw = json.loads(path.read_text(encoding='utf-8-sig'))
                self.migrate({section: raw}, name)
        path = root / 'server-editor-settings.json'
        if path.is_file():
            raw = json.loads(path.read_text(encoding='utf-8-sig'))
            appearance = raw.get('appearance') or {}
            browser = {}
            if appearance.get('settings'):
                browser['moy.asr.editor.settings.v1'] = appearance['settings']
            for field, key in [('customThemes', 'moy.asr.editor.customThemes.v1'), ('themeStash', 'moy.asr.editor.themeCustomColors.v1')]:
                if field in appearance:
                    browser[key] = appearance[field]
            self.migrate({'server': {k: v for k, v in raw.items() if k in SERVER_KEYS}, 'browser': browser}, path.name)
        return self.snapshot()

    def request(self, payload=None):
        if payload is None:
            return self.migrate_files()
        if not isinstance(payload, dict):
            raise ValueError('配置请求格式无效')
        if payload.get('action') == 'migrate':
            values = payload.get('sections', {})
            if not isinstance(values, dict):
                raise ValueError('配置分类格式无效')
            if set(values) - {'browser', 'subtitlePresets', 'assStyles', 'launcher'}:
                raise ValueError('浏览器不能迁移服务器运行信息')
            return self.migrate(values, 'browser')
        if payload.get('action') == 'patch':
            return self.patch(payload.get('changes'))
        raise ValueError('未知配置操作')
