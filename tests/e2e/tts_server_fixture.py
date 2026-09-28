"""Browser-test server with an injected synthetic provider; never used by MSW."""
import os
import json
import wave
from pathlib import Path
from types import SimpleNamespace
import runpy
import sys
from urllib.parse import urlsplit

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from maw.msw import persistence, qwen_voices, tts  # noqa: E402 - repository bootstrap
from maw.msw import media_service
from maw.msw import asr

origin = os.environ["MSW_TEST_TTS_ORIGIN"]
assert urlsplit(origin).hostname == "127.0.0.1"


def fake_synthesize(settings, text, cancel):
    response = requests.post(origin, json={"text": text, "recipe": settings.recipe}, timeout=25)
    if response.status_code != 200:
        raise ValueError("模拟服务失败")
    return response.content


def fake_voice_request(settings, body):
    response = requests.post(origin, json={'customization': body, 'region': settings.recipe['region']}, timeout=25)
    if response.status_code != 200:
        raise ValueError('模拟音色创建失败；未自动重试')
    return response.json()


OriginalService = tts.TtsService
OriginalAsrService = asr.AsrService


def fake_transcribe(request, *, cancel_event, on_event):
    with wave.open(str(request.media_path), 'rb') as audio:
        duration_ms = round(audio.getnframes() * 1000 / audio.getframerate())
    response = requests.post(origin, json={'asr': {'provider': request.provider, 'model': request.model,
        'duration_ms': duration_ms, 'audio_track': request.audio_track, 'language': request.language}}, timeout=25)
    if response.status_code != 200:
        raise ValueError('模拟 ASR 服务失败')
    project = response.json()
    path = request.srt_path.with_suffix('.mosp')
    path.write_bytes(json.dumps(project).encode('utf-8'))
    request.srt_path.write_bytes(b'')
    return SimpleNamespace(json_path=path)


class TestAsrService(OriginalAsrService):
    def __init__(self, api):
        super().__init__(api, transcribe=fake_transcribe)


class TestService(OriginalService):
    def __init__(self, assets):
        super().__init__(assets, synthesize_one=fake_synthesize)


tts.TtsService = TestService
asr.AsrService = TestAsrService
qwen_voices.cloud_request = fake_voice_request
if os.environ.get("MSW_TEST_SAVE_TARGET"):
    persistence.pick_project_target = lambda _, **options: Path(os.environ["MSW_TEST_SAVE_TARGET"])
if os.environ.get('MSW_TEST_MEDIA_SOURCE'):
    media_service.pick_media_source = lambda: Path(os.environ['MSW_TEST_MEDIA_SOURCE'])
if os.environ.get('MSW_TEST_LOCAL_TTS_INSTALL'):
    # Synthetic child servers still use the production manager, runner, process
    # ownership and protocol checks. Only model assets/interpreter are substituted.
    from maw.msw import tts_local_services, dialogs
    fixture_root = Path(os.environ['MSW_TEST_LOCAL_TTS_INSTALL']).resolve()
    original_installation = tts_local_services.installation
    def fixture_installation(kind, directory):
        root, _ = original_installation(kind, directory)
        if root == fixture_root:
            return root, Path(sys.executable)
        raise ValueError('test installation mismatch')
    tts_local_services.installation = fixture_installation
    tts_local_services.model_check = lambda *args: {'custom': {}}
    dialogs.pick_tts_directory = lambda: fixture_root
if os.environ.get('MSW_TEST_EDGE_AUDIO'):
    # Test-only deterministic network stream; actual MP3 decoding remains production code.
    import asyncio
    import edge_tts
    edge_audio = Path(os.environ['MSW_TEST_EDGE_AUDIO']).read_bytes()
    class TestEdge:
        def __init__(self, text, voice, **kwargs):
            self.text, self.voice, self.params = text, voice, kwargs
        async def stream(self):
            if self.text == 'WAIT_CANCEL':
                await asyncio.sleep(30)
            if self.text == 'DISCONNECT':
                raise OSError('synthetic disconnect')
            yield {'type':'audio', 'data':edge_audio}
    async def test_voices():
        return [{'ShortName':v,'Gender':'Female'} for v in ['zh-CN-XiaoxiaoNeural','ja-JP-NanamiNeural','en-US-JennyNeural']]
    edge_tts.Communicate = TestEdge
    edge_tts.list_voices = test_voices
if os.environ.get('MSW_TEST_CLOUD_TTS') == '1':
    # Only this test entry point replaces official hosts. Production never accepts
    # arbitrary endpoints, and still exercises actual HTTP/error/decoder paths.
    from maw.msw import minimax_tts, mossland_tts
    minimax_tts.ENDPOINTS['cn'] = origin
    minimax_tts.ENDPOINTS['global'] = origin
    mossland_tts.MosslandTts.endpoints = {'default': origin}
runpy.run_path(str(ROOT / "server-editor" / "serve.py"), run_name="__main__")
