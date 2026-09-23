"""Versioned, mixed-input launcher jobs. No UI modes or persisted credentials."""
from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, replace
from pathlib import Path
from threading import Event
from tempfile import TemporaryDirectory

from maw.gui_workflow import (
    TranscriptionCancelledError, default_srt_path, run_transcription, unique_output_path, render_editor_html,
)
from maw.gui_config import DEFAULT_MODEL_ID
from maw.media import MEDIA_EXTENSIONS, probe_audio_tracks, resolve_project_media
from maw.media_cache import MediaCacheCancelled, embed_media_caches
from maw.postprocess_io import read_project, read_srt, render_srt, write_derived_project, _atomic_write, project_from_subtitle_segments
from maw.postprocess_pipeline import (
    PostprocessCancelled, enabled_steps, run_postprocess_pipeline,
    snapshot_postprocess_llm_settings, validate_plan,
)
from maw.project import normalize_project
from maw.launcher_outputs import publish_outputs
from maw.project_io import (
    discard_stale_inline_caches, enrich_project_media_metadata, persist_audio_track,
    selected_audio_track_from_project,
)

VERSION = 2
SUBTITLES = {".srt", ".ass"}
PROJECTS = {".mosp", ".json"}


def input_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    return "project" if suffix in PROJECTS else "subtitle" if suffix in SUBTITLES else "media" if suffix in MEDIA_EXTENSIONS else "unsupported"


def _existing(value) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("请选择输入文件。")
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"文件不存在或不可读：{path.name}")
    return path


def _read_ass(path: Path) -> dict:
    """Import dialogue timing/text only; styles and drawing events are not subtitles."""
    text = path.read_text(encoding="utf-8-sig")
    fields, segments, in_events = [], [], False
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("["):
            in_events = line.lower() == "[events]"
        if not in_events:
            continue
        if line.lower().startswith("format:"):
            fields = [s.strip().lower() for s in line.split(":", 1)[1].split(",")]
        elif line.lower().startswith("dialogue:"):
            if not all(f in fields for f in ("start", "end", "text")) or fields[-1] != "text":
                raise ValueError("ASS 的 Events Format 缺少有效的 Start、End、Text 字段。")
            values = line.split(":", 1)[1].split(",", len(fields) - 1)
            if len(values) != len(fields):
                raise ValueError("ASS 对话行字段不完整。")
            row = dict(zip(fields, values))
            def timestamp(value):
                match = re.fullmatch(r"\s*(\d+):(\d{2}):(\d{2})\.(\d{2})\s*", value)
                if not match:
                    raise ValueError("ASS 时间格式无效。")
                h, m, s, cs = map(int, match.groups())
                if m >= 60 or s >= 60:
                    raise ValueError("ASS 时间格式无效。")
                return ((h * 60 + m) * 60 + s) * 1000 + cs * 10
            content = row["text"]
            if re.search(r"\\p[1-9]", content):
                continue
            content = re.sub(r"\{[^}]*\}", "", content).replace(r"\N", "\n").replace(r"\n", "\n").replace(r"\h", " ")
            segments.append({"start": timestamp(row["start"]), "end": timestamp(row["end"]), "text": content})
    if not fields:
        raise ValueError("未找到有效的 ASS Events。")
    return project_from_subtitle_segments(sorted(segments, key=lambda s: (s["start"], s["end"])), source=path)


def read_input(path: Path) -> dict:
    kind = input_kind(path)
    if kind == "project":
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(raw, dict) or not isinstance(raw.get("segments"), list):
            raise ValueError("该 JSON 不是字幕工程：缺少 segments 列表。")
        return normalize_project(raw)
    if kind == "subtitle":
        return _read_ass(path) if path.suffix.lower() == ".ass" else read_srt(path)
    if kind == "media":
        return normalize_project({"media": str(path), "segments": []})
    raise ValueError("不支持该文件类型；请选择媒体、工程或 SRT/ASS 字幕。")


def subtitle_count(project):
    count = len(project.get('segments', []))
    if (project.get('overlay_track') or {}).get('enabled') is True:
        count += len(project['overlay_track'].get('segments', []))
    if (project.get('multi_subtitle') or {}).get('enabled') is True:
        count += sum(len(track.get('segments', [])) for track in project['multi_subtitle'].get('tracks', []))
    return count


