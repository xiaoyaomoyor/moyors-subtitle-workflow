"""Reviewed, atomic user configuration transfer. Never writes a project or task."""
from __future__ import annotations

import copy
import hashlib
import json
import uuid
from datetime import datetime, timezone

from maw.user_config import (FORMAT, VERSION, LIMIT, MISSING, REGISTRY, ENV_KEYS, SERVER_KEYS,
                             ConfigConflict, _atomic, _get, _put, _registry_file_lock, validate, changes)

CATEGORIES = {
    'interface': '界面与编辑操作', 'waveform': '波形与工作区', 'launcher': '启动器',
    'subtitlePresets': '字幕样式预设', 'preview': '预览偏好', 'assStyles': 'ASS 样式库',
    'speakerSchemes': '说话人方案',
    'processing': '翻译与文本处理', 'tts': '配音设置', 'recovery': '工程备份设置', 'onboarding': '首次使用提示',
}
# Keep their schema available to validate existing files and internal backups,
# but do not offer retired libraries or onboarding flags as user preferences.
RETIRED_CATEGORIES = {'assStyles', 'onboarding'}
GROUPS = {'editor': 'interface', 'appearance': 'interface', 'language': 'interface', 'panels': 'interface'}


def paths(category):
    result = []
    for rule in REGISTRY.values():
        owner = GROUPS.get(rule['category'], rule['category'])
        if rule['exportable'] and owner == category and rule['path'][0] == 'browser':
            result.append(rule['path'])
    if category == 'launcher':
        result += [['launcher', key] for key in sorted(ENV_KEYS)]
    if category == 'waveform':
        result += [['server', key] for key in sorted(SERVER_KEYS)]
    if category in ('subtitlePresets', 'speakerSchemes', 'assStyles'):
        result += [[category]]
    if category in ('processing', 'tts', 'recovery'):
        result += [['defaults', 'postprocess' if category == 'processing' else category]]
    return result


def select(sections, categories):
    selected = {}
    for category in categories:
        for path in paths(category):
            value = _get(sections, path)
            if value is not MISSING:
                if path[0] == 'server' and path[-1] in ('saved_workspaces', 'preset_workspaces'):
                    value = {name: {key: item for key, item in workspace.items() if key != 'navigation'}
                             for name, workspace in value.items()}
                _put(selected, path, value)
    return selected


def metadata():
    return [dict(id=key, name=name, paths=paths(key), retired=key in RETIRED_CATEGORIES)
            for key, name in CATEGORIES.items()]


def category_list(raw):
    if not isinstance(raw, list) or not raw or any(not isinstance(x, str) for x in raw) or len(raw) != len(set(raw)) or any(x not in CATEGORIES for x in raw):
        raise ValueError('请选择有效的配置分类')
    return raw


def package(sections, categories):
    return dict(format=FORMAT, version=VERSION, kind='preferences', categories=list(categories),
                sections=select(sections, categories))


def parse(raw):
    if not isinstance(raw, dict) or raw.get('format') != FORMAT or type(raw.get('version')) is not int or raw['version'] != VERSION:
        raise ValueError('不是受支持的 .mswconfig 配置文件')
    if set(raw) - {'format', 'version', 'kind', 'categories', 'sections'} or raw.get('kind') not in ('preferences', 'workspace'):
        raise ValueError('请使用配置管理导出的文件，不接受工程或内部配置数据库')
    category_list(raw.get('categories'))
    validate(raw.get('sections'))
    if 'defaults' in raw['sections']:
        from maw.config_defaults import validate as validate_defaults
        validate_defaults(raw['sections']['defaults'])
    themes = raw['sections'].get('browser', {}).get('moy.asr.editor.customThemes.v1') or []
    if len(themes) > 256 or any(not isinstance(item, dict) or not isinstance(item.get('name'), str)
                               or not 1 <= len(item['name']) <= 80 for item in themes):
        raise ValueError('自定义主题库格式无效')
    proof = raw['sections'].get('browser', {}).get('msw.subtitle-proof.v1') or {}
    if not isinstance(proof.get('mode', 'project'), str):
        raise ValueError('预览样式标识无效')
    ass = raw['sections'].get('assStyles')
    if ass:
        from maw.ass_styles import ASS_STYLE_LIBRARY_SCHEMA, normalize_ass_style_library
        if ass.get('schema') != ASS_STYLE_LIBRARY_SCHEMA or ass.get('version') != 1:
            raise ValueError('ASS 样式库版本不受支持')
        if set(ass) - {'schema', 'version', 'styles', 'assProfiles', 'assignments'}:
            raise ValueError('ASS 样式库字段无效')
        for kind, maximum in [('styles', 128), ('assProfiles', 128)]:
            rows = ass.get(kind)
            if not isinstance(rows, list) or len(rows) > maximum or any(not isinstance(row, dict) or not isinstance(row.get('id'), str) for row in rows):
                raise ValueError('ASS 样式库条目无效')
        normalize_ass_style_library(ass)
    if raw['sections'] != select(raw['sections'], raw['categories']):
        raise ValueError('配置包含未选分类、内部标记或未登记字段')
    if len(json.dumps(raw, ensure_ascii=False, allow_nan=False).encode()) > LIMIT:
        raise ValueError('配置文件超过 4 MB')
    if raw['kind'] == 'workspace':
        saved = raw['sections'].get('server', {}).get('saved_workspaces', {})
        if raw['categories'] != ['waveform'] or len(saved) != 1 or raw['sections'] != {'server': {'saved_workspaces': saved}}:
            raise ValueError('工作区文件只允许一个命名布局')
    return copy.deepcopy(raw)


