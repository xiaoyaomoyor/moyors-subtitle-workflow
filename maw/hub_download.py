"""Shared, lazy HF / ModelScope downloads for MSW's local model loaders.

Only verified mirrors are eligible for fallback. Explicit directories stay local;
authentication, invalid repositories and filesystem errors are never retried on
another service. Workers still own process cancellation during a transfer.
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


MODELSCOPE_REPO_ALIASES = {
    "Qwen/Qwen3-ASR-0.6B": "Qwen/Qwen3-ASR-0.6B",
    "Qwen/Qwen3-ASR-1.7B": "Qwen/Qwen3-ASR-1.7B",
    "Qwen/Qwen3-ForcedAligner-0.6B": "Qwen/Qwen3-ForcedAligner-0.6B",
    "OpenMOSS-Team/MOSS-Transcribe-Diarize": "OpenMOSS/MOSS-Transcribe-Diarize",
    "Systran/faster-whisper-large-v3": "Systran/faster-whisper-large-v3",
}
# Both commits contain identical runtime files (including remote Python code).
# Verified against the two official repository manifests on 2026-11-15.
MIRROR_REVISIONS = {
    ("OpenMOSS-Team/MOSS-Transcribe-Diarize", "e8681d68e7042738ffca8ac8212bc8fcb1131ab8"):
        "5999c187e773f139040f1147df8446b1e600c520",
}
_REPO_ID = re.compile(r"[\w.-]+/[\w.-]+\Z")
_WEIGHTS = {".safetensors", ".bin", ".pt", ".pth"}


@dataclass(frozen=True)
class HubSnapshot:
    path: Path
    source: str


def read_config_object(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def snapshot_is_complete(path: Path) -> bool:
    """Check the snapshot itself, not a parent containing another snapshot.

