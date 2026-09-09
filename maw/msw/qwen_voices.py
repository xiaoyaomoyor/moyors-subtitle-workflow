"""Local, persistent Qwen voice creation; no credentials or reference bytes in projects.

Voice creation is a separate billable request. A repeated request key only reads
its original operation, including after errors/restarts; it never retries HTTP.
"""

import base64
from contextlib import contextmanager
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import socket
import sqlite3
import tempfile
import threading
import time
import uuid
import wave

import requests

from maw.msw.assets import atomic_bytes, audio_info, normalize_generated_wav
from maw.msw.audio_render import RenderCancelled, run
from maw.msw.project_codec import valid_id
from maw.msw.tts import ENDPOINTS

MAX_REFERENCE_BYTES = 10 * 1024 * 1024
MAX_RESPONSE_BYTES = 12 * 1024 * 1024
ACTIVE = {'queued', 'preparing', 'creating'}


def port_alive(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=.2):
            return True
    except OSError:
        return False


def voice_scope(settings):
    # Local credential namespace; never returned to clients or saved in projects.
    return hashlib.sha256((settings.recipe['region'] + '\0' + settings.api_key).encode()).hexdigest()


def cloud_request(settings, body):
    endpoint = ENDPOINTS[settings.recipe['region']].split('/services/')[0] + '/services/audio/tts/customization'
    try:
        with requests.Session() as session, session.post(endpoint, json=body,
                headers={'Authorization': 'Bearer ' + settings.api_key, 'Accept-Encoding': 'identity'},
                timeout=(10, 180), allow_redirects=False, stream=True) as response:
            if response.status_code != 200:
                raise ValueError(f'百炼音色创建失败（HTTP {response.status_code}），请检查地域、密钥、参考内容和额度；未自动重试')
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > MAX_RESPONSE_BYTES:
                    raise ValueError('百炼音色响应过大；创建结果不确定，请先在百炼核对，未自动重试')
                chunks.append(chunk)
            result = json.loads(b''.join(chunks))
            if not isinstance(result, dict):
                raise ValueError('百炼音色响应格式无效；请先在百炼核对，未自动重试')
            return result
    except requests.RequestException as error:
        raise ValueError('百炼音色请求超时或网络失败；可能已创建并计费，请先在百炼核对，未自动重试') from error
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ValueError('百炼音色响应无法读取；可能已创建，请先在百炼核对，未自动重试') from error


def reference_wav(audio, filename, tools, cancel):
    """Normalize the selected file to 24 kHz mono; reject long/truncated input."""
    suffix = Path(filename).suffix.lower()
    if suffix == '.wav':
        try:
            info = audio_info(audio)
        except ValueError as error:
            try:
                with wave.open(io.BytesIO(audio), 'rb'):
                    pass
            except (wave.Error, EOFError):
                pass
            else:
                raise error
        else:
            duration = info['sample_count'] / info['sample_rate']
            if not 3 <= duration <= 60:
                raise ValueError('参考音频须为 3–60 秒，推荐 10–20 秒；未自动截断')
            with wave.open(io.BytesIO(audio), 'rb') as reader:
                if reader.getsampwidth() == 2 and info['channels'] == 1 and info['sample_rate'] == 24000:
                    return audio
    ffmpeg = tools().ffmpeg
    if not ffmpeg:
        raise ValueError('此参考音频需要 FFmpeg 转换；可直接选择 24 kHz、16-bit、单声道 PCM WAV')
    with tempfile.TemporaryDirectory(prefix='msw-voice-reference-') as directory:
        root = Path(directory)
        source, output = root / ('input' + suffix), root / 'reference.wav'
        source.write_bytes(audio)
        run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror',
             '-max_alloc', str(64 * 1024 * 1024), '-protocol_whitelist', 'file,pipe',
             '-f', {'.wav': 'wav', '.mp3': 'mp3', '.m4a': 'mov'}[suffix], '-i', str(source),
             '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1', '-c:a', 'pcm_s16le',
             '-ar', '24000', '-ac', '1', '-t', '61', '-fs', str(4 * 1024 * 1024), str(output)],
            cancel, timeout=90, cwd=root, failure_message='参考音频无法完整解码，请检查文件内容')
        result = output.read_bytes()
        info = audio_info(result)
        if not 3 <= info['sample_count'] / info['sample_rate'] <= 60:
            raise ValueError('参考音频须为 3–60 秒，推荐 10–20 秒；未上传截断音频')
        return result


