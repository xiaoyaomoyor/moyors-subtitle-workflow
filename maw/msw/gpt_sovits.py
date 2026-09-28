"""Bounded API-v2 adapter. Model paths never enter portable generation recipes."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import math
import threading
import wave
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import requests

from maw.msw.assets import audio_info, normalize_generated_wav
from maw.msw.index_tts import IndexTts, ref_id
from maw.msw.index_protocol import service_url
from maw.msw.jobs import JobCancelled
from maw.msw.tts import MAX_AUDIO_BYTES, TtsServiceError

DEFAULT_RECIPE = {
    'provider': 'gpt-sovits', 'model': 'api-v2', 'voice': '', 'language_type': 'zh',
    'gpt_model': '', 'sovits_model': '', 'speaker_ref': '', 'aux_refs': [],
    'prompt_text': '', 'prompt_lang': 'zh', 'no_prompt': False,
    'speed_factor': 1.0, 'text_split_method': 'cut5', 'top_k': 15, 'top_p': 1.0,
    'temperature': 1.0, 'seed': -1, 'repetition_penalty': 1.35,
    'sample_steps': 32, 'super_sampling': False,
}
LANGUAGES = ('zh', 'en', 'ja', 'yue', 'ko', 'auto', 'auto_yue', 'all_zh', 'all_ja', 'all_yue', 'all_ko')
RANGES = {'speed_factor': (.5, 2), 'top_k': (1, 100), 'top_p': (.01, 1),
          'temperature': (.01, 2), 'seed': (-1, 4294967295), 'repetition_penalty': (1, 2), 'sample_steps': (4, 128)}
_locks_guard = threading.Lock()
_locks = {}


def validate_recipe(raw):
    if not isinstance(raw, dict):
        raise ValueError('GPT-SoVITS 配置格式无效')
    r = {k: copy.deepcopy(raw.get(k, v)) for k, v in DEFAULT_RECIPE.items()}
    if r['provider'] != 'gpt-sovits' or r['model'] != 'api-v2':
        raise ValueError('不支持的 GPT-SoVITS 接口')
    for key in ('gpt_model', 'sovits_model'):
        v = r[key]
        if not isinstance(v, str) or (v and (not v.startswith('model-') or len(v) != 70 or any(c not in '0123456789abcdef' for c in v[6:]))):
            raise ValueError('模型标识无效，请重新扫描本机模型')
    if r['language_type'] not in LANGUAGES or r['prompt_lang'] not in LANGUAGES:
        raise ValueError('GPT-SoVITS 语言无效')
    if not isinstance(r['speaker_ref'], str) or (r['speaker_ref'] and not ref_id(r['speaker_ref'])):
        raise ValueError('参考音频标识无效')
    if not isinstance(r['aux_refs'], list) or len(r['aux_refs']) > 8 or any(not ref_id(v) for v in r['aux_refs']):
        raise ValueError('辅助参考最多 8 条，须来自本机参考库')
    if not isinstance(r['prompt_text'], str) or len(r['prompt_text']) > 2000:
        raise ValueError('参考文字请限制在 2000 字符以内')
    if r['text_split_method'] not in {f'cut{i}' for i in range(6)}:
        raise ValueError('断句方式无效')
    for key, (lo, hi) in RANGES.items():
        v = r[key]
        if type(v) not in (int, float) or not math.isfinite(v) or not lo <= v <= hi or (key in {'top_k', 'seed', 'sample_steps'} and type(v) is not int):
            raise ValueError(f'{key} 须在 {lo}–{hi} 范围内')
    if type(r['no_prompt']) is not bool or type(r['super_sampling']) is not bool:
        raise ValueError('GPT-SoVITS 开关值无效')
    r['voice'] = ''
    return r


@dataclass(frozen=True)
class Settings:
    recipe: dict
    base_url: str
    timeout: int
    controller: object
    model_paths: tuple
    start_service: bool = False
    service_config: dict | None = None
    api_key = ''
    provider_id = 'gpt-sovits'
    model = 'api-v2'
    reasoning_mode = 'off'


class GptSovits(IndexTts):
    """Reuse the immutable reference store, not Index's protocol or recipes."""
    def __init__(self, root, converter):
        super().__init__(root, converter)
        self.root = Path(root) / 'gpt-sovits'
        self.uncertain = set()

    def connection(self, raw):
        timeout = raw.get('timeout', 600)
        if type(timeout) is not int or not 60 <= timeout <= 3600:
            raise ValueError('等待时间须为 60–3600 秒')
        try:
            url = service_url(raw.get('service_url', 'http://127.0.0.1:9880'))
        except ValueError:
            raise ValueError('GPT-SoVITS 地址须为本机 HTTP 地址') from None
        return url, timeout

    def reference(self, identity):
        try:
            return super().reference(identity)
        except ValueError as e:
            raise ValueError(str(e).replace('IndexTTS', 'GPT-SoVITS')) from None

    def decorate(self, recipe):
        r = copy.deepcopy(recipe)
        item = next((v for v in self.references() if v['id'] == r['speaker_ref']), None)
        r['voice'] = item['name'] if item else ''
        return r

    def settings(self):
        try:
            raw = self.read('settings.json', {})
            url, timeout = self.connection(raw)
            r = validate_recipe(raw.get('recipe', {}))
        except (ValueError, AttributeError):
            url, timeout, r = 'http://127.0.0.1:9880', 600, copy.deepcopy(DEFAULT_RECIPE)
        return {'service_url': url, 'timeout': timeout, 'recipe': self.decorate(r)}

    def payload(self):
        models = self.read('models.json', [])
        return {**self.settings(), 'references': self.references(), 'presets': self.read('presets.json', {}),
                'models': [{k: v[k] for k in ('id', 'name', 'kind', 'family')} for v in models], 'languages': LANGUAGES}

    def scan_models(self):
        # Only installed, known weight folders under the explicitly configured installation.
        directory = self.services.settings('gpt-sovits')['directory'] if self.services else ''
        if not directory:
            raise ValueError('请先在环境配置中选择 GPT-SoVITS 安装位置')
        root = Path(directory).resolve()
        folders = [root / 'GPT_SoVITS' / 'pretrained_models']
        folders += [root / (kind + suffix) for kind in ('GPT_weights', 'SoVITS_weights')
                    for suffix in ('', '_v2', '_v2Pro', '_v2ProPlus', '_v3', '_v4')]
        result = []
        for folder in folders:
            if not folder.is_dir():
                continue
            # Three directory levels suffice for official weights; no recursive disk scan.
            files = [*folder.glob('*'), *folder.glob('*/*'), *folder.glob('*/*/*')]
            for path in sorted(files):
                if not path.is_file() or path.suffix not in {'.pth', '.ckpt'} or not path.resolve().is_relative_to(root):
                    continue
                kind = 'gpt' if path.suffix == '.ckpt' else 'sovits'
                if kind == 'sovits' and folder.name == 'pretrained_models' and not path.name.lower().startswith('s2g'):
                    continue
                stat = path.stat()
                with path.open('rb') as f:
                    head = f.read(8192)
                # Header + stat signature: detect changes before inference, without loading torch/pickle.
                signature = hashlib.sha256(head + str((stat.st_size, stat.st_mtime_ns)).encode()).hexdigest()
                relative = path.relative_to(root).as_posix()
                identity = 'model-' + hashlib.sha256((relative + signature).encode()).hexdigest()
                family = family_of(path, head) if kind == 'sovits' else 'gpt'
                result.append({'id': identity, 'name': relative, 'kind': kind, 'family': family,
                               'path': str(path.resolve()), 'size': stat.st_size, 'mtime': stat.st_mtime_ns})
                if len(result) > 1000:
                    raise ValueError('模型数量超过 1000，请整理模型目录后重试')
        self.write('models.json', result)
        return self.payload()

    def model_path(self, identity, kind):
        row = next((v for v in self.read('models.json', []) if v['id'] == identity and v['kind'] == kind), None)
        if not row:
            raise ValueError('请选择已扫描的 GPT 与 SoVITS 模型组合')
        path = Path(row['path'])
        if not path.is_file() or path.stat().st_size != row['size'] or path.stat().st_mtime_ns != row['mtime']:
            raise ValueError('模型已移动或更改，请重新扫描并选择模型')
        return row

    def save(self, raw):
        url, timeout = self.connection({**self.settings(), **raw})
        self.write('settings.json', {'service_url': url, 'timeout': timeout, 'recipe': validate_recipe(raw.get('recipe', {}))})
        return self.payload()

    def resolve(self, raw):
        saved = self.settings()
        url, timeout = self.connection({**saved, **raw})
        r = self.decorate(validate_recipe(raw.get('recipe', saved['recipe'])))
        gpt, sovits = self.model_path(r['gpt_model'], 'gpt'), self.model_path(r['sovits_model'], 'sovits')
        info, _ = self.reference(r['speaker_ref'])
        duration = info['sample_count'] / info['sample_rate']
        if not 3 <= duration <= 10:
            raise ValueError('主参考音频须为 3–10 秒，请先裁切参考')
        for ref in r['aux_refs']:
            self.reference(ref)
        if not r['no_prompt'] and not r['prompt_text'].strip():
            raise ValueError('请填写参考音频的文字')
        if sovits['family'] in {'v3', 'v4'} and r['no_prompt']:
            raise ValueError('V3/V4 模型需要参考文字')
        if sovits['family'] not in {'v3', 'v4'} and r['sample_steps'] != 32:
            raise ValueError('当前模型不支持采样步数')
        if sovits['family'] != 'v3' and r['super_sampling']:
            raise ValueError('仅 V3 模型支持超采样')
        managed = self.services.snapshot('gpt-sovits') if self.services else None
        start = bool(managed and managed['configured'] and managed['service_url'] == url)
        return Settings(r, url, timeout, self, (gpt['path'], sovits['path']), start,
                        copy.deepcopy(managed['settings']) if start else None)

    def prepare(self, settings, cancel):
        if settings.start_service:
            self.services.ensure('gpt-sovits', settings.base_url, cancel, settings.service_config)

    def action(self, raw):
        action = raw.get('action')
        if action == 'scan':
            return self.scan_models()
        if action == 'upload':
            return super().action(raw)
        if action == 'trim':
            _, data = self.reference(raw.get('id'))
            start, end = raw.get('start'), raw.get('end')
            with wave.open(io.BytesIO(data), 'rb') as source:
                duration = source.getnframes() / source.getframerate()
                if any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end)) or not 0 <= start < end <= duration or not 3 <= end - start <= 10:
                    raise ValueError('裁切范围须在音频内，且长度为 3–10 秒')
                first, last = round(start * source.getframerate()), round(end * source.getframerate())
                source.setpos(first)
                output = io.BytesIO()
                with wave.open(output, 'wb') as target:
                    target.setparams(source.getparams())
                    target.writeframes(source.readframes(last - first))
            name = self.reference(raw['id'])[0]['name'][:220] + ' (trim).wav'
            return {'reference': self.store_reference(name, output.getvalue()), 'references': self.references()}
        if action == 'check':
            from maw.msw.tts_local_services import probe
            url, _ = self.connection({**self.settings(), **raw})
            probe('gpt-sovits', url)
            self.uncertain.discard(url)
            return {'message': 'GPT-SoVITS API v2 已连接'}
        if action in {'save_preset', 'delete_preset', 'rename_preset'}:
            name = raw.get('name', '')
            if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
                raise ValueError('预设名称须为 1–80 字符')
            name = name.strip()
            with self.lock:
                presets = self.read('presets.json', {})
                if action == 'save_preset':
                    if name not in presets and len(presets) >= 100:
                        raise ValueError('最多保存 100 个本机预设')
                    presets[name] = self.decorate(validate_recipe(raw.get('recipe')))
                elif name not in presets:
                    raise ValueError('预设不存在，请刷新配置')
                elif action == 'delete_preset':
                    del presets[name]
                else:
                    new = raw.get('new_name', '')
                    if not isinstance(new, str) or not 1 <= len(new.strip()) <= 80 or (new.strip() != name and new.strip() in presets):
                        raise ValueError('请输入未使用的预设名称')
                    presets[new.strip()] = presets.pop(name)
                self.write('presets.json', presets)
            return {'presets': presets}
        raise ValueError('未知 GPT-SoVITS 操作')


