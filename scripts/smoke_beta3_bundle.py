"""Exercise the frozen direct entry and actual ASR subprocess against localhost."""

import io
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import requests

exe = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="msw-direct-frozen-") as directory:
    root = Path(directory)
    env = {
        **os.environ,
        "MAW_ENV_FILE": str(root / "isolated.env"),
        "MSW_ENV_FILE": str(root / "isolated.env"),
        "MSW_APP_DATA_ROOT": str(root / "data"),
    }
    env.pop("FFMPEG_PATH", None)
    for name in (
        "DASHSCOPE_API_KEY",
        "SONIOX_API_KEY",
        "OPENAI_API_KEY",
        "MSW_OPENAI_ASR_API_KEY",
        "MAW_OPENAI_ASR_API_KEY",
    ):
        env.pop(name, None)
    subprocess.run(
        [str(exe), "--smoke-import"],
        env=env,
        cwd=root,
        check=True,
        timeout=40,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    subprocess.run(
        [str(exe), "--transcribe-doubao", "--help"],
        env=env,
        cwd=root,
        check=True,
        timeout=40,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen(
        [
            str(exe),
            "--editor",
            "--blank",
            "--no-open",
            "--port",
            str(port),
            "--no-waveform",
        ],
        env=env,
        cwd=root,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    mock = None
    try:
        origin = f"http://127.0.0.1:{port}"
        for attempt in range(160):
            try:
                response = requests.get(origin, timeout=1)
                response.raise_for_status()
                break
            except requests.RequestException:
                if process.poll() is not None:
                    raise RuntimeError("Frozen editor exited")
                time.sleep(0.25)
        else:
            raise RuntimeError("Frozen editor did not start")
        assert (
            "msw-asr-panel" in response.text and "msw-source-toolbar" in response.text
        )
        token = re.search(r'"requestToken":\s*"([^"]+)"', response.text).group(1)
        headers = {"X-MSW-Token": token, "Origin": origin}

        def api(route, body=None):
            result = (
                requests.post(
                    origin + "/api/msw/" + route, json=body, headers=headers, timeout=35
                )
                if body is not None
                else requests.get(
                    origin + "/api/msw/" + route, headers=headers, timeout=35
                )
            )
            result.raise_for_status()
            value = result.json()
            assert value["ok"], value
            return value

        caps = api("capabilities")
        assert caps["asr"] and caps["mediaImport"] and caps["mediaAnalysis"]
        assert api("version-settings")["settings"] == {
            "enabled": True,
            "interval": 300,
            "limit": 20,
        }
        assert api("onboarding-status")["status"] == ""
        api("onboarding-status", {"status": "completed"})
        assert api("onboarding-status")["status"] == "completed"
        catalog = api("asr-settings")
        assert [p["id"] for p in catalog["providers"]] == [
            "qwen",
            "soniox",
            "doubao",
            "openai",
            "local",
        ]
        assert api('asr-local-models')['status'] == 'idle'
        library = requests.get(origin + '/api/ass-styles', headers=headers, timeout=10)
        library.raise_for_status()
        assert library.json()['schema'] == 'moy.asr.ass_styles.v1'
        resources = (exe.parent.parent / 'Resources'
                     if exe.parent.name == 'MacOS' else exe.parent / '_internal')
        for name in ('compare.html', 'timestamp-compare.html'):
            assert (resources / 'tools' / name).is_file()
        print(
            "Frozen direct editor, imports and ASR catalog passed; media tools ready:",
            caps["mediaToolsReady"],
        )
        if len(sys.argv) < 3 or sys.argv[2] != "--standard":
            print("Lite direct-entry smoke passed (system FFmpeg is optional).")
            sys.exit(0)
        assert caps["mediaToolsReady"]
        scope = {
            "project_id": caps.get("projectId") or "frozen-project",
            "binding": caps["binding"],
            "client_token": "frozen-client",
        }
        buf = io.BytesIO()
        with wave.open(buf, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b"\0\0" * 32000)
        data = buf.getvalue()
        upload = api(
            "media-upload-begin", {**scope, "name": "source.wav", "size": len(data)}
        )
        result = requests.post(
            origin
            + f"/api/msw/media-upload-chunk?upload_id={upload['upload_id']}&project_id={scope['project_id']}&offset=0",
            data=data,
            headers={**headers, "Content-Type": "application/octet-stream"},
            timeout=15,
        )
        result.raise_for_status()
        media = api("media-upload-finish", {**scope, "upload_id": upload["upload_id"]})[
            "media"
        ]
        api("media-bind", {**scope, "media_id": media["id"]})
        job = api(
            "media-analysis", {**scope, "media_id": media["id"], "kind": "waveform"}
        )["job"]
        for attempt in range(120):
            state = api(
                f"media-analysis?project_id={scope['project_id']}&job_id={job['id']}"
            )["job"]
            if state["status"] in ("succeeded", "failed", "cancelled"):
                break
            time.sleep(0.25)
        assert state["status"] == "succeeded", state
        calls = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                assert b"RIFF" in body
                calls.append(self.path)
                value = json.dumps(
                    {
                        "text": "Frozen speech",
                        "language": "english",
                        "duration": 1,
                        "segments": [
                            {"start": 0.1, "end": 0.7, "text": "Frozen speech"}
                        ],
                        "words": [{"start": 0.1, "end": 0.7, "word": "Frozen speech"}],
                    }
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(value)))
                self.end_headers()
                self.wfile.write(value)

        mock = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=mock.serve_forever, daemon=True).start()
        source = {
            key: media[key]
            for key in ("id", "revision", "reference", "name", "audio_index")
        }
        source["duration_ms"] = media["metadata"]["duration_ms"]
        request = {
            **scope,
            "kind": "asr",
            "request_key": "frozen-asr",
            "snapshot": {
                "project_id": scope["project_id"],
                "source": source,
                "mode": "range",
                "range": {"start": 500, "end": 1500},
                "targets": [],
            },
            "provider": {
                "providerId": "openai",
                "modelId": "whisper-1",
                "apiKey": "synthetic-frozen-key",
                "openaiBaseUrl": f"http://127.0.0.1:{mock.server_address[1]}/v1",
                "language": "English",
            },
        }
        job = api("jobs", request)["job"]
        for attempt in range(180):
            state = api(f"jobs/{job['id']}/result?project_id={scope['project_id']}")[
                "job"
            ]
            if state["status"] in ("succeeded", "failed", "cancelled"):
                break
            time.sleep(0.25)
        assert state["status"] == "succeeded", state.get("error")
        assert len(calls) == 1 and state["result"]["segments"][0]["start"] == 600, (
            state.get("result")
        )
        assert "synthetic-frozen-key" not in json.dumps(state)
        api("asr-validate", {**scope, "job_id": job["id"]})
        print(
            "Frozen standard: binary import, bundled FFmpeg waveform, real frozen OpenAI subprocess, source-offset candidates and apply validation passed."
        )

        original = root / "kernel-source.wav"
        original.write_bytes(data)
        cli_env = {
            **env,
            "MAW_OPENAI_ASR_API_KEY": "synthetic-frozen-key",
            "MSW_OPENAI_ASR_API_KEY": "synthetic-frozen-key",
        }
        subprocess.run(
            [
                str(exe),
                "--transcribe-openai",
                str(original),
                "-o",
                str(root / "kernel.srt"),
                "--base-url",
                f"http://127.0.0.1:{mock.server_address[1]}/v1",
                "--model",
                "whisper-1",
                "--json",
                "--with-waveform",
                "--with-spectral",
                "--no-html",
            ],
            env=cli_env,
            cwd=root,
            check=True,
            timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        containers = list(root.rglob("kernel-source.wav.quapeaks"))
        assert len(containers) == 1, containers
        assert containers[0].read_bytes()[:4] == b"QPK1"
        saved = json.loads((root / "kernel.mosp").read_text(encoding="utf-8"))
        assert not {"waveform", "spectral", "waveform_reapeaks"}.intersection(saved)
        assert saved["media_metadata"]["selected_audio_track"] == 0
        print(
            "Frozen native quapeaks kernel generated QPK1 through the real CLI; MOSP contains no inline cache."
        )
    finally:
        if mock:
            mock.shutdown()
            mock.server_close()
        process.terminate()
        process.wait(timeout=15)
