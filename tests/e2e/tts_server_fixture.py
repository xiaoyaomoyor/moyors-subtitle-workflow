"""Browser-test server with an injected synthetic provider; never used by MSW."""
import os
from pathlib import Path
import runpy
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import requests
from maw.msw import tts
from maw.msw import persistence

origin = os.environ["MSW_TEST_TTS_ORIGIN"]
assert urlsplit(origin).hostname == "127.0.0.1"


def fake_synthesize(settings, text, cancel):
    response = requests.post(origin, json={"text": text, "recipe": settings.recipe}, timeout=25)
    if response.status_code != 200:
        raise ValueError("模拟服务失败")
    return response.content


OriginalService = tts.TtsService


class TestService(OriginalService):
    def __init__(self, assets):
        super().__init__(assets, synthesize_one=fake_synthesize)


tts.TtsService = TestService
if os.environ.get("MSW_TEST_SAVE_TARGET"):
    persistence.pick_project_target = lambda _: Path(os.environ["MSW_TEST_SAVE_TARGET"])
runpy.run_path(str(ROOT / "server-editor" / "serve.py"), run_name="__main__")
