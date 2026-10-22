"""Portable processing defaults; connection details and resources stay engine-owned."""
from __future__ import annotations

import copy
import json
from importlib import import_module
from pathlib import Path

RECIPE_MODULES = {'qwen': 'tts', 'edge': 'edge_tts', 'yukkuri': 'yukkuri_runtime',
                  'indextts': 'index_tts', 'gpt-sovits': 'gpt_sovits',
                  'minimax': 'minimax_tts', 'mossland': 'mossland_tts'}
RESOURCE_FIELDS = {'voice', 'speaker_ref', 'emotion_ref', 'aux_refs', 'gpt_model', 'sovits_model',
                   'prompt_text', 'prompt_lang', 'no_prompt'}


def public_recipe(provider, raw):
    if provider not in RECIPE_MODULES or not isinstance(raw, dict):
        raise ValueError('配音配方无效')
    module = import_module('maw.msw.' + RECIPE_MODULES[provider])
    allowed = set(module.DEFAULT_RECIPE) - RESOURCE_FIELDS
    if provider in ('edge', 'yukkuri'):
        allowed.add('voice')  # Public catalog, independent of the user's account.
    # Run the engine validator on a default resource configuration, not private IDs.
    candidate = {key: copy.deepcopy(value) for key, value in raw.items() if key in allowed}
    if provider == 'qwen':
        candidate['voice'] = ''
    kwargs = {'require_voice': False} if provider in ('qwen', 'minimax', 'mossland') else {}
    validated = module.validate_recipe(candidate, **kwargs)
    return {key: validated[key] for key in allowed}


def public_plan(raw):
    from maw.postprocess_pipeline import normalize_plan
    plan = normalize_plan(raw)
    allowed = {'version', 'enabled', 'retainIntermediate', 'exportSrt', 'exportTranslatedSrt',
               'exportBilingualSrt', 'outputSemantics', 'waveformDraft', 'steps'}
    result = {key: value for key, value in plan.items() if key in allowed}
    for step in result['steps']:
        for key in ('scriptPath', 'videoPath', 'videoPathMode'):
            step.pop(key, None)
    return result


def validate(raw):
    if not isinstance(raw, dict) or set(raw) - {'tts', 'postprocess', 'recovery'}:
        raise ValueError('处理默认值分类无效')
    if 'tts' in raw:
        tts = raw['tts']
        if not isinstance(tts, dict) or set(tts) - set(RECIPE_MODULES) - {'engine', 'presets'}:
            raise ValueError('配音默认值无效')
        if 'engine' in tts and tts['engine'] not in RECIPE_MODULES:
            raise ValueError('配音引擎无效')
        for key, value in tts.items():
            if key not in ('engine', 'presets') and public_recipe(key, value) != value:
                raise ValueError('配音配方含无效参数或本机资源引用')
        libraries = tts.get('presets', {})
        if not isinstance(libraries, dict) or set(libraries) - {'indextts', 'gpt-sovits'}:
            raise ValueError('配音预设库无效')
        for provider, library in libraries.items():
            if (not isinstance(library, dict) or len(library) > 100
                    or any(not isinstance(name, str) or not 1 <= len(name) <= 80
                           or public_recipe(provider, item) != item for name, item in library.items())):
                raise ValueError('配音预设内容无效')
    if 'postprocess' in raw and public_plan(raw['postprocess']) != raw['postprocess']:
        raise ValueError('处理流程含无效参数或文件／轨道引用')
    if 'recovery' in raw:
        value = raw['recovery']
        if (not isinstance(value, dict) or set(value) != {'enabled', 'interval', 'limit'}
                or type(value['enabled']) is not bool or type(value['interval']) is not int
                or not 30 <= value['interval'] <= 86400 or type(value['limit']) is not int
                or not 1 <= value['limit'] <= 1000):
            raise ValueError('备份策略无效')


def value(store, key, original, *, save=False):
    """Single owner for public fields, preserving machine-only fields in their old store."""
    public = public_plan(original) if key == 'postprocess' else copy.deepcopy(original)
    path = ['defaults', key]
    if save:
        store.update(path, public)
        return public
    snapshot = store.migrate({'defaults': {key: public}}, 'processing-defaults')
    return copy.deepcopy(snapshot['sections'].get('defaults', {}).get(key, public))


