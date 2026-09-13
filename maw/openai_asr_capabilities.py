"""Conservative endpoint/model contracts for timestamped subtitle transcription."""

from urllib.parse import urlsplit

PRESETS = frozenset({'whisper-1', 'whisper-large-v3', 'whisper-large-v3-turbo',
                     'gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe',
                     'gpt-4o-transcribe-diarize'})
TEXT_MODELS = frozenset({'gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'})


def endpoint_family(base_url):
    host = (urlsplit(base_url).hostname or '').lower().rstrip('.')
    if host == 'api.openai.com':
        return 'openai'
    if host in {'openrouter.ai', 'www.openrouter.ai'}:
        return 'openrouter'
    return 'compatible'


def model_for_endpoint(base_url, model, *, preset=True):
    value = model.strip()
    if preset and endpoint_family(base_url) == 'openrouter' and value in PRESETS:
        return 'openai/' + value
    return value


def capabilities(base_url, model):
    family = endpoint_family(base_url)
    alias = model.removeprefix('openai/')
    diarize = alias == 'gpt-4o-transcribe-diarize'
    supported = True
    if family == 'openai':
        supported = model in {'whisper-1', 'gpt-4o-transcribe-diarize'}
    elif family == 'openrouter':
        supported = alias not in TEXT_MODELS and not diarize
    return {'timestamps': supported, 'prompt': not diarize,
            'keywords': not diarize and (alias == 'gpt-transcribe' or alias not in PRESETS),
            'diarize': diarize, 'customDiarize': family == 'compatible' and alias not in PRESETS,
            'granularities': alias.startswith('whisper'), 'family': family}


def validate_options(base_url, model, prompt='', keywords=(), diarize=False):
    caps = capabilities(base_url, model)
    if not caps['timestamps']:
        raise ValueError('当前接口的此模型没有可用的可靠字幕时间戳；请选择 Whisper、官方 diarize 或提供时间戳的自定义接口。')
    if diarize and not (caps['diarize'] or caps['customDiarize']):
        raise ValueError('此模型不支持 diarized_json；请切换到说话人分离模型。')
    diarize = diarize or caps['diarize']
    if diarize and (prompt.strip() or any(keywords)):
        raise ValueError('diarize 不支持 Prompt 或 Keywords。')
    if any(keywords) and not caps['keywords']:
        raise ValueError('此模型不支持 Keywords，请使用 Prompt。')
    if any(any(c in word for c in '<>\r\n\0') for word in keywords):
        raise ValueError('OpenAI Keywords 不能包含 <、>、空字符或换行。')
    return diarize