def inspect_input(value, *, ffprobe_path=None) -> dict:
    path = _existing(value)
    project = read_input(path)
    kind = input_kind(path)
    media = path if kind == "media" else resolve_project_media(path, project).resolved_path if kind == "project" else None
    if media and not media.is_file():
        media = None
    tracks = probe_audio_tracks(media, ffprobe_path=ffprobe_path) if media else None
    default_track = next((t["audio_index"] for t in tracks or [] if t.get("default")), 0)
    selected = selected_audio_track_from_project(project) if kind == "project" else default_track
    warnings = []
    if path.suffix.lower() == ".ass":
        warnings.append("ASS 仅导入时间与文本；样式、位置、特效和绘图不导入。")
    if kind == "project" and project.get("media") and not media:
        warnings.append("工程媒体失联；仍可处理字幕，音频处理需重新关联媒体。")
    return {
        "path": str(path), "kind": kind, "mediaPath": str(media or ""),
        "hasSubtitles": bool(subtitle_count(project)), "subtitleCount": subtitle_count(project),
        "audioTracks": tracks, "audioTrack": selected, "defaultAudioTrack": default_track,
        "warnings": warnings,
    }


@dataclass
class PreparedTask:
    id: str
    source: Path
    project: dict
    media: Path | None
    track: int
    default_track: int
    output: Path
    postprocess: dict
    llm_settings: dict
    request: object = None
    waveform: bool = False
    spectral: bool = False
    export_srt: bool = True
    warnings: list | None = None
    srt_only: bool = False
    generate_html: bool = False
    language: str = "zh"
    rebuild_waveform: bool = False
    original_srt_target: Path | None = None