Hub libraries verify transfer hashes; this inexpensive offline check additionally
rejects missing config, empty weights and incomplete sharded checkpoints.
"""
    try:
        if read_config_object(path / "config.json") is None:
            return False
        weights = [p for p in path.iterdir() if p.is_file() and p.suffix in _WEIGHTS and p.stat().st_size > 0]
        if not weights:
            return False
        indexes = list(path.glob("*.index.json"))
        for index in indexes:
            mapping = (read_config_object(index) or {}).get("weight_map")
            if not isinstance(mapping, dict) or not mapping:
                return False
            if any(not isinstance(name, str) or Path(name).name != name for name in mapping.values()):
                return False
            for name in set(mapping.values()):
                part = path / name
                if not part.is_file() or part.stat().st_size == 0:
                    return False
        for weight in weights:
            if re.search(r"-\d+-of-\d+\.", weight.name) and not indexes:
                return False
        return True
    except (OSError, ValueError, TypeError):
        return False


def modelscope_repo_id(repo_id: str) -> str:
    return MODELSCOPE_REPO_ALIASES.get(repo_id, "")


def repo_snapshot_dirs(repo: Path) -> list[Path]:
    try:
        return sorted(
            (path for path in (repo / "snapshots").iterdir() if path.is_dir()),
            key=lambda path: (path.stat().st_mtime, path.name),
            reverse=True,
        )
    except OSError:
        return []


def matches_mirror_snapshot(path: Path, repo_id: str, revision: str) -> bool:
    mirror_revision = MIRROR_REVISIONS.get((repo_id, revision))
    return bool(mirror_revision) and (
        path.name == mirror_revision or
        read_config_object(path / ".msw-hub.json") ==
        {"repo": modelscope_repo_id(repo_id), "revision": mirror_revision}
    )


def find_hub_snapshot(repo_id: str, model_cache_root=None, *, revision: str = "") -> HubSnapshot | None:
    # Discovery imports no optional ML packages. Kept here so both preparation
    # and GUI status use precisely the same snapshot selection rules.
    from maw.local_models import _huggingface_repo_paths, _modelscope_cache_roots, _modelscope_repo_candidates

    for repo in _huggingface_repo_paths(repo_id, model_cache_root):
        root = repo / "snapshots"
        if revision:
            ref = repo / "refs" / revision
            commit = ref.read_text(encoding="utf-8").strip() if ref.is_file() else revision
            candidates = [root / commit]
        else:
            candidates = [*repo_snapshot_dirs(repo), repo]
        for path in candidates:
            if snapshot_is_complete(path):
                return HubSnapshot(path.resolve(), "huggingface")
    mirror = modelscope_repo_id(repo_id)
    mirror_revision = MIRROR_REVISIONS.get((repo_id, revision), "")
    if not mirror or (revision and not mirror_revision):
        return None
    for root in _modelscope_cache_roots(model_cache_root):
        for repo in _modelscope_repo_candidates(root, mirror.split("/")):
            candidates = [*repo_snapshot_dirs(repo), repo]
            for path in candidates:
                if not snapshot_is_complete(path):
                    continue
                if mirror_revision and not matches_mirror_snapshot(path, repo_id, revision):
                    continue
                return HubSnapshot(path.resolve(), "modelscope")
    return None


def _network_failure(error: Exception) -> bool:
    """Follow wrapped transport errors without treating every OSError as network."""
    seen = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        # HF's LocalEntryNotFoundError also subclasses FileNotFoundError; when
        # its cause is a failed HEAD request it must still be eligible.
        if isinstance(current, (PermissionError, IsADirectoryError)):
            return False
        status = getattr(getattr(current, "response", None), "status_code", None)
        if status is not None:
            return status in {408, 429} or 500 <= status < 600
        if isinstance(current, (ConnectionError, TimeoutError)):
            return True
        # requests/httpx/urllib3 are optional in cloud-only installations.
        module = type(current).__module__.split(".")[0]
        transport_types = {base.__name__ for base in type(current).__mro__}
        if module in {"requests", "httpx", "httpcore", "urllib3"} and transport_types & {
            "ConnectionError", "Timeout", "TimeoutException", "NetworkError", "ProtocolError",
            "ProxyError", "NewConnectionError", "MaxRetryError", "ConnectTimeoutError",
            "ReadTimeoutError", "SSLError", "ChunkedEncodingError",
        }:
            return True
        current = current.__cause__ or current.__context__
    return False


def _cancelled(cancel_event):
    if cancel_event is not None and cancel_event.is_set():
        raise RuntimeError("模型准备已取消。")


def prepare_hub_snapshot(repo_id: str, *, model_cache_root=None,
                         emit: Callable[[str], None] | None = None,
                         cancel_event: threading.Event | None = None,
                         revision: str = "") -> HubSnapshot:
    from maw.alignment_models import model_cache_environment

    if not _REPO_ID.fullmatch(repo_id):
        raise ValueError("无效的模型仓库 ID。")
    notify = emit or (lambda message: None)
    _cancelled(cancel_event)
    cached = find_hub_snapshot(repo_id, model_cache_root, revision=revision)
    if cached is not None:
        notify(f"[hub] 复用 {cached.source} 缓存：{repo_id}")
        return cached
    env = model_cache_environment(model_cache_root)
    from huggingface_hub import snapshot_download as hf_download

    try:
        notify(f"[hub] 正在从 Hugging Face 下载 {repo_id}……")
        path = Path(hf_download(repo_id=repo_id, cache_dir=env["HF_HUB_CACHE"], **({"revision": revision} if revision else {})))
        _cancelled(cancel_event)
        if not snapshot_is_complete(path):
            raise RuntimeError("Hugging Face 模型文件不完整，请重新准备模型。")
        return HubSnapshot(path, "huggingface")
    except Exception as error:
        _cancelled(cancel_event)
        mirror = modelscope_repo_id(repo_id)
        mirror_revision = MIRROR_REVISIONS.get((repo_id, revision), "")
        if not _network_failure(error) or not mirror or (revision and not mirror_revision):
            raise
        # Exception bodies can contain signed download URLs or credentials.
        hf_reason = type(error).__name__
    notify(f"[hub] Hugging Face 网络失败（{hf_reason}），改用 ModelScope：{mirror}")
    _cancelled(cancel_event)
    try:
        from modelscope import snapshot_download as ms_download
    except ImportError as error:
        raise RuntimeError("ModelScope 回退缺少依赖，请修复本地运行环境。") from error
    try:
        path = Path(ms_download(mirror, cache_dir=env["MODELSCOPE_CACHE"], **({"revision": mirror_revision} if mirror_revision else {})))
        _cancelled(cancel_event)
        if not snapshot_is_complete(path):
            raise RuntimeError("ModelScope 模型文件不完整，请重新准备模型。")
        if mirror_revision:
            (path / ".msw-hub.json").write_text(json.dumps({"repo": mirror, "revision": mirror_revision}) + "\n", encoding="utf-8")
        notify(f"[hub] ModelScope 下载完成：{mirror}")
        return HubSnapshot(path, "modelscope")
    except Exception as error:
        _cancelled(cancel_event)
        if not _network_failure(error):
            raise
        raise RuntimeError(f"两处下载均失败（Hugging Face：{hf_reason}；ModelScope：{type(error).__name__}），请检查网络后重试。") from error


def resolve_model_source(value: str, *, emit=None, revision: str = "") -> str:
    """Resolve repository IDs; leave aliases to their engine and paths local."""
    path = Path(value).expanduser()
    if path.is_dir():
        return str(path)
    if _REPO_ID.fullmatch(value) and not value.startswith(("./", "../")):
        return str(prepare_hub_snapshot(value, emit=emit, revision=revision).path)
    if path.is_absolute() or "\\" in value or "/" in value:
        raise ValueError("指定的模型目录不存在。")
    return value