class QwenVoices:
    def __init__(self, root, port, tools, *, request=None):
        self.root, self.port, self.tools = Path(root), port, tools
        self.request = request or cloud_request
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.worker = None
        self.close_complete = threading.Event()
        self.close_complete.set()
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS voices (scope TEXT, voice TEXT, payload TEXT, PRIMARY KEY(scope,voice))')
            db.execute('CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, scope TEXT, request_key TEXT, fingerprint TEXT, port INTEGER, payload TEXT, UNIQUE(scope,request_key))')
            checked_ports = {port: False}
            for row in db.execute('SELECT id,payload,port FROM operations').fetchall():
                operation = json.loads(row[1])
                if operation['status'] in ACTIVE:
                    if row[2] not in checked_ports:
                        checked_ports[row[2]] = port_alive(row[2])
                    if checked_ports[row[2]]:
                        continue
                    operation.update(status='interrupted', message='服务已重启；可能已创建音色，请先在百炼核对，未自动重试')
                    db.execute('UPDATE operations SET payload=? WHERE id=?', (json.dumps(operation, ensure_ascii=False), row[0]))

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.root / 'voices.sqlite3', timeout=30)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def catalog(self, settings):
        scope = voice_scope(settings)
        with self.db() as db:
            voices = [json.loads(row[0]) for row in db.execute('SELECT payload FROM voices WHERE scope=? ORDER BY rowid DESC', (scope,))]
            operations = [json.loads(row[0]) for row in db.execute('SELECT payload FROM operations WHERE scope=? ORDER BY rowid DESC', (scope,))]
        model = settings.model
        return {'voices': [v for v in voices if v['model'] == model],
                'operations': [o for o in operations if o['model'] == model]}

    def get(self, operation_id):
        if not isinstance(operation_id, str) or not re.fullmatch(r'[0-9a-f]{32}', operation_id):
            raise KeyError('音色任务不存在')
        with self.db() as db:
            row = db.execute('SELECT payload,port FROM operations WHERE id=?', (operation_id,)).fetchone()
        if not row:
            raise KeyError('音色任务不存在')
        operation = json.loads(row[0])
        if operation['status'] in ACTIVE and row[1] != self.port and not port_alive(row[1]):
            operation.update(status='interrupted', message='原服务已关闭；可能已创建音色，请先在百炼核对，未自动重试')
            # Do not overwrite a result that arrived during the liveness check.
            with self.db() as db:
                db.execute('UPDATE operations SET payload=? WHERE id=? AND payload=?',
                           (json.dumps(operation, ensure_ascii=False), operation_id, row[0]))
                operation = json.loads(db.execute('SELECT payload FROM operations WHERE id=?', (operation_id,)).fetchone()[0])
        return operation

    def preview(self, operation_id):
        operation = self.get(operation_id)
        if not operation.get('preview'):
            raise KeyError('音色预览不存在')
        return self.root / 'previews' / (operation_id + '.wav')

    def validate_voice(self, settings):
        # Keys can rotate within one account. Only the cloud can check account
        # ownership; locally enforce the known region and exact target model.
        with self.db() as db:
            rows = db.execute('SELECT scope,payload FROM voices WHERE voice=?', (settings.recipe['voice'],)).fetchall()
        if rows and not any(json.loads(payload)['region'] == settings.recipe['region'] and json.loads(payload)['model'] == settings.model for _, payload in rows):
            raise ValueError('此音色与当前地域或模型不匹配，请重新选择或创建音色')

    def start(self, payload, settings):
        kind, model = settings.recipe['model_type'], settings.model
        if kind not in {'VoiceDesign', 'VoiceClone'}:
            raise ValueError('请先选择声音设计或声音复刻模式')
        key, name = payload.get('request_key'), payload.get('name', '')
        if not valid_id(key) or not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
            raise ValueError('请填写 1–60 字符的音色名称，并提供有效请求标识')
        name = name.strip()
        # The API's preferred_name is an ASCII hint; the user's display name is
        # kept separately, so Chinese names work without violating API limits.
        voice_input = {'action': 'create', 'target_model': model,
                       'preferred_name': 'msw_' + hashlib.sha256(key.encode()).hexdigest()[:8]}
        audio, filename = None, ''
        if kind == 'VoiceDesign':
            for field, maximum in [('voice_prompt', 2048), ('preview_text', 500)]:
                value = payload.get(field, '')
                if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
                    raise ValueError(f'{"音色描述" if field == "voice_prompt" else "试听文本"}须为 1–{maximum} 字符')
                voice_input[field] = value.strip()
            body = {'model': 'qwen-voice-design', 'input': voice_input,
                    'parameters': {'sample_rate': 24000, 'response_format': 'wav'}}
        else:
            filename, encoded = payload.get('filename'), payload.get('audio_base64')
            if (not isinstance(filename, str) or not 1 <= len(filename) <= 255 or any(c in filename for c in '/\\\0\r\n')
                    or Path(filename).suffix.lower() not in {'.wav', '.mp3', '.m4a'}):
                raise ValueError('请选择 WAV、MP3 或 M4A 参考音频')
            if not isinstance(encoded, str) or not encoded or len(encoded) > (MAX_REFERENCE_BYTES + 2) // 3 * 4:
                raise ValueError('参考文件须小于等于 10 MiB')
            try:
                audio = base64.b64decode(encoded, validate=True)
            except ValueError as error:
                raise ValueError('参考音频上传数据无效') from error
            if not 1 <= len(audio) <= MAX_REFERENCE_BYTES:
                raise ValueError('参考音频为空或超过 10 MiB')
            body = {'model': 'qwen-voice-enrollment', 'input': voice_input}
        fingerprint = hashlib.sha256(json.dumps([kind, model, name, body, filename, hashlib.sha256(audio).hexdigest() if audio else None], sort_keys=True).encode()).hexdigest()
        scope = voice_scope(settings)
        with self.lock, self.db() as db:
            previous = db.execute('SELECT fingerprint,payload FROM operations WHERE scope=? AND request_key=?', (scope, key)).fetchone()
            if previous:
                if previous[0] != fingerprint:
                    raise ValueError('同一请求标识不能创建不同音色')
                return json.loads(previous[1])
            if self.cancel.is_set():
                raise ValueError('编辑器正在关闭')
            if self.worker and self.worker.is_alive():
                raise ValueError('已有音色正在创建，请等待完成')
            if db.execute('SELECT COUNT(*) FROM operations WHERE scope=?', (scope,)).fetchone()[0] >= 10000:
                raise ValueError('本机音色创建记录已达上限')
            operation = {'id': uuid.uuid4().hex, 'name': name, 'model_type': kind, 'model': model,
                         'region': settings.recipe['region'], 'status': 'queued', 'created_at': time.time(),
                         'message': '等待创建音色', 'voice': '', 'preview': False}
            db.execute('INSERT INTO operations VALUES (?,?,?,?,?,?)',
                       (operation['id'], scope, key, fingerprint, self.port, json.dumps(operation, ensure_ascii=False)))
            db.commit()
            self.close_complete.clear()
            self.worker = threading.Thread(target=self._run, args=(copy.deepcopy(operation), scope, settings, body, audio, filename),
                                           daemon=True, name='msw-qwen-voice')
            self.worker.start()
            return operation

    def _write(self, operation):
        with self.db() as db:
            db.execute('UPDATE operations SET payload=? WHERE id=?', (json.dumps(operation, ensure_ascii=False), operation['id']))

    def _run(self, operation, scope, settings, body, audio, filename):
        sent = False
        try:
            if audio is not None:
                operation.update(status='preparing', message='正在检查参考音频')
                self._write(operation)
                audio = reference_wav(audio, filename, self.tools, self.cancel)
                body['input']['audio'] = {'data': 'data:audio/wav;base64,' + base64.b64encode(audio).decode()}
            if self.cancel.is_set():
                raise RenderCancelled()
            operation.update(status='creating', message='正在向百炼创建音色；关闭面板不会重发请求')
            self._write(operation)
            sent = True
            output = self.request(settings, body).get('output', {})
            voice = output.get('voice')
            if not isinstance(voice, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,255}', voice):
                raise ValueError('百炼未返回有效音色 ID；可能已创建，请先在百炼核对，未自动重试')
            operation.update(status='succeeded', voice=voice, message='音色已创建，可选择它进行字幕配音')
            record = {key: operation[key] for key in ('name', 'model_type', 'model', 'region', 'created_at', 'voice')}
            record['operation_id'] = operation['id']
            # Persist the billable result before validating optional preview.
            with self.db() as db:
                db.execute('INSERT OR REPLACE INTO voices VALUES (?,?,?)', (scope, voice, json.dumps(record, ensure_ascii=False)))
            preview = output.get('preview_audio')
            if isinstance(preview, dict) and preview.get('data'):
                try:
                    encoded = preview['data']
                    if not isinstance(encoded, str) or len(encoded) > MAX_RESPONSE_BYTES:
                        raise ValueError('invalid preview')
                    preview_audio = normalize_generated_wav(base64.b64decode(encoded, validate=True))
                    audio_info(preview_audio)
                    atomic_bytes(self.root / 'previews' / (operation['id'] + '.wav'), preview_audio)
                    operation['preview'] = True
                except (ValueError, OSError):
                    operation['message'] = '音色已创建，但预览不可用；可直接进行字幕配音，无需重新创建'
            self._write(operation)
        except RenderCancelled:
            operation.update(status='interrupted', message='服务已关闭；未发送音色创建请求')
            self._write(operation)
        except Exception as error:
            detail = str(error) if isinstance(error, ValueError) else '音色创建未完成，请检查本机服务'
            detail = detail.replace(settings.api_key, '[已隐藏]') if settings.api_key else detail
            operation.update(status='failed', message=detail[:600] + ('；未自动重试' if sent and '未自动重试' not in detail else ''))
            self._write(operation)
        finally:
            self.close_complete.set()

    def close(self):
        self.cancel.set()