def workspace(raw, name):
    """The old workspace envelope is accepted only as a named layout preset."""
    if not isinstance(raw, dict):
        raise ValueError('工作区格式无效')
    value = raw.get('workspace', raw)
    allowed = {'schema', 'preset', 'waveformMode', 'waveformSettings', 'splitPercent', 'columnPercent',
               'rows', 'tree', 'hiddenModules', 'selectedPreset', 'editorDisplay', 'colors', 'themePreset'}
    if (not isinstance(value, dict) or value.get('schema') != 'moy.asr.editor.workspace.v1'
            or set(value) - allowed or not isinstance(name, str) or not name.strip()):
        raise ValueError('请选择 MSWE 导出的 .workspace.json 文件')
    result = dict(format=FORMAT, version=VERSION, kind='workspace', categories=['waveform'],
                  sections={'server': {'saved_workspaces': {name.strip()[:60]: value}}})
    return parse(result)


def dependency_errors(sections):
    errors = []
    mode = (sections.get('browser', {}).get('msw.subtitle-proof.v1') or {}).get('mode', 'project')
    ids = {'project', 'default', 'large', 'contrast', 'bilingual'} | {
        item['id'] for item in sections.get('subtitlePresets', {}).get('presets', [])}
    if mode not in ids:
        errors.append('预览样式依赖缺失：请一并导入字幕样式预设，或保留本机预览偏好。')
    return errors


def notes(categories):
    result = []
    if 'speakerSchemes' in categories:
        result.append('说话人方案包含名字、译名、颜色、外观与动画；导入只更新方案库，在工程中确认对应后应用。字体文件不打包。')
    if 'subtitlePresets' in categories or 'assStyles' in categories:
        result.append('字体文件不随配置传输；目标机器需安装所用字体。')
    if 'tts' in categories:
        result.append('仅包含引擎与合成参数；账号音色、参考音频、模型、服务地址和密钥留在本机。迁入新机器后请重新选择音色／资源。')
    if 'processing' in categories:
        result.append('文稿、视频路径与轨道范围不导入；文稿匹配等步骤需重新选择输入。正在执行的任务保持原参数。')
    return result


def keep(old, incoming):
    if old is MISSING:
        return copy.deepcopy(incoming)
    if isinstance(old, dict) and isinstance(incoming, dict):
        return {**old, **{key: keep(old.get(key, MISSING), value) for key, value in incoming.items()}}
    return copy.deepcopy(old)


def merge_library(old, incoming):
    """Keep local conflicting IDs and names, add distinct user presets."""
    result = copy.deepcopy(old)
    ids = {x.get('id') for x in result if x.get('id')}
    names = {x.get('name') for x in result}
    for item in incoming:
        if (not item.get('id') or item['id'] not in ids) and item.get('name') not in names:
            result.append(copy.deepcopy(item))
            if item.get('id'):
                ids.add(item['id'])
            names.add(item.get('name'))
    return result


