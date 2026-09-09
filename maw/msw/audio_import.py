"""Import user-selected audio bytes; original files and project media stay untouched."""

import base64
import binascii
import hashlib
import io
from pathlib import Path
import tempfile
import threading
import wave

from maw.msw.assets import audio_info
from maw.msw.tts import MAX_AUDIO_BYTES
from maw.msw.audio_render import RenderCancelled, run
from maw.msw.project_codec import valid_id, valid_removed_assets

FORMATS = {".wav": "wav", ".mp3": "mp3", ".flac": "flac", ".m4a": "mov", ".aac": "aac", ".ogg": "ogg", ".opus": "ogg"}
MAX_INPUT_BYTES = 32 * 1024 * 1024


class AudioImporter:
    def __init__(self, api):
        self.api = api
        self.lock = threading.Lock()
        self.cancel = threading.Event()

    def import_audio(self, payload):
        project_id, request_key = payload.get("project_id"), payload.get("request_key")
        filename, encoded = payload.get("filename"), payload.get("audio_base64")
        removed, size = payload.get("removed_asset_ids", []), payload.get("library_size", 0)
        if not valid_id(project_id) or not valid_id(request_key) or len(request_key) > 100:
            raise ValueError("音频导入缺少工程或请求标识")
        if not isinstance(filename, str) or not 1 <= len(filename) <= 255 or any(c in filename for c in '/\\\x00\r\n'):
            raise ValueError("导入文件名无效")
        suffix = Path(filename).suffix.lower()
        if suffix not in FORMATS:
            raise ValueError("请选择 WAV、MP3、FLAC、M4A、AAC、OGG 或 Opus 音频")
        if not valid_removed_assets(removed) or type(size) is not int or not 0 <= size <= 10000:
            raise ValueError("素材数量或删除记录无效")
        if not isinstance(encoded, str) or not encoded or len(encoded) > (MAX_INPUT_BYTES + 2) // 3 * 4:
            raise ValueError("单个导入文件须小于等于 32 MiB")
        try:
            audio = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError("音频上传数据无效") from error
        if not 1 <= len(audio) <= MAX_INPUT_BYTES:
            raise ValueError("音频文件为空或超过 32 MiB")
        source_digest = hashlib.sha256(audio).hexdigest()
        job_id = "import-" + request_key
        if not self.lock.acquire(blocking=False):
            raise ValueError("正在导入另一份音频，请等待完成后重试")
        try:
            if self.cancel.is_set():
                raise ValueError("编辑器正在关闭，导入已停止")
            previous = self.api.assets.imported(project_id, job_id)
            if previous:
                recipe = previous["generation"]
                if recipe.get("source_sha256") != source_digest or recipe.get("filename") != filename:
                    raise ValueError("同一导入请求不能更换文件")
                return previous
            jobs = self.api.jobs
            def check_capacity():
                if max(size, self.api.assets.count(project_id, removed)) + jobs.reserved_tts_assets(project_id) >= 10000:
                    raise ValueError("素材及待合成音频已达 10000 条，请先移除素材或等待任务结束")
            with jobs.lock:
                check_capacity()
            audio = self.convert(audio, suffix)
            info = audio_info(audio)
            name = Path(filename).stem.strip() or "导入音频"
            source = {"key": job_id, "id": job_id, "track_id": None, "text": name,
                      "start": 0, "end": max(1, round(info["sample_count"] / info["sample_rate"] * 1000))}
            recipe = {"provider": "imported", "model": "external-audio", "voice": "", "language_type": "Auto",
                      "filename": filename, "source_sha256": source_digest, "text_origin": "filename"}
            if self.cancel.is_set():
                raise ValueError("编辑器正在关闭，导入已停止")
            # Conversion never holds the task lock. Recheck and register together
            # so another TTS submission cannot claim this slot in between.
            with jobs.lock:
                check_capacity()
                return self.api.assets.add(project_id, job_id, source, recipe, audio, spoken_text="")
        except RenderCancelled as error:
            raise ValueError("编辑器正在关闭，导入已停止") from error
        finally:
            self.lock.release()

    def convert(self, audio, suffix):
        if suffix == ".wav":
            try:
                audio_info(audio)
                return audio
            except ValueError as error:
                try:
                    with wave.open(io.BytesIO(audio), "rb"):
                        pass
                except (wave.Error, EOFError):
                    pass  # Float/compressed WAV may be converted.
                else:
                    raise error  # PCM with missing frames must never become a truncated success.
        ffmpeg = self.api.exports.tools().ffmpeg
        if not ffmpeg:
            raise ValueError("此音频需要 FFmpeg 转换，请在启动器配置；标准 PCM WAV 可直接导入")
        with tempfile.TemporaryDirectory(prefix="msw-audio-import-") as directory:
            root = Path(directory)
            source, output = root / ("input" + suffix), root / "output.wav"
            source.write_bytes(audio)
            command = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-xerror",
                       "-max_alloc", str(64 * 1024 * 1024), "-protocol_whitelist", "file,pipe",
                       "-f", FORMATS[suffix], "-i", str(source), "-map", "0:a:0", "-vn", "-sn", "-dn",
                       "-map_metadata", "-1", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
                       "-fs", str(MAX_AUDIO_BYTES), str(output)]
            run(command, self.cancel, timeout=120, cwd=root, failure_message="音频无法完整解码，请检查文件格式与内容")
            if not output.is_file() or output.stat().st_size >= MAX_AUDIO_BYTES:
                raise ValueError("解码后的 WAV 达到 32 MiB 限制，请先裁短音频；未导入截断内容")
            result = output.read_bytes()
            audio_info(result)
            return result

    def close(self):
        self.cancel.set()
