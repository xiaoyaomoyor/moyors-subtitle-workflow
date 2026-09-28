"""Edge's online TTS, with cached voices and cancellable complete-audio jobs."""
import asyncio
import copy
import importlib.metadata
import json
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from maw.msw.assets import atomic_bytes, audio_info
from maw.msw.jobs import JobCancelled
from maw.msw.tts import MAX_AUDIO_BYTES, TtsServiceError

VERSION = '7.2.8'
DEFAULT_RECIPE = {'provider': 'edge', 'model': 'edge-online', 'voice': 'zh-CN-XiaoxiaoNeural',
                  'language_type': 'zh-CN', 'rate': 0, 'volume': 0, 'pitch': 0}


def dependency():
    try:
        version = importlib.metadata.version('edge-tts')
    except importlib.metadata.PackageNotFoundError:
        return {'ready': False, 'version': '', 'message': f'缺少 edge-tts {VERSION}，请更新 MSW 依赖或使用包含此组件的发行包'}
    return {'ready': version == VERSION, 'version': version,
            'message': f'edge-tts {version}' if version == VERSION else f'请使用 edge-tts {VERSION}，当前版本为 {version}'}


def validate_recipe(raw):
    if not isinstance(raw, dict):
        raise ValueError('Edge TTS 配置格式无效')
    r = {k: copy.deepcopy(raw.get(k, v)) for k, v in DEFAULT_RECIPE.items()}
    if r['provider'] != 'edge' or r['model'] != 'edge-online':
        raise ValueError('不支持的 Edge TTS 模型')
    if not isinstance(r['voice'], str) or not re.fullmatch(r'[a-z]{2,3}-[A-Z]{2}(?:-[a-z]+)?-[A-Za-z0-9]+Neural', r['voice']):
        raise ValueError('请选择有效的 Edge 音色')
    r['language_type'] = r['voice'].rsplit('-', 1)[0]
    for key, lo, hi in [('rate', -50, 100), ('volume', -100, 100), ('pitch', -100, 100)]:
        if type(r[key]) is not int or not lo <= r[key] <= hi:
            raise ValueError(f'Edge {key} 须为 {lo}–{hi} 的整数')
    return r


async def guarded(awaitable, cancel, closed, timeout):
    task = asyncio.ensure_future(awaitable)
    deadline = time.monotonic() + timeout
    try:
        while not task.done():
            if cancel.is_set() or closed.is_set():
                raise JobCancelled()
            if time.monotonic() >= deadline:
                raise TtsServiceError('Edge 在线请求超时，请检查网络后重试')
            await asyncio.wait({task}, timeout=.1)
        if cancel.is_set() or closed.is_set():
            raise JobCancelled()
        return task.result()
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@dataclass(frozen=True)
class Settings:
    recipe: dict
    timeout: int
    controller: object
    api_key = ''
    base_url = 'https://speech.platform.bing.com'
    provider_id = 'edge'
    model = 'edge-online'
    reasoning_mode = 'off'


class EdgeTts:
    def __init__(self, root, converter):
        self.root = Path(root) / 'edge-tts'
        self.converter = converter
        self.cancel = threading.Event()
        self.lock = threading.Lock()

    def read(self, name, default):
        try:
            path = self.root / name
            if path.stat().st_size > 4 * 1024 * 1024:
                return copy.deepcopy(default)
            return json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return copy.deepcopy(default)

    def write(self, name, data):
        atomic_bytes(self.root / name, (json.dumps(data, ensure_ascii=False) + '\n').encode())

    def settings(self):
        raw = self.read('settings.json', {})
        try:
            r = validate_recipe(raw.get('recipe', {}))
            timeout = self.timeout(raw)
        except (ValueError, AttributeError):
            r, timeout = copy.deepcopy(DEFAULT_RECIPE), 120
        return {'recipe': r, 'timeout': timeout}

    @staticmethod
    def timeout(raw):
        value = raw.get('timeout', 120)
        if type(value) is not int or not 30 <= value <= 600:
            raise ValueError('Edge 等待时间须为 30–600 秒')
        return value

    def payload(self):
        cache = self.read('voices.json', {'voices': [], 'updated_at': 0})
        return {**self.settings(), **cache, 'dependency': dependency()}

    def save(self, raw):
        self.write('settings.json', {'recipe': validate_recipe(raw.get('recipe', {})),
                                    'timeout': self.timeout({**self.settings(), **raw})})
        return self.payload()

    def resolve(self, raw):
        dep = dependency()
        if not dep['ready']:
            raise ValueError(dep['message'])
        saved = self.settings()
        return Settings(validate_recipe(raw.get('recipe', saved['recipe'])), self.timeout({**saved, **raw}), self)

    def action(self, raw):
        if raw.get('action') != 'refresh':
            raise ValueError('未知 Edge TTS 操作')
        dep = dependency()
        if not dep['ready']:
            raise ValueError(dep['message'])
        # Cache is only replaced after a complete, valid response.
        import edge_tts
        try:
            voices = asyncio.run(guarded(edge_tts.list_voices(), self.cancel, self.cancel, 30))
        except JobCancelled:
            raise
        except Exception:
            raise TtsServiceError('无法读取 Edge 在线音色，已保留缓存与当前选择；请检查网络后刷新') from None
        rows = []
        for v in voices[:2000]:
            try:
                r = validate_recipe({'voice': v['ShortName']})
                rows.append({'id': r['voice'], 'name': str(v.get('FriendlyName') or r['voice'])[:240],
                             'language': r['language_type'], 'gender': str(v.get('Gender', ''))[:20]})
            except (KeyError, ValueError, TypeError):
                continue
        if not rows:
            raise TtsServiceError('Edge 未返回有效音色，已保留缓存')
        with self.lock:
            self.write('voices.json', {'voices': rows, 'updated_at': int(time.time())})
        return self.payload()

    def close(self):
        self.cancel.set()


def synthesize(settings, text, cancel):
    import edge_tts
    r, c = settings.recipe, settings.controller
    async def collect():
        data = bytearray()
        communicate = edge_tts.Communicate(text, r['voice'], rate=f"{r['rate']:+d}%",
                                          volume=f"{r['volume']:+d}%", pitch=f"{r['pitch']:+d}Hz",
                                          connect_timeout=10, receive_timeout=30)
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                data.extend(chunk['data'])
                if len(data) > MAX_AUDIO_BYTES:
                    raise TtsServiceError('Edge 音频超过大小限制，请拆分文字')
        if not data:
            raise TtsServiceError('Edge 未返回完整音频')
        return bytes(data)
    try:
        mp3 = asyncio.run(guarded(collect(), cancel, c.cancel, settings.timeout))
    except (JobCancelled, TtsServiceError):
        raise
    except Exception:
        raise TtsServiceError('Edge 在线合成失败或连接中断；未保存不完整音频，请检查网络后重试') from None
    if cancel.is_set() or c.cancel.is_set():
        raise JobCancelled()
    audio = c.converter(mp3, '.mp3', cancel=cancel)
    if cancel.is_set() or c.cancel.is_set():
        raise JobCancelled()
    audio_info(audio)
    return audio