def prepare(before, raw, categories, policy):
    raw = parse(raw)
    categories = category_list(categories)
    if set(categories) - set(raw['categories']):
        raise ValueError('文件不包含所选分类')
    if policy not in ('keep', 'replace'):
        raise ValueError('冲突处理规则无效')
    after = copy.deepcopy(before['sections'])
    rows = []
    for category in categories:
        conflict_count = 0
        selected_paths = paths(category) if raw['kind'] != 'workspace' else [
            ['server', 'saved_workspaces', name] for name in raw['sections']['server']['saved_workspaces']]
        for path in selected_paths:
            old, new = _get(after, path), _get(raw['sections'], path)
            if old is not MISSING and old != new:
                conflict_count += 1
            if policy == 'keep':
                if new is MISSING:
                    continue
                if path == ['subtitlePresets'] and old is not MISSING:
                    new = dict(version=1, presets=merge_library(old.get('presets', []), new.get('presets', [])))
                elif path == ['speakerSchemes'] and old is not MISSING:
                    new = dict(version=1, schemes=merge_library(old.get('schemes', []), new.get('schemes', [])))
                elif path == ['browser', 'moy.asr.editor.customThemes.v1'] and old is not MISSING:
                    new = merge_library(old, new)
                else:
                    new = keep(old, new)
            elif path[0] == 'defaults' and (new is MISSING or path[1] == 'tts'):
                from maw.config_defaults import public_plan, public_recipe, RECIPE_MODULES
                if path[1] == 'tts':
                    base = {**{provider: public_recipe(provider, {}) for provider in RECIPE_MODULES}, 'engine': 'qwen'}
                    new = {**base, **({} if new is MISSING else new)}
                    new['presets'] = {'indextts': {}, 'gpt-sovits': {}, **new.get('presets', {})}
                elif path[1] == 'postprocess':
                    new = public_plan({})
                else:
                    new = {'enabled': True, 'interval': 300, 'limit': 20}
            _put(after, path, new)
            if path[0] == 'server' and path[-1] in ('saved_workspaces', 'preset_workspaces') and new is not MISSING:
                for name, value in new.items():
                    previous = old.get(name, {}) if isinstance(old, dict) else {}
                    if 'navigation' in previous:
                        after['server'][path[-1]][name]['navigation'] = copy.deepcopy(previous['navigation'])
        delta = changes(select(before['sections'], [category]), select(after, [category]))
        rows.append(dict(id=category, name=CATEGORIES[category], changes=len(delta), conflicts=conflict_count,
                         removed=sum(1 for op in delta if op.get('delete')),
                         details=[dict(path=op['path'], before=op.get('before'), after=op.get('value')) for op in delta[:80]]))
    # Empty parent maps are allowed. Validate the entire result before touching disk.
    validate(after)
    digest = hashlib.sha256(json.dumps([before['revision'], raw, categories, policy], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return after, dict(revision=before['revision'], token=digest, categories=categories, policy=policy, rows=rows,
                      errors=dependency_errors(after) if set(categories) & {'preview', 'subtitlePresets'} else [],
                      notes=notes(categories), changed=after != before['sections'])


def history(store):
    path = store.path.with_name('config-snapshots.json')
    try:
        if path.stat().st_size > 24 * LIMIT:
            raise ValueError('配置快照库过大')
        rows = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return []
    if not isinstance(rows, list) or len(rows) > 20:
        raise ValueError('配置快照库无效，未覆盖')
    return rows


def commit(store, raw, payload, *, label='导入前'):
    store.path.parent.mkdir(parents=True, exist_ok=True)
    with _registry_file_lock(store.path):
        before = store.read()
        after_sections, preview = prepare(before, raw, payload.get('categories'), payload.get('policy'))
        if payload.get('revision') != preview['revision'] or payload.get('token') != preview['token']:
            raise ConfigConflict([['配置预览已过期，请重新预览']])
        if preview['errors']:
            raise ValueError('；'.join(preview['errors']))
        if not preview['changed']:
            return dict(snapshot=store.snapshot(), changed=False)
        snapshots = history(store)
        snapshots.append(dict(id=uuid.uuid4().hex, created=datetime.now(timezone.utc).isoformat(), label=label,
                              package=package(before['sections'], list(CATEGORIES))))
        # History is written first: a failed config replacement never loses the recovery point.
        _atomic(store.path.with_name('config-snapshots.json'), snapshots[-20:])
        after = {**before, 'sections': after_sections}
        markers = set(before.get('migrations', []))
        for category in payload['categories']:
            for path in paths(category):
                if len(path) >= 2:
                    markers.add(f'browser:{path[0]}:{path[1]}')
            for rule in REGISTRY.values():
                if GROUPS.get(rule['category'], rule['category']) == category and len(rule['path']) >= 2:
                    markers.add('browser:' + ':'.join(rule['path'][:2]))
        after['migrations'] = sorted(markers)
        store._write(before, after)
        return dict(snapshot=store.snapshot(), changed=True)


def request(store, payload):
    action = payload['action']
    if action in ('catalog', 'export', 'preview', 'restore-preview'):
        from maw.config_defaults import seed
        store.migrate_files()
        seed(store, store.env_path)
    before = store.read()
    if action == 'convert-workspace':
        return dict(package=workspace(payload.get('workspace'), payload.get('name')))
    if action == 'catalog':
        return dict(categories=metadata(), revision=before['revision'])
    if action == 'export':
        categories = category_list(payload.get('categories'))[:]
        if 'preview' in categories and 'subtitlePresets' not in categories and dependency_errors(select(before['sections'], ['preview'])):
            categories.append('subtitlePresets')
        result = package(before['sections'], categories)
        errors = dependency_errors(result['sections']) if 'preview' in categories else []
        if errors:
            raise ValueError('；'.join(errors))
        return dict(package=parse(result), notes=notes(categories))
    if action == 'snapshots':
        return dict(snapshots=[{key: row[key] for key in ('id', 'created', 'label')} for row in reversed(history(store))])
    raw = payload.get('package')
    if action in ('restore', 'restore-preview'):
        row = next((x for x in history(store) if x['id'] == payload.get('id')), None)
        if row is None:
            raise ValueError('配置快照不存在')
        raw = row['package']
    if action in ('preview', 'restore-preview'):
        _, preview = prepare(before, raw, payload.get('categories'), payload.get('policy'))
        return preview
    return commit(store, raw, payload, label='回退前' if action == 'restore' else '导入前')