def prepare_queue(plan, *, env_path, tools, request_builder):
    """Validate every task before starting any work, including service parameters."""
    if not isinstance(plan, dict) or plan.get("version") != VERSION:
        return [], [{"message": "任务方案版本无效。", "module": "media"}]
    if plan.get("pendingAssociations"):
        return [], [{"message": "请先确认文件关联，或选择分别处理。", "module": "media"}]
    raw_tasks = plan.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        return [], [{"message": "请添加需要处理的文件。", "module": "media"}]
    modules, output = plan.get("modules", {}), plan.get("output", {})
    if not isinstance(modules, dict) or not isinstance(output, dict):
        return [], [{"message": "任务参数格式无效。", "module": "media"}]
    prepared, errors, identities, sources, reserved = [], [], set(), set(), set()
    for raw in raw_tasks:
        task_id = str(raw.get("id", "")) if isinstance(raw, dict) else ""
        module = "media"
        try:
            if not task_id or task_id in identities:
                raise ValueError("任务 ID 缺失或重复。")
            identities.add(task_id)
            source = _existing(raw.get("path"))
            if source in sources:
                raise ValueError("队列中重复添加了同一输入文件。")
            sources.add(source)
            project = read_input(source)
            info = inspect_input(str(source), ffprobe_path=tools.ffprobe)
            media = _existing(raw["mediaPath"]) if raw.get("mediaPath") else Path(info["mediaPath"]) if info["mediaPath"] else None
            if media and input_kind(media) != "media":
                raise ValueError("关联的媒体格式不支持。")
            if raw.get("mediaPath") and str(media) != info["mediaPath"]:
                project.pop("media_metadata", None)
            if raw.get("subtitlePath"):
                subtitle = _existing(raw["subtitlePath"])
                if input_kind(subtitle) != "subtitle" or info["kind"] != "media":
                    raise ValueError("只允许将字幕关联到媒体任务；已有工程的字幕不能被隐式覆盖。")
                imported = read_input(subtitle)
                project['segments'] = imported['segments']
                if 'overlay_track' in imported:
                    project['overlay_track'] = copy.deepcopy(imported['overlay_track'])
                if subtitle.suffix.lower() == ".ass":
                    info["warnings"].append("ASS 仅导入时间与文本，不导入样式。")
            tracks = probe_audio_tracks(media, ffprobe_path=tools.ffprobe) if media else None
            default_track = next((t["audio_index"] for t in tracks or [] if t.get("default")), 0)
            track = raw.get("audioTrack", info["audioTrack"])
            if track is None:
                track = default_track
            if type(track) is not int or track < 0 or (tracks and track not in {t["audio_index"] for t in tracks}):
                raise ValueError("所选音轨无效，请重新选择。")
            has_subtitles = bool(subtitle_count(project))
            recognize = bool(modules.get("asr")) and (not has_subtitles or plan.get("asrPolicy") == "replace")
            if recognize and (not media or tracks == []):
                module = "asr"
                raise ValueError("识别需要可用的媒体音轨；请关联媒体或关闭识别。")
            post = copy.deepcopy(plan.get("postprocess") or {"steps": []})
            active = set(modules.get("postprocess", []))
            for step in post.get("steps", []):
                step["enabled"] = step.get("id") in active
                if step.get("id") == "match" and (len(raw_tasks) > 1 or raw.get("scriptPath")):
                    step["scriptPath"] = str(raw.get("scriptPath") or "")
                if step.get("id") == "ocr" and raw.get("ocrVideoPath"):
                    step["videoPath"] = str(raw["ocrVideoPath"])
            post["enabled"] = bool(active)
            post.update(outputSemantics="separate-v2", exportSrt=output.get("exportSrt", True),
                        exportTranslatedSrt=output.get("exportTranslatedSrt", True),
                        exportBilingualSrt=output.get("exportBilingualSrt", False))
            if active and not has_subtitles and not recognize:
                module = next(iter(active))
                raise ValueError("该任务没有字幕来源，请关联字幕或开启识别。")
            if output.get("srtOnly") and not recognize and not render_srt(project).strip():
                module = "output"
                raise ValueError("只生成 SRT 需要已有字幕，或启用识别。")
            bilingual_enabled = any(s.get("id") == "translate" and s.get("mergeBilingual") for s in post.get("steps", []))
            if output.get("srtOnly") and output.get("exportSrt") is False and not ("translate" in active and (output.get("exportTranslatedSrt", True) or (bilingual_enabled and output.get("exportBilingualSrt")))):
                module = "output"
                raise ValueError("只生成 SRT 时至少选择一种可输出的字幕。")
            post, problems = validate_plan(post, env_path=env_path, media_path=media or source, ffmpeg_path=tools.ffmpeg)
            if problems:
                errors.extend({"taskId": task_id, "module": p.get("step") or "media", "field": p.get("field"), "message": p["message"]} for p in problems)
                continue
            recognition = plan.get("recognition", {})
            anchor = default_srt_path(source, provider=recognition.get("providerId") or "qwen",
                                      model=recognition.get("modelId") or DEFAULT_MODEL_ID,
                                      test_run=bool(recognize and recognition.get("testRun")),
                                      env_path=env_path, **({"attach_model_name": False} if not recognize else {}))
            if output.get("directory"):
                anchor = Path(output["directory"]).expanduser().resolve() / anchor.name
            if output.get("projectName"):
                name = str(output["projectName"])
                if Path(name).name != name or re.search(r'[<>:"/\\|?*]', name):
                    module = "output"
                    raise ValueError("工程名称不能包含路径或保留字符。")
                anchor = anchor.with_name(name + ".srt")
            original_target = None
            if len(raw_tasks) == 1 and output.get("srtPath") and output.get("exportSrt", True):
                original_target = Path(output["srtPath"]).expanduser().resolve()
                if original_target.suffix.lower() != ".srt":
                    module = "output"
                    raise ValueError("SRT 输出位置必须以 .srt 结尾。")
            anchor = unique_output_path(anchor, media, env_path=env_path)
            seed, n = anchor, 2
            while anchor in reserved or anchor.with_suffix(".mosp").exists():
                anchor = unique_output_path(seed.with_name(f"{seed.stem}-{n}.srt"), media, env_path=env_path)
                n += 1
            reserved.add(anchor)
            post["outputSrtPath"] = str(anchor)
            post["originalSrtPath"] = str(original_target or "")
            post["outputDirectory"] = str(anchor.parent)
            request = None
            if recognize:
                module = "asr"
                request = request_builder({**plan.get("recognition", {}), "mediaPath": str(media), "srtPath": str(anchor), "audioTrack": track, "defaultAudioTrack": default_track, "generateWaveform": False, "generateSpectral": False, "generateHtml": False, "autoPostprocess": None, "batchSrtOnly": False})
            warnings = list(info["warnings"])
            waveform = bool(modules.get("waveform")) and bool(media) and tracks != [] and not output.get("srtOnly")
            if modules.get("waveform") and not waveform:
                warnings.append("波形生成不适用：仅输出字幕。" if output.get("srtOnly") else "波形生成不适用：未关联可用音轨。")
            prepared.append(PreparedTask(task_id, source, project, media, track, default_track, anchor, post, snapshot_postprocess_llm_settings(env_path, post), request, waveform, bool(plan.get("generateSpectral")), output.get("exportSrt", True), warnings, bool(output.get("srtOnly")), bool(output.get("generateHtml")), str(plan.get("recognition", {}).get("guiLang") or "zh"), bool(plan.get("rebuildWaveform")), original_target))
        except Exception as error:
            errors.append({"taskId": task_id, "module": module, "field": getattr(error, "field", ""), "message": str(error)})
    return prepared, errors


