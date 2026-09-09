"""Local Yukkuri provider using an owned, cancellable Node process per cue."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from maw.gui_platform import asset_path, popen_process_tree, process_group_kwargs, release_process_tree, terminate_process_tree
from maw.msw.tts import MAX_AUDIO_BYTES, TtsServiceError
from maw.msw.yukkuri_runtime import validate_recipe, verify


@dataclass(frozen=True)
class YukkuriSettings:
    recipe: dict
    runtime_root: Path
    node: Path
    api_key = ""
    provider_id = "yukkuri"
    model = "aquestalk1"
    base_url = "local:yukkuri"
    reasoning_mode = "off"


def resolve_settings(controller, raw):
    recipe = validate_recipe(raw.get("recipe", controller.payload()["recipe"]))
    directory = controller.payload()["runtime_path"]
    if not directory:
        raise ValueError("请先安装或检测油库里资源包")
    root = Path(directory)
    # Verification happens once per submitted batch, never trusts a project-supplied executable.
    node = verify(root)
    return YukkuriSettings(recipe, root, node)


def synthesize(settings, text, cancel):
    from maw.msw.jobs import JobCancelled
    if cancel.is_set():
        raise JobCancelled()
    # A local engine needs no keys, npm configuration or injectable Node startup flags.
    allowed = {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    with tempfile.TemporaryDirectory(prefix="msw-yukkuri-") as directory:
        output = Path(directory) / "result.wav"
        try:
            process = popen_process_tree([str(settings.node), str(asset_path("maw/msw/yukkuri_worker.mjs")),
                                          str(settings.runtime_root), str(output)],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                         cwd=directory, env=environment, **process_group_kwargs())
        except OSError as error:
            raise TtsServiceError("油库里运行时无法启动，请重新检测或安装资源") from error
        try:
            payload = json.dumps({"text": text, "recipe": settings.recipe}, ensure_ascii=False).encode("utf-8")
            deadline = time.monotonic() + 120
            while True:
                if cancel.is_set():
                    raise JobCancelled()
                if time.monotonic() > deadline:
                    raise TtsServiceError("油库里合成超时；本批已暂停，请拆分字幕或重新检测资源")
                try:
                    stdout, _ = process.communicate(input=payload, timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    payload = None
            if cancel.is_set():
                raise JobCancelled()
            if process.returncode or len(stdout) > 64000:
                raise TtsServiceError("油库里进程异常退出，请重新检测资源")
            try:
                result = json.loads(stdout)
            except (ValueError, UnicodeError) as error:
                raise TtsServiceError("油库里运行时响应无效，请重新检测资源") from error
            if not result.get("ok"):
                raise ValueError(result.get("error", "油库里合成失败"))
            if not output.is_file() or not 44 <= output.stat().st_size <= MAX_AUDIO_BYTES:
                raise ValueError("油库里音频为空或过大，请拆分字幕")
            spoken = result.get("spoken_text")
            if not isinstance(spoken, str) or len(spoken) > 12000:
                raise ValueError("油库里读音记录无效")
            from maw.msw.assets import audio_info
            audio = output.read_bytes()
            audio_info(audio)
            return audio, spoken
        finally:
            if process.poll() is None:
                terminate_process_tree(process)
            release_process_tree(process)
            for stream in (process.stdin, process.stdout):
                if stream:
                    stream.close()
