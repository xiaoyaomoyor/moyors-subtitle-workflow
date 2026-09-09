"""Bailian Qwen3 HTTP adapter. Provider credentials never enter project recipes."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

import requests

from maw.gui_config import load_env, save_env
from maw.msw.project_codec import valid_cue_id, valid_id
from maw.msw.qwen_catalog import MODELS, MODEL_TYPES, model_type, voices_for, catalog_payload

ENDPOINTS = {
    "beijing": "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    "singapore": "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
}
LANGUAGES = ["Auto", "Chinese", "English", "German", "Italian", "Portuguese", "Spanish",
             "Japanese", "Korean", "French", "Russian"]
DEFAULT_RECIPE = {"provider": "qwen", "region": "beijing", "model_type": "CustomVoice", "model": MODELS[0], "voice": "Cherry",
                  "language_type": "Auto", "instructions": "", "optimize_instructions": False}
MAX_AUDIO_BYTES = 32 * 1024 * 1024


class TtsServiceError(ValueError):
    """A service/configuration failure stops the batch without automatic retries."""


def validate_recipe(raw, *, require_voice=True):
    if not isinstance(raw, dict):
        raise ValueError("TTS 配置格式无效")
    value = {key: raw.get(key, default) for key, default in DEFAULT_RECIPE.items()}
    if "model_type" not in raw:
        value["model_type"] = model_type(value["model"])
    if value["provider"] != "qwen" or value["region"] not in ENDPOINTS or value["model"] not in MODELS:
        raise ValueError("不支持的 TTS 服务、地域或模型")
    if value["model_type"] not in MODEL_TYPES or value["model"] not in MODEL_TYPES[value["model_type"]]:
        raise ValueError("配音模式与百炼模型不匹配")
    voice = value["voice"]
    if not isinstance(voice, str) or (not voice and require_voice) or (voice and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_ -]{0,255}", voice)):
        raise ValueError("请选择或填写有效的百炼音色 ID")
    known = {row["id"] for row in voices_for(MODELS[0])}
    if voice in known and voice not in {row["id"] for row in voices_for(value["model"])}:
        raise ValueError("此系统音色不支持当前模型；请重新选择音色")
    if value["language_type"] not in LANGUAGES:
        raise ValueError("不支持的 TTS 语言")
    if not isinstance(value["instructions"], str) or len(value["instructions"]) > 1600:
        raise ValueError("声音描述请限制在 1600 字符以内，且不超过服务商 1600 Token 限制")
    if not isinstance(value["optimize_instructions"], bool):
        raise ValueError("指令优化必须是开关值")
    if "-instruct-" not in value["model"]:
        if value["instructions"] or value["optimize_instructions"]:
            raise ValueError("仅 Instruct 模型支持声音描述和指令优化")
    return value


@dataclass(frozen=True)
class TtsSettings:
    api_key: str
    recipe: dict

    @property
    def provider_id(self):
        return "qwen"

    @property
    def model(self):
        return self.recipe["model"]

    @property
    def base_url(self):
        return ENDPOINTS[self.recipe["region"]]

    reasoning_mode = "off"


def config_payload(env_path):
    values = load_env(env_path)
    def pick(name, default=""):
        return os.environ.get(name) or values.get(name, default)
    import json
    try:
        recipe = validate_recipe(json.loads(pick("MSW_TTS_RECIPE", "{}")), require_voice=False)
    except (ValueError, TypeError):
        recipe = dict(DEFAULT_RECIPE)
    return {"recipe": recipe, "models": MODELS, "languages": LANGUAGES, **catalog_payload(),
            "regions": [{"id": region, "hasApiKey": bool(pick(f"MSW_TTS_{region.upper()}_API_KEY")
                or (region == "beijing" and pick("DASHSCOPE_API_KEY")))} for region in ENDPOINTS]}


def resolve_settings(env_path, raw, *, require_voice=True):
    if not isinstance(raw, dict):
        raise ValueError("TTS 配置格式无效")
    recipe = validate_recipe(raw.get("recipe", config_payload(env_path)["recipe"]), require_voice=require_voice)
    values = load_env(env_path)
    key_name = f"MSW_TTS_{recipe['region'].upper()}_API_KEY"
    key = raw.get("apiKey") or os.environ.get(key_name) or values.get(key_name)
    if not key and recipe["region"] == "beijing":
        key = os.environ.get("DASHSCOPE_API_KEY") or values.get("DASHSCOPE_API_KEY")
    if not isinstance(key, str) or not key.strip() or len(key) > 4096 or any(c in key for c in "\r\n"):
        raise ValueError("请填写所选地域的百炼 API Key")
    return TtsSettings(key.strip(), recipe)


def save_settings(env_path, raw):
    import json
    settings = resolve_settings(env_path, raw, require_voice=False)
    save_env(env_path, {f"MSW_TTS_{settings.recipe['region'].upper()}_API_KEY": settings.api_key,
                        "MSW_TTS_RECIPE": json.dumps(settings.recipe, ensure_ascii=False)})
    return config_payload(env_path)


def validate_snapshot(raw):
    if not isinstance(raw, dict) or not valid_id(raw.get("project_id")):
        raise ValueError("TTS 任务缺少工程标识")
    entries = raw.get("entries")
    if not isinstance(entries, list) or not 1 <= len(entries) <= 10000:
        raise ValueError("请选择 1–10000 条字幕")
    clean, seen = [], set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("TTS 字幕格式无效")
        key, track = entry.get("key"), entry.get("track_id")
        if not valid_id(key) or key in seen or not valid_cue_id(entry.get("id")):
            raise ValueError("TTS 来源标识无效或重复")
        if track is not None and not valid_cue_id(track):
            raise ValueError("TTS 来源轨道无效")
        text = entry.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 600:
            raise ValueError("每条 TTS 字幕须为 1–600 字符；请先拆分过长字幕")
        start, end = entry.get("start"), entry.get("end")
        if type(start) is not int or type(end) is not int or not 0 <= start < end:
            raise ValueError("TTS 字幕时间须为有效整数毫秒")
        seen.add(key)
        clean.append({"key": key, "id": entry["id"], "track_id": track, "text": text, "start": start, "end": end})
        override = entry.get("pronunciation_override", "")
        if not isinstance(override, str) or len(override) > 600:
            raise ValueError("读音修正请限制在 600 字符以内")
        if override.strip():
            clean[-1]["pronunciation_override"] = override.strip()
    if sum(len(entry["text"]) for entry in clean) > 1000000:
        raise ValueError("单次 TTS 文本过长，请分批选择")
    return {"project_id": raw["project_id"], "entries": clean}


def audio_download_url(value):
    """Only provider-owned result buckets; never follow redirects or send API keys."""
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError("百炼没有返回有效音频地址")
    url = urlsplit(value)
    host = url.hostname or ""
    if (url.scheme not in {"https", "http"} or url.username or url.password or url.port
            or url.fragment or not re.fullmatch(r"dashscope-result[-a-z0-9]*\.oss-[a-z0-9-]+\.aliyuncs\.com", host)):
        raise ValueError("百炼返回的音频地址不受支持")
    # Bailian examples return HTTP OSS links. OSS signatures also support HTTPS.
    return urlunsplit(("https", url.netloc, url.path, url.query, ""))


def synthesize(settings, text, cancel, *, session_factory=requests.Session):
    from maw.msw.jobs import JobCancelled
    def check():
        if cancel.is_set():
            raise JobCancelled()
    check()
    recipe = settings.recipe
    body = {"model": settings.model, "input": {"text": text, "voice": recipe["voice"],
                                               "language_type": recipe["language_type"]}}
    if "-instruct-" in settings.model and recipe["instructions"]:
        body["input"].update(instructions=recipe["instructions"], optimize_instructions=recipe["optimize_instructions"])
    with session_factory() as session:
        try:
            with session.post(settings.base_url, json=body, headers={"Authorization": f"Bearer {settings.api_key}"},
                              timeout=(10, 180), allow_redirects=False) as response:
                if response.status_code != 200:
                    raise TtsServiceError(f"百炼合成失败（HTTP {response.status_code}）；本批已暂停，请检查地域、密钥、音色和额度")
                payload = response.json()
            check()
            url = audio_download_url(payload.get("output", {}).get("audio", {}).get("url"))
            with session.get(url, headers={"Accept-Encoding": "identity"},
                             timeout=(10, 90), stream=True, allow_redirects=False) as response:
                if response.status_code != 200:
                    raise ValueError("合成请求已完成，但音频下载失败；重新合成可能再次计费")
                headers = response.headers
                expected = headers.get("Content-Length")
                if expected is not None and headers.get("Content-Encoding", "").strip().lower() not in {"", "identity"}:
                    expected = None  # iter_content decodes compressed responses.
                if expected is not None:
                    if not expected.isascii() or not expected.isdecimal():
                        raise ValueError("音频下载响应的长度无效")
                    expected = int(expected)
                    if expected > MAX_AUDIO_BYTES:
                        raise ValueError("音频超过单条 32 MiB 限制")
                chunks, size = [], 0
                for chunk in response.iter_content(65536):
                    check()
                    size += len(chunk)
                    if size > MAX_AUDIO_BYTES:
                        raise ValueError("音频超过单条 32 MiB 限制")
                    chunks.append(chunk)
                check()
                if expected is not None and size != expected:
                    raise ValueError(f"音频下载不完整（HTTP 声明 {expected} 字节，实际收到 {size} 字节）；未自动重试")
                return b"".join(chunks)
        except requests.RequestException as error:
            # Transport exceptions may include a signed URL. Do not persist them.
            raise TtsServiceError("百炼请求或音频下载超时／网络失败；请求可能已计费，未自动重试") from error
        except (KeyError, TypeError, AttributeError) as error:
            raise ValueError("百炼返回格式无效；未自动重试") from error


class TtsService:
    def __init__(self, assets, *, synthesize_one=synthesize):
        self.assets = assets
        self.synthesize_one = synthesize_one

    def run(self, job, settings, cancel, progress):
        from maw.msw.jobs import JobCancelled
        result = {"items": []}
        ready, failed = 0, 0
        entries = job["snapshot"]["entries"]
        for index, entry in enumerate(entries):
            if cancel.is_set():
                raise JobCancelled()
            try:
                spoken = entry["text"]
                if settings.provider_id == "yukkuri":
                    from maw.msw.yukkuri import synthesize as synthesize_local
                    audio, spoken = synthesize_local(settings, entry.get("pronunciation_override") or entry["text"], cancel)
                else:
                    audio = self.synthesize_one(settings, entry["text"], cancel)
                if cancel.is_set():
                    raise JobCancelled()
                asset = self.assets.add(job["project_id"], job["id"], entry, settings.recipe, audio, spoken_text=spoken)
                item = {"key": entry["key"], "status": "ready", "asset_id": asset["id"]}
            except JobCancelled:
                raise
            except TtsServiceError:
                raise
            except Exception as error:
                detail = str(error).replace(settings.api_key, "[已隐藏]") if settings.api_key else str(error)
                item = {"key": entry["key"], "status": "failed", "error": detail[:500]}
            result["items"].append(item)
            ready += item["status"] == "ready"
            failed += item["status"] == "failed"
            progress("synthesizing", {"current": index + 1, "total": len(entries),
                "ready": ready, "failed": failed}, {"items": [item]})
        return result
