"""IndexTTS settings, immutable local references and the editor TTS adapter."""

from __future__ import annotations

import base64
import copy
import json
import math
import re
import threading
from dataclasses import dataclass
from pathlib import Path

from maw.msw.assets import atomic_bytes, audio_info, normalize_generated_wav
from maw.msw.audio_import import FORMATS, MAX_INPUT_BYTES
from maw.msw.index_protocol import IndexClient, service_url, unwrap
from maw.msw.tts import TtsServiceError

DEFAULT_URL = 'http://127.0.0.1:7860'
MODES = ['follow', 'audio', 'vector', 'text']
DEFAULT_RECIPE = {
    'provider': 'indextts', 'model': 'index-tts-2.5', 'voice': '', 'language_type': 'ZH',
    'speaker_ref': '', 'emotion_ref': '', 'emotion_mode': 'follow', 'emotion_weight': 0.65,
    'emotion_vector': [0.0] * 8, 'emotion_text': '', 'emotion_random': False,
    'duration_factor': 1.0, 'max_text_tokens_per_segment': 120, 'do_sample': True,
    'top_p': 0.8, 'top_k': 30, 'temperature': 0.8, 'length_penalty': 0.0,
    'num_beams': 3, 'repetition_penalty': 10.0, 'max_mel_tokens': 1500,
}
RANGES = {'emotion_weight': (0, 1), 'duration_factor': (0.5, 2),
          'max_text_tokens_per_segment': (20, 600), 'top_p': (0, 1), 'top_k': (0, 100),
          'temperature': (0.1, 2), 'length_penalty': (-2, 2), 'num_beams': (1, 10),
          'repetition_penalty': (0.1, 20), 'max_mel_tokens': (50, 1815)}
INTEGERS = {'max_text_tokens_per_segment', 'top_k', 'num_beams', 'max_mel_tokens'}


def ref_id(value):
    return isinstance(value, str) and re.fullmatch(r'ref-[0-9a-f]{64}', value)


def validate_recipe(raw):
    if not isinstance(raw, dict):
        raise ValueError('IndexTTS 配置格式无效')
    recipe = {key: copy.deepcopy(raw.get(key, value)) for key, value in DEFAULT_RECIPE.items()}
    if recipe['provider'] != 'indextts' or recipe['model'] != 'index-tts-2.5':
        raise ValueError('不支持的 IndexTTS 模型')
    if recipe['language_type'] not in {'ZH', 'EN', 'JA', 'AR', 'ES'} or recipe['emotion_mode'] not in MODES:
        raise ValueError('IndexTTS 语言或情感模式无效')
    for key in ('speaker_ref', 'emotion_ref'):
        if not isinstance(recipe[key], str) or (recipe[key] and not ref_id(recipe[key])):
            raise ValueError('IndexTTS 参考音频标识无效')
    for key, (minimum, maximum) in RANGES.items():
        value = recipe[key]
        if (type(value) not in (int, float) or not math.isfinite(value) or not minimum <= value <= maximum
                or (key in INTEGERS and type(value) is not int)):
            raise ValueError(f'IndexTTS {key} 须在 {minimum}–{maximum} 范围内' + ('且为整数' if key in INTEGERS else ''))
    vector = recipe['emotion_vector']
    if not isinstance(vector, list) or len(vector) != 8 or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in vector):
        raise ValueError('情感向量须为八个 0–1 的数值')
    for key in ('do_sample', 'emotion_random'):
        if type(recipe[key]) is not bool:
            raise ValueError('IndexTTS 开关值无效')
    if not isinstance(recipe['emotion_text'], str) or len(recipe['emotion_text']) > 600:
        raise ValueError('情感描述请限制在 600 字符以内')
    recipe['voice'] = ''  # Derived from the local reference; never trust client labels.
    return recipe


@dataclass(frozen=True)
class IndexSettings:
    recipe: dict
    base_url: str
    timeout: int
    controller: object
    api_key = ''
    provider_id = 'indextts'
    reasoning_mode = 'off'
    model = 'index-tts-2.5'


