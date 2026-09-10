"""Editor-facing access to the same LLM settings used by Launcher.

Only the local application reads credentials. Public payloads never include them.
Tests inject an isolated settings path; no module-level credential reads occur.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

from maw.gui_config import load_env, save_env
from maw.env_config import aliased_values
from maw.postprocess_llm import DEFAULT_REASONING_MODE, PRESETS, LlmSettings, normalize_reasoning_mode
from maw.postprocess_pipeline import invalidate_llm_verification_if_changed


def preset_for(provider_id: str):
    for preset in PRESETS:
        if preset.id == provider_id:
            return preset
    raise ValueError("未知翻译服务")


def read_values(env_path: Path, prefix: str) -> dict[str, str]:
    values = load_env(env_path)
    environment = aliased_values(os.environ)
    def pick(name: str, default: str = "") -> str:
        # Keep Launcher's existing environment-over-file precedence and keys.
        if name.startswith("MAW_") and name in environment:
            return environment[name]
        return environment.get(name) or values.get(name, default)
    api_key = pick(f"{prefix}_API_KEY")
    if prefix == "MAW_POSTPROCESS_QWEN" and not api_key:
        api_key = pick("DASHSCOPE_API_KEY")
    return {
        "apiKey": api_key,
        "baseUrl": pick(f"{prefix}_BASE_URL"),
        "model": pick(f"{prefix}_MODEL"),
        "displayName": pick(f"{prefix}_DISPLAY_NAME"),
        "reasoningMode": pick(f"{prefix}_REASONING_MODE", DEFAULT_REASONING_MODE),
    }


def provider_payloads(env_path: Path) -> dict:
    providers = []
    for preset in PRESETS:
        values = read_values(env_path, preset.env_prefix)
        providers.append({
            "id": preset.id,
            "label": values["displayName"] or preset.label,
            "baseUrl": values["baseUrl"] or preset.base_url,
            "model": values["model"] or preset.model,
            "reasoningMode": values["reasoningMode"],
            "hasApiKey": bool(values["apiKey"]),
        })
    values = load_env(env_path)
    selected = values.get("MAW_POSTPROCESS_LAST_PROVIDER", "deepseek")
    return {"providers": providers, "selectedProvider": selected}


def resolve_settings(env_path: Path, payload: dict) -> LlmSettings:
    preset = preset_for(str(payload.get("providerId", "deepseek")))
    stored = read_values(env_path, preset.env_prefix)
    key = str(payload.get("apiKey") or stored["apiKey"]).strip()
    base_url = str(payload.get("baseUrl") or stored["baseUrl"] or preset.base_url).strip()
    model = str(payload.get("model") or stored["model"] or preset.model).strip()
    if not key:
        raise ValueError("请先填写 API Key，或在启动器配置同一翻译服务")
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("API 地址必须是有效的 HTTP(S) 地址，不能含凭据、查询参数或片段")
    if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("仅本机服务允许使用 HTTP，请为云端服务使用 HTTPS")
    if not model or len(model) > 256 or len(key) > 4096 or len(base_url) > 2048:
        raise ValueError("模型不能为空，且连接参数不能超过长度限制")
    return LlmSettings(preset.id, key, base_url, model,
                       normalize_reasoning_mode(payload.get("reasoningMode", stored["reasoningMode"])))


def save_settings(env_path: Path, payload: dict) -> dict:
    settings = resolve_settings(env_path, payload)
    preset = preset_for(settings.provider_id)
    old = read_values(env_path, preset.env_prefix)
    updates = {
        f"{preset.env_prefix}_API_KEY": settings.api_key,
        f"{preset.env_prefix}_BASE_URL": settings.base_url,
        f"{preset.env_prefix}_MODEL": settings.model,
        f"{preset.env_prefix}_REASONING_MODE": settings.reasoning_mode,
        "MAW_POSTPROCESS_LAST_PROVIDER": preset.id,
    }
    save_env(env_path, updates)
    invalidate_llm_verification_if_changed(env_path, preset.id, {
        "apiKey": old["apiKey"], "baseUrl": old["baseUrl"] or preset.base_url,
        "model": old["model"] or preset.model,
    }, {"apiKey": settings.api_key, "baseUrl": settings.base_url, "model": settings.model})
    return provider_payloads(env_path)
