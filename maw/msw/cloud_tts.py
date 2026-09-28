"""Shared local settings and bounded, non-retrying cloud TTS transport."""
import copy
import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass

import requests

from maw.gui_config import load_env, save_env
from maw.msw.assets import atomic_bytes, audio_info, MAX_AUDIO_BYTES
from maw.msw.jobs import JobCancelled
from maw.msw.tts import TtsServiceError


def identifier(value, *, empty=False):
    if not isinstance(value, str) or len(value) > 255 or (not empty and not value.strip()) or any(ord(c) < 32 for c in value):
        raise ValueError('请填写有效的音色 ID')
    return value.strip()


def number(value, low, high, label, *, integer=False):
    if type(value) not in (int, float) or not low <= value <= high or (integer and int(value) != value):
        raise ValueError(f'{label}须在 {low}–{high} 之间')
    return int(value) if integer else value


def object_json(content):
    try:
        value = json.loads(content)
    except (ValueError, UnicodeError):
        raise TtsServiceError('云端返回格式无效；未自动重试，请核对服务记录') from None
    if not isinstance(value, dict):
        raise TtsServiceError('云端返回格式无效')
    return value


@dataclass(frozen=True)
class Settings:
    api_key: str
    recipe: dict
    timeout: int
    controller: object

    @property
    def provider_id(self):
        return self.recipe['provider']

    @property
    def model(self):
        return self.recipe['model']

    @property
    def base_url(self):
        return self.controller.endpoints[self.recipe.get('region', 'default')]

    reasoning_mode = 'off'