class IndexTts:
    def __init__(self, root, converter):
        self.root = Path(root) / 'index-tts'
        self.converter = converter
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.capability = None
        self.capability_url = None

    def read(self, name, default):
        path = self.root / name
        try:
            if path.stat().st_size > 4 * 1024 * 1024:
                return copy.deepcopy(default)
            return json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return copy.deepcopy(default)

    def write(self, name, value):
        atomic_bytes(self.root / name, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())

    def settings(self):
        raw = self.read('settings.json', {})
        try:
            recipe = validate_recipe(raw.get('recipe', {}))
            url, timeout = self.connection(raw)
            return {'service_url': url, 'timeout': timeout, 'recipe': self.decorate(recipe)}
        except (ValueError, AttributeError):
            return {'service_url': DEFAULT_URL, 'timeout': 600, 'recipe': copy.deepcopy(DEFAULT_RECIPE)}

    def connection(self, raw):
        timeout = raw.get('timeout', 600)
        if type(timeout) is not int or not 60 <= timeout <= 3600:
            raise ValueError('IndexTTS 等待时间须为 60–3600 秒')
        return service_url(raw.get('service_url', DEFAULT_URL)), timeout

    def references(self):
        value = self.read('references.json', [])
        return [v for v in value if isinstance(v, dict) and ref_id(v.get('id'))] if isinstance(value, list) else []

    def reference(self, identity):
        if not ref_id(identity):
            raise ValueError('请先选择 IndexTTS 音色参考音频')
        item = next((r for r in self.references() if r['id'] == identity), None)
        path = self.root / 'references' / (identity + '.wav')
        if not item or not path.is_file():
            raise ValueError('IndexTTS 参考音频在本机不存在，请重新选择或上传')
        data = path.read_bytes() if path.stat().st_size <= MAX_INPUT_BYTES else b''
        if audio_info(data)['sha256'] != identity[4:]:
            raise ValueError('IndexTTS 参考音频校验失败，请重新上传')
        return item, data

    def store_reference(self, name, audio, suffix='.wav'):
        if not isinstance(name, str) or not 1 <= len(name) <= 255 or any(c in name for c in '/\\\x00\r\n'):
            raise ValueError('参考音频名称无效')
        if suffix not in FORMATS or not 1 <= len(audio) <= MAX_INPUT_BYTES:
            raise ValueError('请选择不超过 32 MiB 的 WAV、MP3、FLAC、M4A、AAC、OGG 或 Opus 音频')
        if self.cancel.is_set():
            raise ValueError('编辑器正在关闭')
        audio = self.converter(normalize_generated_wav(audio) if suffix == '.wav' else audio, suffix)
        info = audio_info(audio)
        identity = 'ref-' + info['sha256']
        with self.lock:
            entries = self.references()
            existing = next((r for r in entries if r['id'] == identity), None)
            if not existing and len(entries) >= 1000:
                raise ValueError('参考库已达到 1000 个文件的限制')
            item = existing or {'id': identity, 'name': name, **info}
            atomic_bytes(self.root / 'references' / (identity + '.wav'), audio)
            if not existing:
                self.write('references.json', [*entries, item])
            return item

    def decorate(self, recipe):
        value = copy.deepcopy(recipe)
        for key in ('speaker_ref', 'emotion_ref'):
            item = next((r for r in self.references() if r['id'] == value[key]), None)
            if item:
                value[key + '_name'] = item['name']
                value[key + '_sha256'] = item['sha256']
                if key == 'speaker_ref':
                    value['voice'] = item['name']
        return value

    def payload(self):
        settings = self.settings()
        return {**settings, 'references': self.references(), 'presets': self.read('presets.json', {}),
                'capability': self.public_capability() if self.capability_url == settings['service_url'] else None}

    def public_capability(self):
        if not self.capability:
            return None
        cap = self.capability
        return {key: copy.deepcopy(cap[key]) for key in ('voices', 'emotion_examples', 'presets', 'languages',
                                                       'text_emotion', 'max_mel_tokens', 'max_text_tokens_per_segment', 'gradio_version')}

    def check_service(self, raw):
        url, timeout = self.connection(raw)
        with IndexClient(url, self.cancel, timeout=min(timeout, 60)) as client:
            cap = client.capabilities()
        voices, emotion, seen, seen_emotion = [], [], set(), set()
        for index, row in enumerate(cap['samples']):
            if not isinstance(row, list) or len(row) < 15:
                continue
            name = str(row[0]).replace('\\', '/').rsplit('/', 1)[-1]
            if name and name not in seen:
                seen.add(name)
                voices.append({'index': index, 'name': name, 'language': row[14]})
            emo_name = str(row[3] or '').replace('\\', '/').rsplit('/', 1)[-1]
            if emo_name and emo_name not in seen_emotion:
                seen_emotion.add(emo_name)
                emotion.append({'index': index, 'name': emo_name})
        cap.update(voices=voices, emotion_examples=emotion, text_emotion=len(cap['modes']) >= 4)
        with self.lock:
            self.capability, self.capability_url = cap, url
        return {'capability': self.public_capability(), 'service_url': url}

    def save(self, raw):
        url, timeout = self.connection(raw)
        recipe = self.decorate(validate_recipe(raw.get('recipe', {})))
        with self.lock:
            self.write('settings.json', {'service_url': url, 'timeout': timeout, 'recipe': recipe})
        return self.payload()

    def resolve(self, raw):
        saved = self.settings()
        url, timeout = self.connection({**saved, **raw})
        recipe = self.decorate(validate_recipe(raw.get('recipe', saved['recipe'])))
        self.reference(recipe['speaker_ref'])
        if recipe['emotion_mode'] == 'audio':
            self.reference(recipe['emotion_ref'])
        if self.capability_url != url or not self.capability:
            raise ValueError('请先连接并检测 IndexTTS 服务')
        if recipe['emotion_mode'] == 'text' and not self.capability['text_emotion']:
            raise ValueError('当前 IndexTTS 未加载 QwenEmotion；启用 --qwen_emo 并重启该服务后重新检测')
        for key in ('max_mel_tokens', 'max_text_tokens_per_segment'):
            if recipe[key] > self.capability[key]:
                raise ValueError(f'{key} 超过当前 IndexTTS 服务上限 {self.capability[key]}')
        return IndexSettings(recipe, url, timeout, self)

    def action(self, raw):
        action = raw.get('action')
        if action == 'check':
            return self.check_service(raw)
        if action == 'upload':
            name, encoded = raw.get('filename'), raw.get('audio_base64')
            if not isinstance(name, str) or not isinstance(encoded, str) or len(encoded) > (MAX_INPUT_BYTES + 2) // 3 * 4:
                raise ValueError('参考音频上传无效或超过 32 MiB')
            try:
                audio = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise ValueError('参考音频上传数据无效') from None
            return {'reference': self.store_reference(name, audio, Path(name).suffix.lower()), 'references': self.references()}
        if action in {'save_preset', 'rename_preset', 'delete_preset'}:
            name = raw.get('name', '')
            if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
                raise ValueError('预设名称须为 1–80 字符')
            name = name.strip()
            with self.lock:
                presets = self.read('presets.json', {})
                if action == 'save_preset':
                    if name not in presets and len(presets) >= 100:
                        raise ValueError('最多保存 100 个本机配音预设')
                    presets[name] = self.decorate(validate_recipe(raw.get('recipe')))
                else:
                    if name not in presets:
                        raise ValueError('本机预设不存在，请刷新配置')
                    if action == 'rename_preset':
                        new_name = raw.get('new_name', '')
                        if not isinstance(new_name, str) or not 1 <= len(new_name.strip()) <= 80:
                            raise ValueError('请输入 1–80 字符且未使用的预设名称')
                        new_name = new_name.strip()
                        if new_name != name and new_name in presets:
                            raise ValueError('请输入 1–80 字符且未使用的预设名称')
                        if new_name != name:
                            presets[new_name] = presets.pop(name)
                    else:
                        del presets[name]
                self.write('presets.json', presets)
            return {'presets': presets}
        url, timeout = self.connection({**self.settings(), **raw})
        if self.capability_url != url or not self.capability:
            raise ValueError('请先连接并检测 IndexTTS 服务')
        with IndexClient(url, self.cancel, min(timeout, 60)) as client:
            cap = client.capabilities()
            if action == 'example':
                index, kind = raw.get('index'), raw.get('kind', 'speaker')
                if type(index) is not int or not 0 <= index < len(cap['samples']) or kind not in {'speaker', 'emotion'}:
                    raise ValueError('官方示例选择无效，请重新检测服务')
                row = cap['samples'][index]
                position = 0 if kind == 'speaker' else 3
                name = str(row[position]).replace('\\', '/').rsplit('/', 1)[-1]
                result = client.call('on_example_click', [index])
                item = self.store_reference(name, client.download(result[position]))
                return {'reference': item, 'references': self.references()}
            if action == 'server_preset':
                name = raw.get('name')
                if name not in cap['presets']:
                    raise ValueError('服务预设不存在，请重新检测')
                result = [unwrap(v) for v in client.call('on_preset_load', [name])]
                if client.warned:
                    # Official WebUI can silently reset a text-emotion preset to
                    # mode 0 or drop missing references while returning success.
                    raise TtsServiceError('IndexTTS 载入预设时发出警告，未应用该预设；请在其服务窗口检查参考文件或 QwenEmotion 是否可用')
                if len(result) != 24:
                    raise TtsServiceError('IndexTTS 预设接口不兼容')
                recipe = validate_recipe(raw.get('recipe', {}))
                mode = result[1]
                if isinstance(mode, str):
                    mode = cap['modes'].index(mode)
                if type(mode) is not int or not 0 <= mode < len(cap['modes']):
                    raise ValueError('此预设的情感模式在当前服务不可用')
                recipe.update(emotion_mode=MODES[mode], emotion_weight=result[4], emotion_vector=result[5:13],
                              emotion_text=result[13], emotion_random=result[14])
                for key, value in zip(['do_sample', 'top_p', 'top_k', 'temperature', 'length_penalty', 'num_beams',
                                       'repetition_penalty', 'max_mel_tokens', 'max_text_tokens_per_segment'], result[15:]):
                    recipe[key] = int(value) if key in INTEGERS else value
                for key, pos in [('speaker_ref', 2), ('emotion_ref', 3)]:
                    recipe[key] = self.store_reference(name + ('-音色.wav' if pos == 2 else '-情感.wav'), client.download(result[pos]))['id'] if result[pos] else ''
                return {'recipe': self.decorate(validate_recipe(recipe)), 'references': self.references()}
        raise ValueError('不支持的 IndexTTS 操作')

    def close(self):
        self.cancel.set()


