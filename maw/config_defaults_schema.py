"""Structural storage contract usable by ASR/OCR workers without loading TTS engines.

Transfer and engine adapters additionally run their owning module's value validators.
"""
RECIPE_KEYS = {
    'qwen': 'provider region model_type model language_type instructions optimize_instructions',
    'edge': 'provider model voice language_type rate volume pitch',
    'yukkuri': 'provider model voice language_type speed',
    'indextts': 'provider model language_type emotion_mode emotion_weight emotion_vector emotion_text emotion_random duration_factor max_text_tokens_per_segment do_sample top_p top_k temperature length_penalty num_beams repetition_penalty max_mel_tokens',
    'gpt-sovits': 'provider model language_type speed_factor text_split_method top_k top_p temperature seed repetition_penalty sample_steps super_sampling',
    'minimax': 'provider region model language_type speed volume pitch emotion',
    'mossland': 'provider model language_type',
}


def recipe(provider, raw):
    if provider not in RECIPE_KEYS or not isinstance(raw, dict) or set(raw) != set(RECIPE_KEYS[provider].split()):
        raise ValueError('配音配方字段无效')
    if raw.get('provider') != provider:
        raise ValueError('配音配方引擎不匹配')


def validate(raw):
    if not isinstance(raw, dict) or set(raw) - {'tts', 'postprocess', 'recovery'}:
        raise ValueError('处理默认值分类无效')
    if 'tts' in raw:
        tts = raw['tts']
        if not isinstance(tts, dict) or set(tts) - set(RECIPE_KEYS) - {'engine', 'presets'}:
            raise ValueError('配音默认值无效')
        if 'engine' in tts and (not isinstance(tts['engine'], str) or tts['engine'] not in RECIPE_KEYS):
            raise ValueError('配音引擎无效')
        for provider, value in tts.items():
            if provider not in ('engine', 'presets'):
                recipe(provider, value)
        libraries = tts.get('presets', {})
        if not isinstance(libraries, dict) or set(libraries) - {'indextts', 'gpt-sovits'}:
            raise ValueError('配音预设库无效')
        for provider, library in libraries.items():
            if not isinstance(library, dict) or len(library) > 100:
                raise ValueError('配音预设库无效')
            for name, item in library.items():
                if not isinstance(name, str) or not 1 <= len(name) <= 80:
                    raise ValueError('配音预设名称无效')
                recipe(provider, item)
    if 'postprocess' in raw:
        value = raw['postprocess']
        allowed = {'version', 'enabled', 'retainIntermediate', 'exportSrt', 'exportTranslatedSrt',
                   'exportBilingualSrt', 'outputSemantics', 'waveformDraft', 'steps'}
        if not isinstance(value, dict) or set(value) - allowed or not isinstance(value.get('steps'), list) or len(value['steps']) > 6:
            raise ValueError('处理流程无效')
        for step in value['steps']:
            if not isinstance(step, dict) or not isinstance(step.get('id'), str) or step['id'] not in {'match', 'replace', 'proofread', 'resegment', 'ocr', 'translate'}:
                raise ValueError('处理步骤无效')
            if any(key.lower().endswith('path') or key == 'trackScope' for key in step):
                raise ValueError('处理默认值不能包含文件路径或轨道范围')
    if 'recovery' in raw:
        value = raw['recovery']
        if (not isinstance(value, dict) or set(value) != {'enabled', 'interval', 'limit'}
                or type(value['enabled']) is not bool or type(value['interval']) is not int
                or not 30 <= value['interval'] <= 86400 or type(value['limit']) is not int
                or not 1 <= value['limit'] <= 1000):
            raise ValueError('备份策略无效')