class CloudTts:
    def __init__(self, root, env_path, converter):
        self.root = root / self.provider
        self.root.mkdir(parents=True, exist_ok=True)
        self.env_path, self.converter = env_path, converter
        self.closed = threading.Event()
        self.lock = threading.RLock()
        # Bound abandoned HTTP calls when users cancel while the server computes.
        self.slots = threading.BoundedSemaphore(2)

    def stored(self):
        try:
            value = json.loads((self.root / 'settings.json').read_text(encoding='utf-8'))
            return {'recipe': self.validate(value['recipe'], require_voice=False),
                    'timeout': number(value.get('timeout', 180), 30, 600, '等待上限', integer=True)}
        except (OSError, ValueError, KeyError, TypeError):
            return {'recipe': copy.deepcopy(self.default), 'timeout': 180}

    def key(self, region, supplied=''):
        name = f'MSW_TTS_{self.provider.upper()}_{region.upper()}_API_KEY'
        value = supplied or os.environ.get(name) or load_env(self.env_path).get(name, '')
        if not isinstance(value, str) or len(value) > 4096 or any(c in value for c in '\r\n'):
            raise ValueError('API Key 格式无效')
        return value.strip()

    def resolve(self, raw, *, require_voice=True, require_key=True):
        if not isinstance(raw, dict):
            raise ValueError('云端 TTS 配置格式无效')
        stored = self.stored()
        recipe = self.validate(raw.get('recipe', stored['recipe']), require_voice=require_voice)
        key = self.key(recipe.get('region', 'default'), raw.get('apiKey', ''))
        if require_key and not key:
            raise ValueError('请在环境配置填写当前服务地域的 API Key')
        return Settings(key, recipe, number(raw.get('timeout', stored['timeout']), 30, 600, '等待上限', integer=True), self)

    def save(self, raw):
        with self.lock:
            settings = self.resolve(raw, require_voice=False, require_key=False)
            if raw.get('apiKey'):
                region = settings.recipe.get('region', 'default')
                save_env(self.env_path, {f'MSW_TTS_{self.provider.upper()}_{region.upper()}_API_KEY': settings.api_key})
            atomic_bytes(self.root / 'settings.json', (json.dumps({'recipe': settings.recipe, 'timeout': settings.timeout}, ensure_ascii=False) + '\n').encode())

    def cache_path(self, settings):
        digest = hashlib.sha256((settings.base_url + '\0' + settings.api_key).encode()).hexdigest()
        return self.root / ('voices-' + digest + '.json')

    def cached(self, settings):
        try:
            rows = json.loads(self.cache_path(settings).read_text(encoding='utf-8'))
            return rows if isinstance(rows, list) else []
        except (OSError, ValueError):
            return []

    def payload(self, raw=None):
        settings = self.resolve(raw or {}, require_voice=False, require_key=False)
        return {'recipe': settings.recipe, 'timeout': settings.timeout, 'models': self.models,
                'languages': self.languages, 'voices': self.cached(settings),
                'regions': [{'id': region, 'hasApiKey': bool(self.key(region))} for region in self.endpoints]}

    def check_cancel(self, cancel):
        if cancel.is_set() or self.closed.is_set():
            raise JobCancelled()

    def request(self, settings, method, path, cancel, *, limit=MAX_AUDIO_BYTES, **kwargs):
        """No retries, redirects or arbitrary hosts; cancellation discards late bytes."""
        self.check_cancel(cancel)
        if not self.slots.acquire(blocking=False):
            raise TtsServiceError('前一个云端请求仍在结束，请稍后再试')
        done, result = threading.Event(), {}
        deadline = time.monotonic() + settings.timeout

        def send():
            try:
                with requests.Session() as session:
                    with session.request(method, settings.base_url + path,
                                         headers={'Authorization': 'Bearer ' + settings.api_key},
                                         timeout=(10, settings.timeout), allow_redirects=False, stream=True, **kwargs) as response:
                        if not 200 <= response.status_code < 300:
                            messages = {401: '密钥无效或已过期', 403: '账号无权使用此服务或音色',
                                        402: '余额不足', 404: '模型或音色不存在', 429: '请求过于频繁或额度不足'}
                            raise TtsServiceError(messages.get(response.status_code, '云端请求失败') + f'（HTTP {response.status_code}）')
                        chunks, size = [], 0
                        for chunk in response.iter_content(65536):
                            self.check_cancel(cancel)
                            if time.monotonic() > deadline:
                                raise TtsServiceError('云端等待超时；未自动重试，请核对服务记录')
                            size += len(chunk)
                            if size > limit:
                                raise TtsServiceError('云端返回内容超过大小上限')
                            chunks.append(chunk)
                        result['value'] = (b''.join(chunks), response.headers.get('Content-Type', ''))
            except (JobCancelled, TtsServiceError) as error:
                result['error'] = error
            except Exception:
                result['error'] = TtsServiceError('云端连接中断或超时；结果未知，未自动重试，请核对服务记录')
            finally:
                self.slots.release()
                done.set()

        threading.Thread(target=send, daemon=True, name=self.provider + '-http').start()
        while not done.wait(.1):
            self.check_cancel(cancel)
            if time.monotonic() > deadline:
                raise TtsServiceError('云端等待超时；结果未知，未自动重试，请核对服务记录')
        self.check_cancel(cancel)
        if 'error' in result:
            raise result['error']
        return result['value']

    def action(self, raw):
        if raw.get('action') != 'refresh':
            raise ValueError('未知云端 TTS 操作')
        settings = self.resolve(raw, require_voice=False)
        rows = self.fetch_voices(settings, threading.Event())
        with self.lock:
            atomic_bytes(self.cache_path(settings), (json.dumps(rows, ensure_ascii=False) + '\n').encode())
        return self.payload(raw)

    def convert(self, data, suffix, cancel):
        self.check_cancel(cancel)
        if not data or len(data) > MAX_AUDIO_BYTES:
            raise TtsServiceError('云端音频为空或超过大小上限')
        value = self.converter(data, suffix, cancel=cancel)
        audio_info(value)
        self.check_cancel(cancel)
        return value

    def close(self):
        self.closed.set()
