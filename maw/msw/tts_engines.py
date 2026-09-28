"""Small, explicit dispatch table for the editor's implemented TTS engines.

Recipes stay engine-owned; credentials and local launch configuration never
become part of generation metadata. New services are not synthesis engines
until their adapter is implemented.
"""

from dataclasses import dataclass
from importlib import import_module


@dataclass(frozen=True)
class Engine:
    id: str
    label: str
    module: str
    text_limit: int = 600
    pronunciation: bool = False
    local_service: bool = False


ENGINES = {
    'qwen': Engine('qwen', '百炼 Qwen TTS', 'tts'),
    'yukkuri': Engine('yukkuri', '油库里', 'yukkuri', pronunciation=True),
    'indextts': Engine('indextts', 'IndexTTS', 'index_tts', pronunciation=True, local_service=True),
    'gpt-sovits': Engine('gpt-sovits', 'GPT-SoVITS', 'gpt_sovits', local_service=True),
    'edge': Engine('edge', 'Edge TTS', 'edge_tts'),
    'minimax': Engine('minimax', 'MiniMax TTS', 'minimax_tts', pronunciation=True),
    'mossland': Engine('mossland', 'Mossland TTS', 'mossland_tts'),
}


def engine(identity):
    if not isinstance(identity, str) or identity not in ENGINES:
        raise ValueError('不支持的 TTS 引擎，请选择已接入的服务')
    return ENGINES[identity]


def provider(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get('recipe', {}), dict):
        raise ValueError('TTS 配置格式无效')
    # Missing provider is the original Bailian recipe, not an unknown engine.
    return engine(raw.get('recipe', {}).get('provider', 'qwen'))


def capabilities():
    return [{'id': e.id, 'label': e.label, 'text_limit': e.text_limit,
             'pronunciation': e.pronunciation, 'local_service': e.local_service} for e in ENGINES.values()]


def resolve(api, raw):
    selected = provider(raw)
    module = import_module('maw.msw.' + selected.module)
    if selected.id in {'minimax', 'mossland'}:
        return api.cloud_tts(selected.id).resolve(raw)
    if selected.id == 'edge':
        return api.edge_tts.resolve(raw)
    if selected.id == 'gpt-sovits':
        return api.gpt_sovits.resolve(raw)
    if selected.id == 'indextts':
        return api.index_tts.resolve(raw)
    if selected.id == 'yukkuri':
        return module.resolve_settings(api.yukkuri, raw)
    settings = module.resolve_settings(api.env_path, raw)
    if settings.recipe.get('model_type') != 'CustomVoice':
        api.qwen_voices.validate_voice(settings)
    return settings


def save(api, raw, *, select=False):
    selected = provider(raw)
    if selected.id in {'minimax', 'mossland'}:
        api.cloud_tts(selected.id).save(raw)
    elif selected.id == 'edge':
        api.edge_tts.save(raw)
    elif selected.id == 'gpt-sovits':
        api.gpt_sovits.save(raw)
    elif selected.id == 'indextts':
        api.index_tts.save(raw)
    elif selected.id == 'yukkuri':
        api.yukkuri.save(engine='yukkuri' if select else api.yukkuri.payload()['engine'], recipe=raw['recipe'])
    else:
        import_module('maw.msw.tts').save_settings(api.env_path, raw)
        if select:
            api.yukkuri.save(engine='qwen')
    if select:
        api.tts_engine(selected.id)


def synthesize(settings, entry, cancel, qwen_synthesize):
    selected = engine(settings.provider_id)
    spoken = entry.get('spoken_text') or entry.get('pronunciation_override') or entry['text']
    if selected.id == 'yukkuri':
        return import_module('maw.msw.yukkuri').synthesize(settings, spoken, cancel, prepared=bool(entry.get('spoken_text')))
    if len(spoken) > selected.text_limit:
        raise ValueError(f'{selected.label} 原始读音超过 {selected.text_limit} 字符，请先拆分')
    if selected.id == 'qwen':
        spoken = entry['text']
        audio = qwen_synthesize(settings, spoken, cancel)
    else:
        audio = import_module('maw.msw.' + selected.module).synthesize(settings, spoken, cancel)
    return audio, spoken
