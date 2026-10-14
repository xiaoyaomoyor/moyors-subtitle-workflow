"""Upload a voice reference to Bailian's private, expiring file storage."""

import re
import uuid
from urllib.parse import urlsplit

import requests

from maw.msw.audio_render import RenderCancelled
from maw.msw.tts_errors import qwen_http_error, qwen_network_error


def upload_reference(settings, audio, cancel, *, session_factory=requests.Session):
    def check():
        if cancel.is_set():
            raise RenderCancelled()

    check()
    try:
        with session_factory() as session:
            with session.get(settings.api_base + '/uploads', params={'action': 'getPolicy', 'model': 'voice-enrollment'},
                    headers={'Authorization': 'Bearer ' + settings.api_key}, timeout=(10, 30), allow_redirects=False) as response:
                if response.status_code != 200:
                    raise ValueError(qwen_http_error(response, settings, operation='获取参考音频上传凭证'))
                policy = response.json().get('data', {})
            host = policy.get('upload_host', '')
            url = urlsplit(host)
            if (url.scheme != 'https' or url.username or url.password or url.port or url.query or url.fragment
                    or url.path not in {'', '/'} or not re.fullmatch(r'dashscope[-a-z0-9]*\.oss-[a-z0-9-]+\.aliyuncs\.com', url.hostname or '')):
                raise ValueError('百炼返回的临时上传地址不受支持；未上传参考音频')
            fields = {'OSSAccessKeyId': policy.get('oss_access_key_id'), 'policy': policy.get('policy'),
                      'signature': policy.get('signature'), 'x-oss-object-acl': policy.get('x_oss_object_acl'),
                      'x-oss-forbid-overwrite': policy.get('x_oss_forbid_overwrite')}
            directory = policy.get('upload_dir')
            if (not all(isinstance(v, str) and v for v in fields.values()) or fields['x-oss-object-acl'] != 'private'
                    or not isinstance(directory, str) or not re.fullmatch(r'[A-Za-z0-9_/-]+', directory)):
                raise ValueError('百炼临时上传凭证无效；未上传参考音频')
            name = uuid.uuid4().hex + '.wav'
            fields.update(key=directory.rstrip('/') + '/' + name, success_action_status='200')
            check()
            # The API key goes only to Bailian's API; OSS receives scoped policy credentials.
            with session.post(host, data=fields, files={'file': (name, audio, 'audio/wav')},
                    timeout=(10, 90), allow_redirects=False) as response:
                if response.status_code != 200:
                    raise ValueError(f'百炼参考音频上传失败（HTTP {response.status_code}）；尚未创建音色')
            check()
            return 'oss://' + fields['key']
    except requests.RequestException as error:
        raise ValueError(qwen_network_error(error, '参考音频上传') + '；尚未创建音色') from None
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError('百炼临时上传凭证格式无效；尚未创建音色') from error