def recipe(root, provider, original, *, save=False):
    from maw.user_config import UserConfig
    store = UserConfig(Path(root) / 'user-settings.mswconfig')
    public = public_recipe(provider, original)
    if save:
        store.update(['defaults', 'tts', provider], public)
    else:
        snapshot = store.migrate({'defaults': {'tts': {provider: public}}}, 'recipe-' + provider)
        public = snapshot['sections'].get('defaults', {}).get('tts', {}).get(provider, public)
    return {**original, **public}


def presets(root, provider, original, *, save=False):
    from maw.user_config import UserConfig
    store = UserConfig(Path(root) / 'user-settings.mswconfig')
    public = {name: public_recipe(provider, item) for name, item in original.items()}
    if save:
        store.update(['defaults', 'tts', 'presets', provider], public)
    else:
        snapshot = store.migrate({'defaults': {'tts': {'presets': {provider: public}}}}, 'recipe-presets-' + provider)
        public = snapshot['sections'].get('defaults', {}).get('tts', {}).get('presets', {}).get(provider, public)
    module = import_module('maw.msw.' + RECIPE_MODULES[provider])
    return {name: module.validate_recipe({**original.get(name, {}), **item}) for name, item in public.items()}


def plan(env_path, original, *, save=False):
    from maw.user_config import UserConfig, config_path
    defaults = value(UserConfig(config_path(env_path)), 'postprocess', original, save=save)
    # Keep this machine's file dependencies; imported plans never supply paths.
    steps = {s['id']: s for s in original.get('steps', [])}
    return {**original, **defaults, 'steps': [{**steps.get(s['id'], {}), **s} for s in defaults['steps']]}


def seed(store, env_path=None):
    """Fill defaults from existing public settings before a transfer, without resource scans."""
    root = store.path.parent
    existing = store.read()['sections'].get('defaults', {})
    folders = {'edge': 'edge-tts', 'indextts': 'index-tts', 'gpt-sovits': 'gpt-sovits',
               'yukkuri': 'yukkuri', 'minimax': 'minimax', 'mossland': 'mossland'}
    for provider, folder in folders.items():
        path = root / folder / 'settings.json'
        if provider not in existing.get('tts', {}) and path.is_file():
            if path.stat().st_size > 4 * 1024 * 1024:
                raise ValueError('旧配音配置过大')
            raw = json.loads(path.read_text(encoding='utf-8-sig'))
            recipe(root, provider, raw.get('recipe', {}))
        library_path = root / folder / 'presets.json'
        if (provider in ('indextts', 'gpt-sovits')
                and provider not in existing.get('tts', {}).get('presets', {}) and library_path.is_file()):
            if library_path.stat().st_size > 4 * 1024 * 1024:
                raise ValueError('旧配音预设库过大')
            presets(root, provider, json.loads(library_path.read_text(encoding='utf-8-sig')))
    if env_path is not None:
        from maw.gui_config import load_env
        from maw.postprocess_pipeline import load_postprocess_config, postprocess_config_path
        values = load_env(env_path)
        if 'qwen' not in existing.get('tts', {}) and values.get('MSW_TTS_RECIPE'):
            recipe(root, 'qwen', json.loads(values['MSW_TTS_RECIPE']))
        if 'recovery' not in existing:
            backup = json.loads(values.get('MSW_EDITOR_VERSION_BACKUP', '{}'))
            value(store, 'recovery', {'enabled': backup.get('enabled', True),
                                    'interval': backup.get('interval', 300), 'limit': backup.get('limit', 20)})
        if 'postprocess' not in existing:
            value(store, 'postprocess', load_postprocess_config(postprocess_config_path(env_path))['plan'])
    path = root / 'tts-engine.json'
    if 'engine' not in existing.get('tts', {}) and path.is_file():
        raw = json.loads(path.read_text(encoding='utf-8'))
        engine = raw.get('engine', 'qwen')
        if engine in RECIPE_MODULES:
            store.migrate({'defaults': {'tts': {'engine': engine}}}, 'tts-engine')