def family_of(path, head):
    # Official API v2's fast header convention; no deserialization of weights.
    families = {b'00': 'v1', b'01': 'v2', b'02': 'v3', b'03': 'v3', b'04': 'v4', b'05': 'v2Pro', b'06': 'v2ProPlus'}
    name = path.as_posix().lower()
    if head[:2] in families:
        return families[head[:2]]
    for token, family in [('v2proplus', 'v2ProPlus'), ('v2pro', 'v2Pro'), ('v4', 'v4'), ('v3', 'v3')]:
        if token in name:
            return family
    return 'v1' if path.stat().st_size < 82978 * 1024 else 'v3' if path.stat().st_size >= 700 * 1024 * 1024 else 'v2'


def synthesize(settings, text, cancel):
    c, r, url = settings.controller, settings.recipe, settings.base_url
    with _locks_guard:
        lock = _locks.setdefault(url, threading.Lock())
    while not lock.acquire(timeout=.1):
        if cancel.is_set() or c.cancel.is_set():
            raise JobCancelled()
    lease = None
    try:
        if cancel.is_set() or c.cancel.is_set():
            raise JobCancelled()
        from maw.msw.tts_local_services import PortLease
        while lease is None:
            try:
                lease = PortLease(c.root / 'inference-locks', urlsplit(url).port or 80)
            except ValueError:
                if cancel.wait(.1) or c.cancel.is_set():
                    raise JobCancelled()
        if url in c.uncertain:
            raise TtsServiceError('上次服务响应中断，请等待推理结束并重新检测服务后重试')
        for identity, kind in [(r['gpt_model'], 'gpt'), (r['sovits_model'], 'sovits')]:
            c.model_path(identity, kind)
        # Keep the lock until the response ends, including cancelled inference.
        with requests.Session() as session:
            session.trust_env = False
            def request(method, path, limit=MAX_AUDIO_BYTES, **kwargs):
                try:
                    with session.request(method, url + path, timeout=(5, settings.timeout), stream=True,
                                         allow_redirects=False, **kwargs) as response:
                        if response.status_code != 200:
                            raise TtsServiceError(f'GPT-SoVITS 请求失败（HTTP {response.status_code}）：请检查模型组合、语言和服务日志')
                        data = bytearray()
                        for chunk in response.iter_content(65536):
                            data.extend(chunk)
                            if len(data) > limit:
                                c.uncertain.add(url)
                                raise TtsServiceError('GPT-SoVITS 返回内容超过大小限制')
                        return bytes(data)
                except requests.RequestException:
                    c.uncertain.add(url)
                    raise TtsServiceError('GPT-SoVITS 响应中断；未自动重试，请等待服务结束后重新检测') from None
            for kind, path in zip(('gpt', 'sovits'), settings.model_paths):
                if cancel.is_set() or c.cancel.is_set():
                    raise JobCancelled()
                raw = request('GET', f'/set_{kind}_weights', limit=65536, params={'weights_path': path})
                if json.loads(raw).get('message') != 'success':
                    raise TtsServiceError('模型切换未确认成功，本次未合成')
            if cancel.is_set() or c.cancel.is_set():
                raise JobCancelled()
            refs = [r['speaker_ref'], *r['aux_refs']]
            for identity in refs:
                c.reference(identity)
            paths = [str((c.root / 'references' / (identity + '.wav')).resolve()) for identity in refs]
            body = {k: r[k] for k in ('top_k', 'top_p', 'temperature', 'seed', 'speed_factor', 'text_split_method',
                                      'repetition_penalty', 'sample_steps', 'super_sampling')}
            body.update(text=text, text_lang=r['language_type'], prompt_lang=r['prompt_lang'],
                        prompt_text='' if r['no_prompt'] else r['prompt_text'], ref_audio_path=paths[0],
                        aux_ref_audio_paths=paths[1:], media_type='wav', streaming_mode=False,
                        batch_size=1, parallel_infer=False, split_bucket=True)
            audio = request('POST', '/tts', json=body)
            if cancel.is_set() or c.cancel.is_set():
                raise JobCancelled()
            audio = normalize_generated_wav(audio)
            audio_info(audio)
            return audio
    finally:
        if lease:
            lease.close()
        lock.release()
