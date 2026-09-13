"""Editor ASR uses Launcher's provider catalog, validation and credential keys."""

from dataclasses import dataclass, replace
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from maw.env_config import aliased_values
from maw.gui_config import PROVIDERS, DEFAULT_MODEL_ID, OPENAI_ASR_DEFAULT_BASE_URL, api_key_for_provider, load_env, save_env

FIELDS = {'providerId', 'modelId', 'language', 'region', 'workspaceId', 'openaiModel', 'openaiBaseUrl',
          'maxLen', 'minLen', 'maxWords', 'minWords', 'gapSplit', 'speakerColors', 'qwenAudioContext',
          'qwenAudioHotwords', 'qwenAudioVocabularyId', 'qwenAudioHotwordWeight',
          'sonioxContextGeneral', 'sonioxContextText', 'sonioxContextTerms', 'sonioxContextTranslationTerms'}
PROVIDERS_BY_ID = {provider.id: provider for provider in PROVIDERS
                   if provider.kind == 'cloud' and provider.requires_api_key and not provider.hidden}
CONNECTION_FIELDS = {'region', 'workspaceId', 'openaiBaseUrl'}


def values(env_path):
    return {**load_env(env_path), **aliased_values(os.environ)}


def catalog(env_path):
    stored = values(env_path)
    try:
        options = json.loads(stored.get('MSW_EDITOR_ASR_OPTIONS', '{}'))
    except ValueError:
        options = {}
    if not isinstance(options, dict):
        options = {}
    selected_model = stored.get('MAW_GUI_LAST_MODEL') or DEFAULT_MODEL_ID
    selected = next((p for p in PROVIDERS_BY_ID.values() if any(m.id == selected_model for m in p.models)), PROVIDERS_BY_ID['qwen'])
    defaults = {'providerId': selected.id, 'modelId': selected_model,
                'language': stored.get('MAW_GUI_LAST_LANGUAGE', stored.get('DASHSCOPE_DEFAULT_LANGUAGE', '')),
                'region': stored.get('DASHSCOPE_REGION', 'beijing'), 'workspaceId': stored.get('DASHSCOPE_WORKSPACE_ID', ''),
                'openaiModel': stored.get('MAW_OPENAI_ASR_MODEL', 'whisper-1'),
                'openaiBaseUrl': stored.get('MAW_OPENAI_ASR_BASE_URL', OPENAI_ASR_DEFAULT_BASE_URL),
                'qwenAudioVocabularyId': stored.get('DASHSCOPE_QWEN_AUDIO_VOCABULARY_ID', ''),
                'qwenAudioHotwordWeight': stored.get('DASHSCOPE_QWEN_AUDIO_HOTWORD_WEIGHT', '5')}
    defaults.update({k: v for k, v in options.items() if k in FIELDS - CONNECTION_FIELDS})
    providers = []
    for provider in PROVIDERS_BY_ID.values():
        providers.append({'id': provider.id, 'label': provider.label, 'note': provider.note,
            'hasApiKey': bool(api_key_for_provider(provider.id, env_path)),
            'models': [{'id': model.id, 'label': model.label, 'supportsContext': model.supports_context,
                        'supportsHotwords': model.supports_hotwords, 'supportsVocabulary': model.supports_vocabulary,
                        'supportsSpeaker': model.supports_speaker,
                        'languages': [{'id': k, 'label': v} for k, v in (model.languages or provider.languages)]}
                       for model in provider.models if not model.hidden],
            'regions': [{'id': k, 'label': v} for k, v in provider.regions], 'multiLanguage': provider.multi_language})
    return {'providers': providers, 'options': defaults}


@dataclass(frozen=True)
class AsrSettings:
    request: object
    recipe: dict

    @property
    def provider_id(self): return self.request.provider
    @property
    def model(self): return self.request.model
    @property
    def api_key(self): return self.request.api_key
    @property
    def base_url(self): return self.request.base_url
    reasoning_mode = ''


