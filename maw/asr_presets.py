"""Portable recognition recipes and shared context in the existing user store."""
import copy
import json
import re
import uuid

TEXT_FIELDS = frozenset('language maxLen minLen maxWords minWords gapSplit qwenAudioHotwords qwenAudioHotwordWeight openaiKeywords sonioxContextGeneral sonioxContextTerms sonioxContextTranslationTerms doubaoHotwords'.split())
BOOL_FIELDS = frozenset(('speakerColors', 'qwenKeepDialect', 'openaiDiarize'))
CONTEXT_FIELDS = {'qwen': 'qwenAudioContext', 'openai': 'openaiPrompt', 'soniox': 'sonioxContextText'}


def text(value, limit=12000):
    if not isinstance(value, str) or len(value) > limit or '\0' in value:
        raise ValueError('识别预设文本无效或过长')
    return value


def validate_prompts(value):
    if not isinstance(value, dict) or set(value) != {'text', 'overrides'}:
        raise ValueError('背景文本格式无效')
    text(value['text'])
    overrides = value['overrides']
    if not isinstance(overrides, dict) or set(overrides) - CONTEXT_FIELDS.keys():
        raise ValueError('服务专用背景无效')
    for content in overrides.values():
        text(content)
    return value


def migrate_prompts(options):
    values = {provider: str(options.get(key) or '') for provider, key in CONTEXT_FIELDS.items() if key in options}
    distinct = set(values.values())
    if len(distinct) <= 1:
        return {'text': next(iter(distinct), ''), 'overrides': {}}
    return {'text': '', 'overrides': values}


def resolve_prompts(payload):
    """Legacy requests remain valid. New requests carry a frozen context object."""
    if 'asrPrompts' not in payload:
        return payload
    prompts = validate_prompts(payload['asrPrompts'])
    return {**payload, **{key: prompts['overrides'].get(provider, prompts['text'])
                         for provider, key in CONTEXT_FIELDS.items()}}


def validate_options(options):
    if not isinstance(options, dict) or set(options) - (TEXT_FIELDS | BOOL_FIELDS | {'asrPrompts'}):
        raise ValueError('识别预设包含不支持的参数')
    for key, value in options.items():
        if key == 'asrPrompts':
            validate_prompts(value)
        elif key in BOOL_FIELDS:
            if type(value) is not bool:
                raise ValueError('识别开关必须为布尔值')
        else:
            text(value)
            if key in {'maxLen', 'minLen', 'maxWords', 'minWords', 'gapSplit', 'qwenAudioHotwordWeight'} and value:
                minimum, maximum = (0, 3600000) if key == 'gapSplit' else (1, 100000)
                if key == 'qwenAudioHotwordWeight':
                    maximum = 5
                if not re.fullmatch(r'\d+', value) or not minimum <= int(value) <= maximum:
                    raise ValueError('识别预设数值参数无效')
    if int(options.get('maxLen') or 24) < int(options.get('minLen') or 5) or int(options.get('maxWords') or 13) < int(options.get('minWords') or 3):
        raise ValueError('短句合并阈值不能大于最大长度')
    return options


def validate(value):
    if not isinstance(value, dict) or set(value) - {'prompts', 'presets'}:
        raise ValueError('识别预设库格式无效')
    if 'prompts' in value:
        validate_prompts(value['prompts'])
    rows = value.get('presets', [])
    if not isinstance(rows, list) or len(rows) > 256:
        raise ValueError('识别预设库最多保存 256 项（含已删除项）')
    ids, names = set(), set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'id', 'name', 'description', 'options', 'deleted'}:
            raise ValueError('识别预设条目格式无效')
        if not isinstance(row['id'], str) or not re.fullmatch(r'[a-f0-9]{32}', row['id']) or row['id'] in ids:
            raise ValueError('识别预设标识无效或重复')
        ids.add(row['id'])
        name = text(row['name'], 80).strip()
        if not name or name != row['name'] or '\n' in name or '\r' in name:
            raise ValueError('请填写有效的预设名称（最多 80 字）')
        if type(row['deleted']) is not bool:
            raise ValueError('识别预设删除状态无效')
        if not row['deleted']:
            if name.casefold() in names:
                raise ValueError('已存在同名识别预设')
            names.add(name.casefold())
        text(row['description'], 1000)
        validate_options(row['options'])


def merge_library(old, incoming):
    rows = copy.deepcopy(old)
    ids = {row['id'] for row in old}
    names = {row['name'].casefold() for row in old if not row['deleted']}
    for row in incoming:
        if row['id'] in ids or (not row['deleted'] and row['name'].casefold() in names):
            continue
        rows.append(copy.deepcopy(row))
        ids.add(row['id'])
        if not row['deleted']:
            names.add(row['name'].casefold())
    return rows


def request(env_path, payload=None):
    from maw.user_config import UserConfig, config_path, changes, ConfigConflict
    store = UserConfig(config_path(env_path), env_path=env_path)
    snapshot = store.read()
    current = snapshot['sections'].get('asr', {})
    if 'prompts' not in current:
        from maw.gui_config import load_env
        try:
            legacy = json.loads(load_env(env_path).get('MSW_EDITOR_ASR_OPTIONS', '{}'))
        except ValueError:
            legacy = {}
        prompts = migrate_prompts(legacy if isinstance(legacy, dict) else {})
        migrated = store.migrate({'asr': {'prompts': prompts}}, 'asr-prompts:v1')
        current = migrated['sections'].get('asr', {})
        prompts = current.get('prompts', {'text': '', 'overrides': {}})
    else:
        prompts = current['prompts']
    if payload is not None:
        if not isinstance(payload, dict):
            raise ValueError('识别预设请求无效')
        action = payload.get('action', 'catalog')
        after = copy.deepcopy(current)
        if action == 'prompts':
            if payload.get('before') != prompts:
                raise ConfigConflict([['asr', 'prompts']])
            after['prompts'] = validate_prompts(payload.get('value'))
        elif action in {'save', 'delete', 'restore', 'copy'}:
            rows = after.setdefault('presets', [])
            old = next((row for row in rows if row['id'] == payload.get('id')), None)
            if payload.get('id') and (old is None or payload.get('before') != old):
                raise ConfigConflict([['asr', 'presets']])
            if action in {'delete', 'restore'}:
                if old is None:
                    raise ValueError('识别预设不存在')
                old['deleted'] = action == 'delete'
                if action == 'restore' and 'name' in payload:
                    old['name'] = text(payload['name'], 80).strip()
                    old['description'] = text(payload.get('description', old['description']), 1000)
            else:
                row = dict(id=old['id'] if old and action == 'save' else uuid.uuid4().hex,
                           name=text(payload.get('name', ''), 80).strip(),
                           description=text(payload.get('description', ''), 1000),
                           options=copy.deepcopy(old['options'] if action == 'copy' and old else validate_options(payload.get('options'))), deleted=False)
                if old and action == 'save':
                    rows[rows.index(old)] = row
                else:
                    rows.append(row)
            after.setdefault('prompts', prompts)
        elif action == 'catalog':
            return request(env_path)
        else:
            raise ValueError('未知识别预设操作')
        validate(after)
        store.patch(changes(current, after, ('asr',)))
        return request(env_path)
    return {'presets': current.get('presets', []), 'prompts': prompts,
            'textFields': sorted(TEXT_FIELDS), 'boolFields': sorted(BOOL_FIELDS)}
