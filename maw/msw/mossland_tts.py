"""Moss API single-speaker, synchronous complete audio and minimal voice creation."""
import base64
import hashlib
import json
import threading

from maw.msw.cloud_tts import CloudTts, identifier, number, object_json
from maw.msw.assets import atomic_bytes, audio_info
from maw.msw.tts import TtsServiceError

MODELS = ['moss-tts-1.5-flash', 'moss-tts-1.5-flash-2026-06-26',
          'moss-tts-1.0-pro', 'moss-tts-1.0-pro-2026-02-07']
LANGUAGES = ['auto', 'Chinese', 'Cantonese', 'English', 'Arabic', 'Czech', 'Danish', 'Dutch', 'Finnish',
             'French', 'German', 'Greek', 'Hebrew', 'Hindi', 'Hungarian', 'Italian', 'Japanese', 'Korean',
             'Macedonian', 'Malay', 'Persian', 'Polish', 'Portuguese', 'Romanian', 'Russian', 'Spanish',
             'Swahili', 'Swedish', 'Tagalog', 'Thai', 'Turkish', 'Vietnamese']
DEFAULT_RECIPE = {'provider': 'mossland', 'model': MODELS[0], 'voice': '', 'language_type': 'auto'}


def validate_recipe(raw, *, require_voice=True):
    if not isinstance(raw, dict):
        raise ValueError('Mossland 配置格式无效')
    r = {key: raw.get(key, value) for key, value in DEFAULT_RECIPE.items()}
    if r['provider'] != 'mossland' or r['model'] not in MODELS:
        raise ValueError('不支持的 Mossland 模型')
    r['voice'] = identifier(r['voice'], empty=not require_voice)
    if r['language_type'] not in LANGUAGES or ('1.0-pro' in r['model'] and r['language_type'] != 'auto'):
        raise ValueError('此 Mossland 模型仅支持自动判断语言')
    if raw.get('expected_duration_sec') is not None:
        r['expected_duration_sec'] = number(raw['expected_duration_sec'], 0.1, 600, '期望时长')
    follow = raw.get('follow_subtitle_duration', False)
    if type(follow) is not bool:
        raise ValueError('跟随字幕时长设置无效')
    if follow:
        r['follow_subtitle_duration'] = True
    return r


def entry_recipe(recipe, entry):
    result = dict(recipe)
    if result.pop('follow_subtitle_duration', False):
        if entry.get('kind') == 'editor_text':
            raise ValueError('独立配音草稿没有字幕时长，请使用手动期望时长')
        result['expected_duration_sec'] = number((entry['end']-entry['start'])/1000, 0.1, 600, '字幕时长（秒）')
    return result


class MosslandTts(CloudTts):
    provider, endpoints = 'mossland', {'default': 'https://api.mosi.cn'}
    models, languages, default = MODELS, LANGUAGES, DEFAULT_RECIPE
    validate = staticmethod(validate_recipe)

    def fetch_voices(self, settings, cancel):
        rows, cursor, seen = {}, '', set()
        for _ in range(100):
            params = {'limit': 150}
            if cursor:
                params['after'] = cursor
            content, _ = self.request(settings, 'GET', '/v1/audio/voices', cancel, limit=4 * 1024 * 1024, params=params)
            data = object_json(content)
            if not isinstance(data.get('data'), list):
                raise TtsServiceError('Mossland 音色列表格式无效')
            for row in data['data']:
                identity = identifier(row.get('id'))
                rows[identity] = {'id': identity, 'name': str(row.get('name') or identity)[:255], 'group': 'account'}
            if not data.get('has_more'):
                return list(rows.values())
            cursor = data.get('next_cursor')
            if not isinstance(cursor, str) or not cursor or cursor in seen or len(cursor) > 4096:
                raise TtsServiceError('Mossland 音色分页无效；保留之前的列表')
            seen.add(cursor)
        raise TtsServiceError('Mossland 音色列表超过分页上限；可直接填写音色 ID')

    def action(self, raw):
        if raw.get('action') != 'create-voice':
            return super().action(raw)
        settings = self.resolve(raw, require_voice=False)
        name = identifier(raw.get('name', ''), empty=True)
        token = identifier(raw.get('request_key'))
        suffix = raw.get('suffix')
        encoded = raw.get('audio')
        if suffix not in ['.wav', '.mp3', '.m4a', '.flac'] or not isinstance(encoded, str) or len(encoded) > 14 * 1024 * 1024:
            raise ValueError('参考须为 WAV／MP3／M4A／FLAC，且不超过 10 MB／30 秒')
        try:
            audio = base64.b64decode(encoded, validate=True)
        except ValueError:
            raise ValueError('参考音频编码无效') from None
        if not audio or len(audio) > 10 * 1024 * 1024:
            raise ValueError('参考音频须小于 10 MB')
        cancel = threading.Event()
        wav = self.convert(audio, suffix, cancel)
        info = audio_info(wav)
        if info['sample_count'] / info['sample_rate'] > 30:
            raise ValueError('参考音频须不超过 30 秒；请先裁剪后上传')
        fingerprint = hashlib.sha256((settings.base_url + settings.api_key + token).encode()).hexdigest()
        path = self.root / ('creation-' + fingerprint + '.json')
        with self.lock:
            if path.exists():
                record = json.loads(path.read_text(encoding='utf-8'))
                if record.get('voice'):
                    return {**self.payload(raw), 'created_voice': record['voice']}
                raise ValueError('上次创建结果尚未确认，请刷新音色列表；不会重复上传此请求')
            # Persist before the paid side effect. Interrupted/unknown requests never auto-repeat.
            atomic_bytes(path, b'{"state":"submitted"}\n')
        content, _ = self.request(settings, 'POST', '/v1/audio/voices', cancel, limit=1024 * 1024,
                                  data={'name': name}, files={'audio_sample': ('reference' + suffix, audio)})
        value = object_json(content)
        identity = identifier(value.get('id'))
        voice = {'id': identity, 'name': str(value.get('name') or name or identity)[:255], 'group': 'account'}
        with self.lock:
            atomic_bytes(path, (json.dumps({'state': 'completed', 'voice': voice}, ensure_ascii=False) + '\n').encode())
            rows = {row['id']: row for row in self.cached(settings)}
            rows[identity] = voice
            atomic_bytes(self.cache_path(settings), (json.dumps(list(rows.values()), ensure_ascii=False) + '\n').encode())
        return {**self.payload(raw), 'created_voice': voice}


def synthesize(settings, text, cancel):
    r, controller = settings.recipe, settings.controller
    body = {'model': r['model'], 'input': text, 'voice_id': r['voice'], 'stream': False,
            'async': False, 'response_format': 'wav', 'delivery_method': 'audio'}
    if 'expected_duration_sec' in r:
        body['expected_duration_sec'] = r['expected_duration_sec']
    if r['language_type'] != 'auto':
        body['language'] = r['language_type']
    content, mime = controller.request(settings, 'POST', '/v1/audio/speech', cancel, json=body)
    if 'json' in mime.lower() or not content.startswith(b'RIFF'):
        raise TtsServiceError('Mossland 未返回完整 WAV 音频；未自动重试，请核对服务记录')
    return controller.convert(content, '.wav', cancel)
