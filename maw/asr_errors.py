"""Credential input checks and cloud ASR failure classification.

Only obvious paste mistakes are rejected locally. Provider-specific key shapes
and validity remain the provider's responsibility.
"""

from __future__ import annotations

import re

from maw.audio_diagnostics import AudioInputError, is_audio_extraction_failure


_HTTP_STATUS = re.compile(
    r"\bHTTP(?:/\d(?:\.\d)?)?\s*[:=(]?\s*([45]\d{2})\b"
    r"|\b([45]\d{2})\s+(?:Client|Server)\s+Error\b",
    re.IGNORECASE,
)
_KEY_ASSIGNMENT = re.compile(r"^(?:[\w-]*api[-_]?key|key|authorization)\s*[:=]", re.IGNORECASE)


def api_key_error_code(value: str) -> str:
    """Return a non-secret error code; do not impose a vendor prefix or length."""
    key = value.strip()
    if not key:
        return "api_key_missing"
    if (
        any(ord(char) < 33 or ord(char) > 126 or char in "\"'" for char in key)
        or key.casefold().startswith(("http://", "https://"))
        or _KEY_ASSIGNMENT.match(key)
    ):
        return "api_key_invalid_format"
    return ""


def redact_asr_text(value: object, api_key: str) -> str:
    """Remove the active credential locally before emitting or persisting text.

    This replacement is for redaction only, never a key-validity check.
    """
    text = str(value)
    key = api_key.strip()
    return text.replace(key, "[REDACTED]") if key else text


def asr_error_code(error: BaseException, *, provider: str) -> str:
    """Recognize explicit API evidence without confusing local engine failures.

    TranscriptionProcessError keeps the complete child output even when its
    summary only contains the last line of a multi-line provider exception.
    Prefer the final exception block over earlier retry warnings.
    """
    if isinstance(error, AudioInputError):
        return error.code
    child_output = getattr(error, "output", ())
    if not isinstance(child_output, (list, tuple)):
        child_output = ()
    if is_audio_extraction_failure(child_output):
        return "audio_extraction_failed"
    if provider == "local":
        return ""
    detail = str(error)
    if child_output:
        trace = "\n".join(child_output)
        exceptions = list(re.finditer(r"^(?:[\w.]+(?:Error|Exception):|错误[:：])", trace, re.MULTILINE))
        if exceptions:
            detail = trace[exceptions[-1].start():]
    statuses = list(_HTTP_STATUS.finditer(detail))
    if statuses:
        match = statuses[-1]
        status = int(match.group(1) or match.group(2))
        if status == 401:
            return "asr_auth_failed"
        if status == 403:
            return "asr_permission_denied"
        if status == 404:
            return "asr_endpoint_invalid"
        if status == 429:
            return "asr_rate_limited"
        if status >= 500:
            return "asr_service_unavailable"
        if status == 408:
            return "asr_timeout"
        if status in {400, 413, 415, 422}:
            return "asr_request_invalid"
    lowered = detail.casefold()
    if re.search(r"\b(?:invalid_?api_?key|incorrect_api_key|unauthenticated|authfailure(?:\.[\w]+)?)\b", lowered):
        return "asr_auth_failed"
    if re.search(r"\b(?:invalid|incorrect) api[- ]?key\b", lowered):
        return "asr_auth_failed"
    if "invalidheader:" in lowered and ("authorization" in lowered or "api-key" in lowered):
        return "api_key_invalid_format"
    if isinstance(error, TimeoutError) or any(marker in lowered for marker in (
        "timeouterror:", "readtimeout:", "connecttimeout:", "timed out", "转写超时", "asr 任务超时",
    )):
        return "asr_timeout"
    if any(marker in lowered for marker in (
        "requests.exceptions.connectionerror:", "requests.exceptions.proxyerror:",
        "requests.exceptions.sslerror:", "newconnectionerror", "name resolution",
        "failed to establish a new connection", "connection refused",
    )):
        return "asr_network_error"
    return ""


ASR_ERROR_MESSAGES = {
    'api_key_invalid_format': 'API Key 格式有误，请只粘贴密钥本身，不要包含空格、引号、地址或字段名。',
    'asr_auth_failed': 'ASR 服务拒绝了密钥，请检查当前服务的 API Key。',
    'asr_permission_denied': 'ASR 服务拒绝访问，请检查账号权限、模型授权及服务区域。',
    'asr_endpoint_invalid': 'ASR 服务地址或模型不存在，请检查连接配置。',
    'asr_rate_limited': 'ASR 服务限流或额度不足，请检查额度，稍后重试。',
    'asr_service_unavailable': 'ASR 服务暂时不可用，请稍后重试。',
    'asr_timeout': 'ASR 请求超时，请检查网络和服务状态后重试。',
    'asr_request_invalid': 'ASR 服务不接受当前请求，请检查模型、识别参数及音频格式或大小。',
    'asr_network_error': '无法连接 ASR 服务，请检查网络、代理和服务地址。',
    'audio_no_stream': '媒体没有可用音轨，请选择包含音频的文件。',
    'audio_extraction_failed': '提取 ASR 音频失败，请检查源媒体和所选音轨。',
    'asr_empty_result': '未识别到可用文字，请试听所选范围，确认包含清晰语音，并检查识别语言。',
    'asr_empty_result_multitrack': '未识别到可用文字。该媒体有多条音轨，请先试听并确认选择了人声音轨，再检查识别范围和语言。',
}