def resolve_settings(env_path, raw, media_path=None):
    if not isinstance(raw, dict):
        raise ValueError('ASR 配置无效')
    options = {k: v for k, v in raw.items() if k in FIELDS}
    for key, value in options.items():
        if key == 'speakerColors':
            if type(value) is not bool: raise ValueError('说话人选项必须是布尔值')
        elif not isinstance(value, str) or len(value) > 12000 or '\0' in value:
            raise ValueError('ASR 配置文本无效或过长')
    provider = PROVIDERS_BY_ID.get(options.get('providerId', 'qwen'))
    if provider is None:
        raise ValueError('此 ASR 引擎尚未接入编辑器')
    model_id = options.get('modelId') or provider.models[0].id
    if model_id not in {model.id for model in provider.models if not model.hidden}:
        raise ValueError('ASR 模型不属于所选服务')
    options.update(providerId=provider.id, modelId=model_id)
    key = raw.get('apiKey') or api_key_for_provider(provider.id, env_path)
    if not isinstance(key, str) or not key.strip() or len(key) > 4096 or any(c in key for c in '\r\n\0'):
        raise ValueError('请填写 ASR API Key，或使用启动器已保存的同一服务配置')
    stored = catalog(env_path)['options']
    # Configuration-only validation never probes media or writes output. The
    # placeholder satisfies the request shape; actual jobs always supply their
    # registered source and use the default media preflight.
    request_path = Path(media_path) if media_path is not None else Path('asr-settings.wav')
    merged = {**stored, **options, 'apiKey': key.strip(), 'mediaPath': str(request_path),
              'srtPath': str(request_path.with_suffix('.srt')), 'audioTrack': 0,
              'generateHtml': False, 'generateSpectral': False, 'debugRaw': False, 'qwenAudioHotwordsMode': 'text'}
    if provider.id == 'openai':
        url = urlsplit(merged.get('openaiBaseUrl', ''))
        if url.scheme not in {'http', 'https'} or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError('ASR API 地址无效，不能包含凭据或查询参数')
        if url.scheme == 'http' and url.hostname not in {'127.0.0.1', 'localhost', '::1'}:
            raise ValueError('云端 ASR 地址必须使用 HTTPS')
    # Only trusted media/output paths and the allowlisted editor options reach
    # this existing validator; no local model, hotword-file or postprocess path.
    from maw.gui_web import _request_from_payload, PreflightError
    try:
        request = _request_from_payload(merged, env_path, validate_media=media_path is not None)
    except PreflightError as error:
        raise ValueError(str(error)) from error
    request = replace(request, generate_waveform=False, generate_html=False, generate_spectral=False,
                      debug_raw=False, postprocess_plan=None, postprocess_llm_settings=None, length_limit='')
    configured = values(env_path)
    overrides = {key: str(configured.get(key, default)) for key, default in {
        'DASHSCOPE_ENABLE_WORDS': 'true', 'DASHSCOPE_ENABLE_ITN': 'false',
        'DASHSCOPE_FUNASR_VOCABULARY_ID': '', 'SONIOX_POLL_INTERVAL': '3', 'SONIOX_POLL_TIMEOUT': '1800',
        'FFMPEG_PATH': ''}.items()}
    overrides.update(DASHSCOPE_DEFAULT_LANGUAGE=request.language, DASHSCOPE_WORKSPACE_ID=request.workspace_id,
                     DASHSCOPE_QWEN_AUDIO_CONTEXT_FILE='')
    request = replace(request, environment_overrides=overrides)
    recipe = {key: getattr(request, key) for key in ('provider', 'model', 'language', 'region', 'workspace_id',
              'max_len', 'min_len', 'max_words', 'min_words', 'gap_split', 'strip_tail_punct', 'speaker_colors',
              'qwen_audio_context', 'qwen_audio_hotwords', 'qwen_audio_vocabulary_id', 'qwen_audio_hotword_weight',
              'soniox_context', 'base_url')}
    recipe['environment'] = {key: value for key, value in overrides.items() if key != 'FFMPEG_PATH'}
    return AsrSettings(request, recipe)


def save_settings(env_path, raw, media_path=None, *, section=None):
    if not isinstance(raw, dict):
        raise ValueError('ASR 配置无效')
    if section not in {None, 'environment', 'call'}:
        raise ValueError('ASR 配置分区无效')
    if section == 'environment':
        raw = {key: value for key, value in raw.items() if key in CONNECTION_FIELDS | {'providerId', 'apiKey'}}
    elif section == 'call':
        raw = {key: value for key, value in raw.items() if key in FIELDS - CONNECTION_FIELDS}
    settings = resolve_settings(env_path, raw, media_path)
    request = settings.request
    provider = PROVIDERS_BY_ID[request.provider]
    options = {key: value for key, value in raw.items() if key in FIELDS}
    if section == 'environment':
        updates = {provider.models[0].env_key: request.api_key}
        if request.provider == 'qwen':
            updates.update(DASHSCOPE_REGION=request.region, DASHSCOPE_WORKSPACE_ID=request.workspace_id)
        elif request.provider == 'openai':
            updates['MAW_OPENAI_ASR_BASE_URL'] = request.base_url
        save_env(env_path, updates)
        return catalog(env_path)
    if section == 'call':
        save_env(env_path, {'MSW_EDITOR_ASR_OPTIONS': json.dumps(options, ensure_ascii=False),
                            'MAW_GUI_LAST_MODEL': options.get('modelId', provider.models[0].id),
                            'MAW_GUI_LAST_LANGUAGE': request.language,
                            **({'MAW_OPENAI_ASR_MODEL': request.model} if request.provider == 'openai' else {})})
        return catalog(env_path)
    updates = {provider.models[0].env_key: request.api_key,
               'MAW_GUI_LAST_MODEL': options.get('modelId', provider.models[0].id),
               'MAW_GUI_LAST_LANGUAGE': request.language,
               'MSW_EDITOR_ASR_OPTIONS': json.dumps(options, ensure_ascii=False)}
    if request.provider == 'qwen':
        updates.update(DASHSCOPE_REGION=request.region, DASHSCOPE_WORKSPACE_ID=request.workspace_id,
                       DASHSCOPE_DEFAULT_LANGUAGE=request.language)
    elif request.provider == 'openai':
        updates.update(MAW_OPENAI_ASR_BASE_URL=request.base_url, MAW_OPENAI_ASR_MODEL=request.model)
    save_env(env_path, updates)
    return catalog(env_path)