def synthesize(settings, text, cancel):
    recipe = settings.recipe
    with IndexClient(settings.base_url, cancel, settings.timeout) as client:
        cap = client.capabilities()
        mode = MODES.index(recipe['emotion_mode'])
        if mode >= len(cap['modes']):
            raise TtsServiceError('IndexTTS 当前未加载文本情感模型，请启用 --qwen_emo 后重新检测')
        speaker = client.upload(settings.controller.reference(recipe['speaker_ref'])[1])
        emotion = client.upload(settings.controller.reference(recipe['emotion_ref'])[1]) if mode == 1 else None
        data = [cap['modes'][mode], speaker, text, recipe['language_type'], emotion, recipe['emotion_weight'],
                *recipe['emotion_vector'], recipe['emotion_text'], recipe['emotion_random'],
                recipe['max_text_tokens_per_segment'], recipe['duration_factor'], recipe['do_sample'],
                recipe['top_p'], recipe['top_k'], recipe['temperature'], recipe['length_penalty'],
                recipe['num_beams'], recipe['repetition_penalty'], recipe['max_mel_tokens']]
        result = client.call('gen_single', data)
        if not result:
            raise TtsServiceError('IndexTTS 没有返回音频结果')
        audio = normalize_generated_wav(client.download(result[0]))
        audio_info(audio)
        return audio
