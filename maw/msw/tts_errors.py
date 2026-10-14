"""Small, redacted provider diagnostics; never persist raw requests/responses."""

import re

import requests


def safe_detail(value, secrets=(), limit=260):
    if not isinstance(value, str):
        return ''
    # Redact before truncation, including JSON-escaped echoes of submitted text.
    import json
    for secret in sorted((s for s in secrets if isinstance(s, str) and s), key=len, reverse=True):
        for form in (secret, json.dumps(secret, ensure_ascii=True)[1:-1]):
            value = value.replace(form, '[已隐藏]')
    value = re.sub(r'(?i)(?:https?|wss?)://[^\s<>"\']+', '[链接已隐藏]', value)
    value = re.sub(r'(?i)data:[^\s<>"\']+', '[数据已隐藏]', value)
    value = re.sub(r'(?i)\bBearer\s+[^\s,;"\']+', 'Bearer [已隐藏]', value)
    value = re.sub(r'(?i)\b(?:sk-[\w-]+|(?:api[_-]?key|token|signature|authorization)\s*[=:]\s*[^\s,;]+)', '[已隐藏]', value)
    value = re.sub(r'[\x00-\x1f\x7f]', ' ', value)
    return ' '.join(value.split())[:limit]


def qwen_http_error(response, settings, *, operation='合成', secrets=(), payload=None):
    """Keep only documented error fields, even for HTML or malformed errors."""
    if payload is None:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
    if not isinstance(payload, dict):
        payload = {}
    hidden = (settings.api_key, settings.recipe.get('voice'), settings.recipe.get('instructions'), *secrets)
    code = safe_detail(payload.get('code'), hidden, 80)
    message = safe_detail(payload.get('message'), hidden)
    request_id = safe_detail(payload.get('request_id') or getattr(response, 'headers', {}).get('X-Request-Id'), hidden, 100)
    # IDs and codes are identifiers, never arbitrary response bodies.
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,80}', code):
        code = ''
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', request_id):
        request_id = ''
    status = response.status_code
    detail = (code + ' ' + message).lower()
    if status == 401 or 'invalidapikey' in detail:
        hint = '请在环境配置中检查当前地域的 API Key'
    elif status == 429:
        hint = '服务限流或额度不足，请核对额度后稍后重试'
    elif 'voice' in detail and any(word in detail for word in ('not', 'invalid', 'expired', '不存在', '失效')):
        hint = '请核对音色是否仍有效、所属账号／地域及创建时绑定的模型；本机记录不代表云端音色仍可用'
    elif any(word in re.sub(r'[\s_.-]', '', detail) for word in ('modelnotexist', 'modeldoesnotexist', 'modelnotfound')):
        hint = '服务端未找到当前模型，请向百炼核对该地域的模型可用性与账号权限，并提供请求编号'
        if settings.recipe.get('model_type') in {'VoiceDesign', 'VoiceClone'}:
            hint += '；此自定义音色绑定创建时的模型，不能直接改用普通 Flash 模型'
    elif status == 404:
        hint = '请按服务端说明核对模型、音色及账号访问权限；仅凭 HTTP 404 无法确定哪一项不存在'
    elif status == 403:
        hint = '请核对当前账号的模型权限、业务空间及额度'
    elif status >= 500:
        hint = '服务端异常，请稍后手动重试'
    else:
        hint = '请核对本次模型、音色及参数'
    context = f"{settings.recipe['region']} / {settings.model}"
    fields = [f'百炼{operation}失败（HTTP {status}，{context}）']
    if code:
        fields.append(f'错误码：{code}')
    if request_id:
        fields.append(f'请求编号：{request_id}')
    if message:
        fields.append(f'服务端说明：{message}')
    fields.extend([hint, '未自动重试'])
    return '；'.join(fields)


def qwen_network_error(error, stage):
    if isinstance(error, requests.exceptions.SSLError):
        reason = 'TLS 证书验证失败，请检查系统时间、证书及代理'
    elif isinstance(error, requests.exceptions.ProxyError):
        reason = '代理连接失败，请检查代理设置'
    elif isinstance(error, requests.exceptions.Timeout):
        reason = '请求超时，请检查网络或稍后重试'
    elif isinstance(error, requests.exceptions.ConnectionError):
        reason = '连接失败或连接中断，请检查网络／代理'
    else:
        reason = '网络传输失败，请检查连接'
    return f'百炼{stage}失败（{type(error).__name__}）：{reason}；请求可能已计费，未自动重试'