def run_task(task, *, env_path, tools, cancel, emit, ocr_runtime_root=None, require_waveform=False):
    if not task.srt_only:
        result = _run_task(task, env_path=env_path, tools=tools, cancel=cancel, emit=emit, ocr_runtime_root=ocr_runtime_root, require_waveform=require_waveform)
        if task.generate_html:
            try:
                if not task.media:
                    raise ValueError("没有关联媒体，未生成便携 HTML。")
                project = Path(result["projectPath"])
                html_path = render_editor_html(project, task.media, project.with_suffix(".edit.html"), task.language)
                if not html_path:
                    raise ValueError("便携 HTML 生成失败。")
                result["htmlPath"] = str(html_path)
            except Exception as error:
                result["warnings"].append(str(error))
        return result
    # Only SRT is published; all adapters may still use temporary project containers.
    with TemporaryDirectory(prefix="msw-queue-srt-") as temporary:
        anchor = Path(temporary) / task.output.name
        post = {**task.postprocess, "outputDirectory": temporary, "outputSrtPath": str(anchor), "originalSrtPath": ""}
        request = replace(task.request, srt_path=anchor) if task.request else None
        staged = replace(task, output=anchor, postprocess=post, request=request, srt_only=False, original_srt_target=None)
        result = _run_task(staged, env_path=env_path, tools=tools, cancel=cancel, emit=emit, ocr_runtime_root=ocr_runtime_root)
        if cancel.is_set():
            raise PostprocessCancelled("处理已取消。")
        if not any(result.get(key) and Path(result[key]).read_text(encoding="utf-8-sig").strip()
                   for key in ("srtPath", "translatedSrtPath", "bilingualSrtPath")):
            raise ValueError("没有可导出的字幕内容，未发布空的 SRT 结果。")
        outputs = publish_outputs(project=Path(result["projectPath"]), anchor=task.output,
            original=Path(result["srtPath"]) if result.get("srtPath") else None,
            translated=Path(result["translatedSrtPath"]) if result.get("translatedSrtPath") else None,
            bilingual=Path(result["bilingualSrtPath"]) if result.get("bilingualSrtPath") else None,
            export_project=False, original_target=task.original_srt_target)
        return {**outputs, "warnings": result.get("warnings", [])}


