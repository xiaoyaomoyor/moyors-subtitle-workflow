"""Machine-local model directories shared by the Launcher and editor."""

import json

KEY = 'msw.local-model-paths.v1'


def normalize_paths(raw):
    from maw.gui_config import provider_by_id
    allowed = {model.id for model in provider_by_id('local').models}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise ValueError('模型目录配置无效')
    result = {}
    for model_id, path in raw.items():
        if not isinstance(path, str) or len(path) > 12000 or any(c in path for c in '\0\r\n'):
            raise ValueError('模型目录无效或过长')
        result[model_id] = path.strip()
    return result


def load_model_paths(env_path, *, stored=None):
    from maw.gui_config import load_env
    from maw.user_config import UserConfig, config_path
    saved = UserConfig(config_path(env_path)).read()['sections'].get('browser', {}).get(KEY, {})
    result = normalize_paths(saved)
    # Preserve the previous editor's single-model setting until explicitly
    # replaced. An empty saved entry deliberately overrides the legacy value.
    try:
        legacy = json.loads((load_env(env_path) if stored is None else stored).get('MSW_EDITOR_ASR_OPTIONS', '{}'))
        if isinstance(legacy, dict) and legacy.get('modelId') not in result and legacy.get('localModelPath'):
            result.update(normalize_paths({legacy.get('modelId'): legacy['localModelPath']}))
    except (ValueError, TypeError):
        pass
    return result


def save_model_paths(env_path, updates):
    from maw.user_config import UserConfig, changes, config_path
    updates = normalize_paths(updates)
    store = UserConfig(config_path(env_path))
    previous = store.read()['sections'].get('browser', {}).get(KEY, {})
    # Leaf-level patches preserve paths changed by the other application window.
    store.patch(changes(previous, {**previous, **updates}, ['browser', KEY]))
