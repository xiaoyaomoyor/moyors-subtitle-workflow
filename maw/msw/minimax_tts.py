"""MiniMax synchronous speech and account voice catalog (official HTTP API)."""
from maw.msw.cloud_tts import CloudTts, identifier, number, object_json
from maw.msw.assets import MAX_AUDIO_BYTES
from maw.msw.tts import TtsServiceError

MODELS = ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo',
          'speech-02-hd', 'speech-02-turbo', 'speech-01-hd', 'speech-01-turbo']
LANGUAGES = ['auto', 'Chinese', 'Chinese,Yue', 'English', 'Arabic', 'Russian', 'Spanish', 'French',
             'Portuguese', 'German', 'Turkish', 'Dutch', 'Ukrainian', 'Vietnamese', 'Indonesian',
             'Japanese', 'Italian', 'Korean', 'Thai', 'Polish', 'Romanian', 'Greek', 'Czech', 'Finnish',
             'Hindi', 'Bulgarian', 'Danish', 'Hebrew', 'Malay', 'Persian', 'Slovak', 'Swedish',
             'Croatian', 'Filipino', 'Hungarian', 'Norwegian', 'Slovenian', 'Catalan', 'Nynorsk', 'Tamil', 'Afrikaans']
EMOTIONS = ['', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent', 'whisper']
ENDPOINTS = {'cn': 'https://api.minimaxi.com', 'global': 'https://api.minimax.io'}
DEFAULT_RECIPE = {'provider': 'minimax', 'region': 'cn', 'model': MODELS[0], 'voice': '',
                  'language_type': 'auto', 'speed': 1, 'volume': 1, 'pitch': 0, 'emotion': ''}


def validate_recipe(raw, *, require_voice=True):
    if not isinstance(raw, dict):
        raise ValueError('MiniMax 配置格式无效')
    r = {key: raw.get(key, value) for key, value in DEFAULT_RECIPE.items()}
    if r['provider'] != 'minimax' or r['model'] not in MODELS or r['region'] not in ENDPOINTS:
        raise ValueError('不支持的 MiniMax 模型或地域')
    r['voice'] = identifier(r['voice'], empty=not require_voice)
    if r['language_type'] not in LANGUAGES or (r['model'].startswith(('speech-01', 'speech-02')) and r['language_type'] in ['Persian', 'Filipino', 'Tamil']):
        raise ValueError('此 MiniMax 模型不支持所选语言')
    if r['emotion'] not in EMOTIONS or (r['emotion'] in ['fluent', 'whisper'] and not r['model'].startswith('speech-2.6-')):
        raise ValueError('此 MiniMax 模型不支持所选情绪')
    r['speed'] = number(r['speed'], .5, 2, '语速')
    r['volume'] = number(r['volume'], .01, 10, '合成音量倍率')
    r['pitch'] = number(r['pitch'], -12, 12, '音高', integer=True)
    return r


def checked(content):
    value = object_json(content)
    response = value.get('base_resp')
    status = response.get('status_code') if isinstance(response, dict) else None
    if type(status) is not int or status != 0:
        messages = {1002: '请求过于频繁', 1004: '密钥无效', 1008: 'API 余额／可用额度不足，请检查所选地域、密钥所属账户及适用语音资源包；网页声贝不代表 API 可用额度', 2013: '参数或音色无效'}
        # Never echo arbitrary upstream text, URLs or credentials.
        code = str(status) if type(status) is int else 'unknown'
        raise TtsServiceError('MiniMax：' + (messages.get(status, '服务拒绝请求') if type(status) is int else '返回状态无效') + f'（{code}）')
    return value


class MiniMaxTts(CloudTts):
    provider, endpoints, models, languages, default = 'minimax', ENDPOINTS, MODELS, LANGUAGES, DEFAULT_RECIPE
    validate = staticmethod(validate_recipe)

    def fetch_voices(self, settings, cancel):
        content, _ = self.request(settings, 'POST', '/v1/get_voice', cancel, limit=4 * 1024 * 1024, json={'voice_type': 'all'})
        data = checked(content)
        rows = {}
        for group in ['system_voice', 'voice_cloning', 'voice_generation']:
            if not isinstance(data.get(group, []), list):
                raise TtsServiceError('MiniMax 音色列表格式无效')
            for row in data.get(group, []):
                identity = identifier(row.get('voice_id'))
                rows[identity] = {'id': identity, 'name': str(row.get('voice_name') or identity)[:255], 'group': group}
        return list(rows.values())


def synthesize(settings, text, cancel):
    r, controller = settings.recipe, settings.controller
    voice = {'voice_id': r['voice'], 'speed': r['speed'], 'vol': r['volume'], 'pitch': r['pitch']}
    if r['emotion']:
        voice['emotion'] = r['emotion']
    content, _ = controller.request(settings, 'POST', '/v1/t2a_v2', cancel, limit=MAX_AUDIO_BYTES * 2 + 65536,
                                    json={'model': r['model'], 'text': text, 'stream': False, 'output_format': 'hex',
                                          'language_boost': r['language_type'], 'voice_setting': voice,
                                          'audio_setting': {'sample_rate': 32000, 'bitrate': 128000, 'format': 'mp3', 'channel': 1}})
    data = checked(content).get('data')
    if not isinstance(data, dict) or data.get('status') != 2 or not isinstance(data.get('audio'), str):
        raise TtsServiceError('MiniMax 没有返回完整音频；未自动重试')
    try:
        audio = bytes.fromhex(data['audio'])
    except ValueError:
        raise TtsServiceError('MiniMax 音频编码无效') from None
    return controller.convert(audio, '.mp3', cancel)
