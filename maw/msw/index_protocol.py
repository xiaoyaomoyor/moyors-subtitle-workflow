"""Small client for the official IndexTTS 2.5 Gradio queue protocol.

Each client owns its session. It never changes the user's browser session or
restarts their model process; cancellation only targets this client's event.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from urllib.parse import quote, urlsplit

import requests

from maw.msw.tts import TtsServiceError, MAX_AUDIO_BYTES


def service_url(raw):
    try:
        url = urlsplit(raw)
        port = url.port or 80
        if (url.scheme != 'http' or url.hostname not in {'localhost', '127.0.0.1', '::1'}
                or url.username or url.password or url.query or url.fragment
                or url.path not in {'', '/'} or not 1 <= port <= 65535):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError('IndexTTS 地址须为本机 HTTP 地址，例如 http://127.0.0.1:7860') from None
    host = '[::1]' if url.hostname == '::1' else '127.0.0.1'
    return f'http://{host}:{port}'


def unwrap(value):
    return value.get('value') if isinstance(value, dict) and value.get('__type__') == 'update' else value


def choices(value):
    return [row[1] if isinstance(row, list) else row for row in value or []]


class IndexClient:
    def __init__(self, url, cancel=None, timeout=600):
        self.url = service_url(url)
        self.cancel = cancel or threading.Event()
        self.timeout = timeout
        self.session = requests.Session()
        self.session.trust_env = False
        self.session_hash = 'msw-index-' + uuid.uuid4().hex
        self.config = None
        self.prefix = '/gradio_api'
        self.warned = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.session.close()

    def check(self):
        if self.cancel.is_set():
            from maw.msw.jobs import JobCancelled
            raise JobCancelled()

    def request(self, method, path, *, limit=4 * 1024 * 1024, **kwargs):
        self.check()
        try:
            with self.session.request(method, self.url + path, timeout=(5, 30),
                                      allow_redirects=False, stream=True, **kwargs) as response:
                if response.status_code != 200:
                    raise TtsServiceError(f'IndexTTS 请求失败（HTTP {response.status_code}），请检查服务是否可用')
                data = bytearray()
                for chunk in response.iter_content(65536):
                    self.check()
                    data.extend(chunk)
                    if len(data) > limit:
                        raise TtsServiceError('IndexTTS 响应超过大小限制')
                return bytes(data)
        except requests.RequestException as error:
            self.check()
            raise TtsServiceError('无法完整读取 IndexTTS 响应，请确认本机服务已启动；任务不会自动重试') from error

    def json(self, method, path, **kwargs):
        try:
            return json.loads(self.request(method, path, **kwargs))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise TtsServiceError('IndexTTS 返回了无效数据，请确认地址指向官方 WebUI 服务') from error

    def metadata(self):
        self.config = self.json('GET', '/config')
        if not isinstance(self.config, dict) or self.config.get('api_prefix') != '/gradio_api':
            raise TtsServiceError('当前服务不是受支持的 IndexTTS Gradio WebUI')
        info = self.json('GET', self.prefix + '/info')
        endpoint = info.get('named_endpoints', {}).get('/gen_single', {})
        params = endpoint.get('parameters', [])
        expected = ['emo_control_method', 'prompt', 'text', 'lang_choice', 'emo_ref_path', 'emo_weight',
                    *[f'vec{i}' for i in range(1, 9)], 'emo_text', 'emo_random',
                    'max_text_tokens_per_segment', 'duration_factor', *[f'param_{i}' for i in range(18, 26)]]
        if [p.get('parameter_name') for p in params] != expected:
            raise TtsServiceError('当前 IndexTTS 生成接口与 2.5 不兼容，请使用官方 IndexTTS 2.5 WebUI')
        return params

    def dependency(self, name):
        if self.config is None:
            self.metadata()
        item = next((d for d in self.config.get('dependencies', []) if d.get('api_name') == name), None)
        if not item or type(item.get('id')) is not int:
            raise TtsServiceError(f'IndexTTS 服务缺少接口：{name}')
        return item

    def call(self, name, data):
        self.warned = False
        dependency = self.dependency(name)
        body = {'data': data, 'fn_index': dependency['id'], 'session_hash': self.session_hash}
        event = self.json('POST', self.prefix + '/queue/join', json=body).get('event_id')
        if not isinstance(event, str) or not event:
            raise TtsServiceError('IndexTTS 没有返回任务标识')
        stopped = threading.Event()
        deadline = time.monotonic() + self.timeout

        def watch():
            while not stopped.wait(0.2):
                if self.cancel.is_set() or time.monotonic() >= deadline:
                    # A separate connection wakes SSE without closing another user's
                    # session. Synchronous GPU work can finish after cancellation.
                    try:
                        with requests.Session() as session:
                            session.trust_env = False
                            session.post(self.url + self.prefix + '/cancel',
                                         json={'event_id': event, 'session_hash': self.session_hash,
                                               'fn_index': dependency['id']}, timeout=(3, 3), allow_redirects=False)
                    except requests.RequestException:
                        pass
                    return

        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()
        try:
            with self.session.get(self.url + self.prefix + '/queue/data', params={'session_hash': self.session_hash},
                                  stream=True, timeout=(5, 25), allow_redirects=False) as response:
                if response.status_code != 200:
                    raise TtsServiceError(f'IndexTTS 队列连接失败（HTTP {response.status_code}）')
                for line in response.iter_lines(chunk_size=256):
                    self.check()
                    if time.monotonic() >= deadline:
                        raise TtsServiceError('IndexTTS 等待超时；可在连接设置增加等待时间，任务不会自动重试')
                    if len(line) > 4 * 1024 * 1024:
                        raise TtsServiceError('IndexTTS 队列响应过大')
                    if not line.startswith(b'data:'):
                        continue
                    message = json.loads(line[5:])
                    if message.get('event_id') != event:
                        continue
                    if message.get('msg') == 'log' and message.get('level') == 'warning':
                        self.warned = True
                    if message.get('msg') == 'process_completed':
                        output = message.get('output') or {}
                        if not message.get('success') or not isinstance(output.get('data'), list):
                            # Do not copy server tracebacks/local paths into projects.
                            raise TtsServiceError('IndexTTS 执行失败，请查看其服务窗口中的错误（参考音频、模型或显存）；未自动重试')
                        self.check()
                        return output['data']
                raise TtsServiceError('IndexTTS 队列提前断开，未收到完整结果；未自动重试')
        except (requests.RequestException, json.JSONDecodeError, UnicodeDecodeError) as error:
            self.check()
            raise TtsServiceError('IndexTTS 队列连接中断，请检查服务窗口；未自动重试') from error
        finally:
            stopped.set()
            watcher.join(timeout=0.3)

    def capabilities(self):
        self.metadata()
        components = {c['id']: c for c in self.config['components']}
        inputs = [components[i]['props'] for i in self.dependency('gen_single')['inputs']]
        modes = choices(inputs[0].get('choices'))
        if len(modes) < 3:
            raise TtsServiceError('IndexTTS 未提供完整情感控制接口')
        result = self.call('on_experimental_change', [True, modes[0]])
        modes = choices(result[0].get('choices'))
        samples = result[1].get('samples', [])
        presets = self.call('refresh_preset_choices', [])
        preset_names = [v for v in choices(presets[0].get('choices')) if isinstance(v, str) and v]
        return {'modes': modes, 'samples': samples, 'presets': preset_names,
                'languages': choices(inputs[3].get('choices')), 'gradio_version': self.config.get('version', ''),
                'max_mel_tokens': inputs[25].get('maximum', 1815),
                'max_text_tokens_per_segment': inputs[16].get('maximum', 600)}

    def upload(self, audio):
        paths = self.json('POST', self.prefix + '/upload', files={'files': ('reference.wav', audio, 'audio/wav')})
        if not isinstance(paths, list) or not paths or not isinstance(paths[0], str):
            raise TtsServiceError('IndexTTS 参考音频上传失败')
        return {'path': paths[0], 'orig_name': 'reference.wav', 'meta': {'_type': 'gradio.FileData'}}

    def download(self, raw):
        value = unwrap(raw)
        if not isinstance(value, dict):
            raise TtsServiceError('IndexTTS 没有返回音频文件')
        address = value.get('url')
        if not address and isinstance(value.get('path'), str):
            address = self.url + self.prefix + '/file=' + quote(value['path'], safe='/')
        if not isinstance(address, str) or len(address) > 8192:
            raise TtsServiceError('IndexTTS 音频地址无效')
        url = urlsplit(address)
        if url.scheme or url.netloc:
            if service_url(f'{url.scheme}://{url.netloc}') != self.url:
                raise TtsServiceError('IndexTTS 音频必须由同一本机服务提供')
        if not url.path.startswith(self.prefix + '/file=') or url.query or url.fragment:
            raise TtsServiceError('IndexTTS 音频地址不受支持')
        return self.request('GET', url.path, limit=MAX_AUDIO_BYTES)