def _run_task(task, *, env_path, tools, cancel, emit, ocr_runtime_root=None, require_waveform=False):
    def check_cancel():
        if cancel.is_set():
            raise PostprocessCancelled("处理已取消。")
    check_cancel()
    project = copy.deepcopy(task.project)
    warnings = list(task.warnings or [])
    if task.request:
        emit({"stage": "asr"})
        result = run_transcription(task.request, cancel_event=cancel, on_event=lambda message: emit({"message": message}))
        recognized = read_project(result.json_path)
        if input_kind(task.source) == "media":
            project = recognized
        else:
            project["segments"] = recognized["segments"]
        # Existing secondary text/audio stay intact; old main-cue bindings no longer match.
        if project.get("multi_subtitle", {}).get("bindings"):
            project["multi_subtitle"]["bindings"] = []
            warnings.append("重新识别已保留副字幕内容，并解除旧主字幕的关联。")
    check_cancel()
    if task.media:
        project["media"] = str(task.media)
        project = persist_audio_track(project, task.track)
        project = discard_stale_inline_caches(project, task.media)
        project = enrich_project_media_metadata(project, task.media, ffprobe_path=tools.ffprobe)
    if task.waveform:
        emit({"stage": "waveform"})
        cached = embed_media_caches(project, task.media, source_media_path=task.media, generate_spectral=task.spectral, ffmpeg_bin=str(tools.ffmpeg) if tools.ffmpeg else None, audio_track=task.track, default_audio_track=task.default_track, cancel_event=cancel, reuse_existing=True, force_rebuild=task.rebuild_waveform)
        project = cached.project
        if require_waveform and not (project.get("waveform") or project.get("waveform_reapeaks")):
            raise ValueError(f"无法生成可用波形：{cached.waveform_error or '请检查媒体和 FFmpeg。'}")
        if cached.waveform_error:
            warnings.append(str(cached.waveform_error))
        if task.spectral and (not project.get("spectral") or cached.reapeaks_path is None):
            warnings.append("频谱颜色数据未能重新生成；已有有效缓存会保留。")
    check_cancel()
    # Recheck destinations at publication time; never overwrite an input or earlier output.
    target_srt = unique_output_path(task.output, task.media, env_path=env_path)
    target = target_srt.with_suffix(".mosp")
    project = normalize_project(project)
    if enabled_steps(task.postprocess):
        emit({"stage": "postprocess"})
        with TemporaryDirectory(prefix="msw-queue-process-") as temporary:
            staged = Path(temporary) / target.name
            warnings.extend(write_derived_project(project, staged, task.source))
            result = run_postprocess_pipeline(task.postprocess, media_path=task.media or task.source, project_path=staged, srt_path=target_srt, env_path=env_path, ffmpeg_path=tools.ffmpeg, ocr_runtime_root=ocr_runtime_root, cancel_event=cancel, on_event=emit, llm_settings=task.llm_settings)
        warnings.extend(result.warnings)
        return {"projectPath": str(result.project_path), "srtPath": str(result.srt_path or ""), "translatedSrtPath": str(result.translated_srt_path or ""), "bilingualSrtPath": str(result.bilingual_srt_path or ""), "warnings": warnings}
    with TemporaryDirectory(prefix="msw-queue-publish-") as temporary:
        staged = Path(temporary) / target.name
        warnings.extend(write_derived_project(project, staged, task.source))
        original = staged.with_suffix('.srt') if task.export_srt and project.get('segments') else None
        if original:
            _atomic_write(original, render_srt(project))
        result = publish_outputs(project=staged, anchor=target_srt, original=original,
                                 original_target=task.original_srt_target, warnings=warnings)
    return {**result, "warnings": warnings}


def run_queue(tasks, *, run_id, cancel, emit, execute):
    """A failure affects one task; cancellation never reports the queue as successful."""
    results = []
    emit({"type": "queueStarted", "runId": run_id, "total": len(tasks)})
    for index, task in enumerate(tasks):
        base = {"runId": run_id, "taskId": task.id, "index": index}
        if cancel.is_set():
            outcome = {**base, "status": "cancelled"}
        else:
            emit({"type": "queueItem", **base, "status": "running"})
            try:
                result = execute(task, lambda detail: emit({"type": "queueProgress", **base, **detail}))
                outcome = {**base, "status": "done", "result": result}
            except (PostprocessCancelled, MediaCacheCancelled, TranscriptionCancelledError):
                cancel.set()
                outcome = {**base, "status": "cancelled"}
            except Exception as error:
                outcome = {**base, "status": "failed", "message": str(error)}
        results.append(outcome)
        emit({"type": "queueItem", **outcome})
    emit({"type": "queueDone", "runId": run_id, "cancelled": cancel.is_set(), "results": results})
    return results
