"""Explicit local model-service lifecycle. Never adopt or stop external PIDs."""

from __future__ import annotations

import copy
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time

import requests

from maw.gui_platform import (popen_process_tree, process_group_kwargs,
                              release_process_tree, terminate_process_tree)
from maw.msw.assets import atomic_bytes

SERVICES = {'indextts': ('webui.py', 7860), 'gpt-sovits': ('api_v2.py', 9880)}


def identity(value):
    if not isinstance(value, str) or value not in SERVICES:
        raise ValueError('不支持的本机 TTS 服务')
    return value


def installation(kind, directory):
    """Only search the chosen directory and two child levels; never a disk scan."""
    identity(kind)
    if not isinstance(directory, str) or not directory.strip() or len(directory) > 4096:
        raise ValueError('请选择本机 TTS 安装目录')
    base = Path(directory).expanduser().resolve()
    if not base.is_dir() or base == Path(base.anchor):
        raise ValueError('请选择具体安装文件夹，不要选择磁盘根目录')
    level = [base]
    for _ in range(3):
        matches = []
        for root in level:
            if not (root / SERVICES[kind][0]).is_file():
                continue
            python = next((root / name for name in ('runtime/python.exe', '.venv/Scripts/python.exe',
                           '.venv/bin/python', 'runtime/bin/python') if (root / name).is_file()), None)
            if python:
                matches.append((root, python.resolve()))
        if len(matches) > 1:
            raise ValueError('找到多个安装，请选择实际使用的子文件夹')
        if matches:
            return matches[0]
        next_level = []
        for root in level:
            for child in root.iterdir():
                if child.is_dir() and not child.is_symlink() and child.name not in {
                    '.venv', 'runtime', '.git', 'node_modules', 'checkpoints', 'GPT_SoVITS'}:
                    next_level.append(child)
                    if len(next_level) > 128:
                        raise ValueError('此目录内容太多，请选择更接近安装位置的文件夹')
        level = next_level
    raise ValueError('未找到服务入口及内置 Python，请选择完整安装目录')


# Runs in the selected bundle's interpreter (PyYAML is a model dependency).
# Read model configuration without importing torch or loading any weights.
MODEL_CHECK = r'''
import json, pathlib, sys, yaml
root=pathlib.Path.cwd(); kind=sys.argv[1]; qwen=sys.argv[2]=='1'
paths=[]; config=None
if kind=='indextts':
    base=root/'checkpoints'
    config=yaml.safe_load((base/'config.yaml').read_text(encoding='utf-8'))
    paths=[base/name for name in ['gpt.pth','s2mel.pth','codec.pth','multilingual_zh_ja_yue_char_del.tiktoken','wav2vec2bert_stats.pt',
        'hf_cache/w2v-bert-2.0/config.json','hf_cache/campplus_cn_common.bin','hf_cache/bigvgan/config.json']]
    paths += [base/config[k] for k in ['gpt_checkpoint','s2mel_checkpoint','w2v_stat','emo_matrix','spk_matrix']]
    if qwen: paths += [base/config['qwen_emo_path']/'config.json']
else:
    config=yaml.safe_load((root/'GPT_SoVITS/configs/tts_infer.yaml').read_text(encoding='utf-8'))
    active=config.get('custom',config.get('v2',{}))
    for key in ['t2s_weights_path','vits_weights_path','bert_base_path','cnhuhbert_base_path']:
        value=active.get(key)
        if not value: raise ValueError('missing model setting: '+key)
        paths.append(root/value)
missing=[p.name for p in paths if not p.exists() or (p.is_file() and p.stat().st_size==0)]
print(json.dumps({'missing':missing,'config':config if kind=='gpt-sovits' else None}))
'''


def environment():
    allowed = {'SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE',
               'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'CUDA_PATH', 'CUDA_VISIBLE_DEVICES',
               'LANG', 'LC_ALL'}
    return {**{k: v for k, v in os.environ.items() if k.upper() in allowed}, 'PYTHONUTF8': '1',
            'PYTHONUNBUFFERED': '1', 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
            'USE_MODELSCOPE': 'false',
            'GRADIO_ANALYTICS_ENABLED': 'False', 'TOKENIZERS_PARALLELISM': 'false'}


def model_check(kind, root, python, qwen=False):
    try:
        result = subprocess.run([str(python), '-c', MODEL_CHECK, kind, '1' if qwen else '0'], cwd=root,
                                env=environment(), capture_output=True, timeout=20, **process_group_kwargs())
        if result.returncode or len(result.stdout) > 256000:
            raise ValueError('无法读取模型配置，请确认安装包环境及模型配置完整')
        value = json.loads(result.stdout.decode('utf-8'))
    except (OSError, subprocess.TimeoutExpired, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('无法检测内置 Python 或模型配置，请在原工具中修复安装') from error
    if value['missing']:
        raise ValueError('缺少模型资源：' + '、'.join(value['missing'][:12]) + '；请在原工具中准备，MSW 不自动下载')
    return value.get('config')


def port_open(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.3):
            return True
    except OSError:
        return False


def probe(kind, port):
    """Read-only protocol validation; GPT initializes weights before FastAPI starts."""
    from maw.msw.index_protocol import service_url
    url = service_url(port) if isinstance(port, str) else f'http://127.0.0.1:{port}'
    if kind == 'indextts':
        from maw.msw.index_protocol import IndexClient
        with IndexClient(url, timeout=5) as client:
            client.metadata()
    else:
        with requests.Session() as session:
            session.trust_env = False
            with session.get(url + '/openapi.json', timeout=(1, 3), allow_redirects=False, stream=True) as response:
                if response.status_code != 200:
                    raise ValueError('服务协议不匹配')
                data = bytearray()
                for chunk in response.iter_content(65536):
                    data.extend(chunk)
                    if len(data) > 1024 * 1024:
                        raise ValueError('服务协议过大')
                schema = json.loads(data)
            paths = schema.get('paths', {})
            fields = schema.get('components', {}).get('schemas', {}).get('TTS_Request', {}).get('properties', {})
            if not {'/tts', '/set_gpt_weights', '/set_sovits_weights'}.issubset(paths) or not {
                'text', 'text_lang', 'ref_audio_path', 'prompt_lang'}.issubset(fields):
                raise ValueError('当前服务不是兼容的 GPT-SoVITS API v2')
    return True


class PortLease:
    """Cross-editor start exclusion; a crash releases the OS lock automatically."""
    def __init__(self, root, port):
        root.mkdir(parents=True, exist_ok=True)
        self.file = (root / f'port-{port}.lock').open('a+b')
        try:
            if os.fstat(self.file.fileno()).st_size == 0:
                self.file.write(b'0')
                self.file.flush()
            self.file.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.file.close()
            raise ValueError('另一个编辑器正在管理此端口，请等待后重新检测') from error

    def close(self):
        self.file.close()


class LocalTtsServices:
    def __init__(self, root):
        self.root = Path(root) / 'tts-services'
        self.lock = threading.RLock()
        self.closed = False
        self.states = {}
        self.processes = {}
        self.workers = {}
        self.stops = {}
        self.leases = {}
        self.logs = {}

    def settings(self, kind):
        identity(kind)
        default = {'directory': '', 'python': '', 'port': SERVICES[kind][1], 'startup_timeout': 600, 'qwen_emo': False}
        try:
            value = json.loads((self.root / (kind + '.json')).read_text(encoding='utf-8'))
            return {**default, **{k: value[k] for k in default if k in value}}
        except (OSError, ValueError, TypeError):
            return default

    def snapshot(self, kind):
        with self.lock:
            settings = self.settings(kind)
            state = self.states.get(kind, {'state': 'idle', 'message': '尚未检测服务'})
            process = self.processes.get(kind)
            owned = process is not None and process.poll() is None
            if process is not None and not owned and state['state'] == 'ready':
                state = self.states[kind] = {'state': 'failed', 'message': '服务已退出，请重新启动或检测'}
            return {'engine': kind, 'settings': settings, **copy.deepcopy(state), 'owned': owned,
                    'logs': list(self.logs.get(kind, [])),
                    'configured': bool(settings['directory'] and Path(settings['python']).is_file()),
                    'service_url': f"http://127.0.0.1:{settings['port']}"}

    def configure(self, kind, raw):
        identity(kind)
        with self.lock:
            if self.closed:
                raise ValueError('编辑器服务正在关闭')
            if self.workers.get(kind) and self.workers[kind].is_alive():
                raise ValueError('服务正在检测或启动，请稍后保存配置')
            old = self.settings(kind)
            value = {**old, **{k: raw[k] for k in ('directory', 'port', 'startup_timeout', 'qwen_emo') if k in raw}}
            for key, low, high in [('port', 1024, 65535), ('startup_timeout', 30, 3600)]:
                if type(value[key]) is not int or not low <= value[key] <= high:
                    raise ValueError(f'{key} 须为 {low}–{high} 的整数')
            if type(value['qwen_emo']) is not bool:
                raise ValueError('文本情感模型开关无效')
            if value['directory']:
                directory, python = installation(kind, value['directory'])
                value.update(directory=str(directory), python=str(python))
            else:
                value.update(directory='', python='')
            if self.snapshot(kind)['owned'] and value != old:
                raise ValueError('请先停止 MSW 启动的服务，再修改启动配置')
            atomic_bytes(self.root / (kind + '.json'), (json.dumps(value, ensure_ascii=False) + '\n').encode())
            if value != old or kind not in self.states:
                self.states[kind] = {'state': 'idle', 'message': '配置已保存；启动时检查模型资源'}
            return self.snapshot(kind)

    def start(self, kind, *, check_only=False):
        identity(kind)
        with self.lock:
            if self.closed:
                raise ValueError('编辑器服务正在关闭')
            if self.workers.get(kind) and self.workers[kind].is_alive():
                return self.snapshot(kind)
            stop = self.stops[kind] = threading.Event()
            self.states[kind] = {'state': 'checking', 'message': '正在检测服务'}
            worker = self.workers[kind] = threading.Thread(target=self._start, args=(kind, stop, check_only), daemon=True)
            worker.start()
            return self.snapshot(kind)

    def _read_log(self, kind, process, root):
        from maw.local_log import redact_sensitive_text
        try:
            while True:
                line = process.stdout.readline(4096)
                if not line:
                    break
                text = redact_sensitive_text(line.decode('utf-8', errors='replace').strip())
                text = text.replace(str(root), '[安装目录]').replace(str(self.root), '[MSW目录]')[:600]
                with self.lock:
                    if self.processes.get(kind) is process and text:
                        self.logs.setdefault(kind, deque(maxlen=100)).append(text)
        finally:
            process.stdout.close()

    def _failure(self, kind, code):
        text = '\n'.join(self.logs.get(kind, [])).lower()
        if 'out of memory' in text or 'cuda error: memory' in text:
            return '显存或内存不足；请先停止闲置模型服务，再重新启动'
        if 'modulenotfounderror' in text or 'importerror' in text:
            return '安装环境缺少依赖；请在原工具中修复，展开启动日志查看详情'
        if 'address already in use' in text or 'winerror 10048' in text:
            return '端口已被占用，请修改端口后重试'
        return f'服务启动失败（退出码 {code}）；请展开启动日志检查环境与模型'

    def _state(self, kind, stop, state, message, **fields):
        with self.lock:
            if not stop.is_set():
                self.states[kind] = {'state': state, 'message': message, **fields}

    def _start(self, kind, stop, check_only):
        lease = None
        try:
            cfg = self.settings(kind)
            port = cfg['port']
            if port_open(port):
                try:
                    probe(kind, port)
                except Exception:
                    self._state(kind, stop, 'conflict', '端口已占用，且服务协议不兼容；请修改端口或检查原服务')
                    return
                owned = self.snapshot(kind)['owned']
                self._state(kind, stop, 'ready' if owned else 'external', '服务已就绪' if owned else '外部服务 · 已连接')
                return
            if check_only:
                self._state(kind, stop, 'stopped', '服务未运行')
                return
            root, python = installation(kind, cfg['directory'])
            config = model_check(kind, root, python, cfg['qwen_emo'])
            lease = PortLease(self.root, port)
            if port_open(port):
                raise ValueError('端口刚被占用，请重新检测服务')
            from maw.gui_platform import asset_path
            command = [str(python), str(asset_path('maw/msw/tts_service_runner.py')), str(root), kind]
            if kind == 'indextts':
                command += ['--version', '2.5', '--host', '127.0.0.1', '--port', str(port)]
                if cfg['qwen_emo']:
                    command.append('--qwen_emo')
            else:
                config_path = self.root / 'gpt-sovits-infer.json'
                atomic_bytes(config_path, (json.dumps(config, ensure_ascii=False) + '\n').encode())
                command += ['-a', '127.0.0.1', '-p', str(port), '-c', str(config_path.resolve())]
            with self.lock:
                if stop.is_set() or self.closed:
                    return
                process = popen_process_tree(command, cwd=root, env=environment(), stdin=subprocess.DEVNULL,
                                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **process_group_kwargs())
                self.processes[kind] = process
                self.logs[kind] = deque(maxlen=100)
                threading.Thread(target=self._read_log, args=(kind, process, root), daemon=True).start()
                self.leases[kind], lease = lease, None
                stamp = {'pid': process.pid, 'started_at': time.time(), 'engine': kind, 'port': port,
                         'config_fingerprint': hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()}
                # A record is diagnostic, never sufficient authority to kill a PID.
                atomic_bytes(self.root / (kind + '-process.json'), (json.dumps(stamp) + '\n').encode())
                self._state(kind, stop, 'loading', '正在加载模型…', **stamp)
            deadline = time.monotonic() + cfg['startup_timeout']
            while not stop.wait(0.5):
                if process.poll() is not None:
                    raise ValueError(self._failure(kind, process.returncode))
                if time.monotonic() > deadline:
                    raise ValueError('模型加载超时；请检查环境或提高启动等待上限')
                if port_open(port):
                    try:
                        probe(kind, port)
                    except Exception:
                        continue
                    self._state(kind, stop, 'ready', '服务已就绪', **stamp)
                    return
        except Exception as error:
            with self.lock:
                self._dispose(kind)
            self._state(kind, stop, 'failed', str(error)[:500] if isinstance(error, ValueError) else '本机服务启动失败，请检查安装与端口')
        finally:
            if lease:
                lease.close()

    def ensure(self, kind, url, cancel, expected=None):
        from maw.msw.jobs import JobCancelled
        state = self.snapshot(kind)
        if expected is not None and expected != state['settings']:
            raise ValueError('本机启动配置在任务提交后已变化，请重新提交')
        if url != state['service_url']:
            raise ValueError('合成连接地址与本机启动端口不同，请在环境配置中统一后重试')
        if cancel.is_set():
            raise JobCancelled()
        self.start(kind)
        while not cancel.wait(0.15):
            state = self.snapshot(kind)
            if state['state'] in {'ready', 'external'}:
                return
            if state['state'] in {'failed', 'conflict', 'stopped'} or self.closed:
                raise ValueError(state['message'])
        raise JobCancelled()

    def _dispose(self, kind):
        process = self.processes.pop(kind, None)
        if process is not None:
            # Only the live Popen handle from this instance proves ownership.
            if process.poll() is None:
                terminate_process_tree(process)
            release_process_tree(process)
        lease = self.leases.pop(kind, None)
        if lease:
            lease.close()

    def stop(self, kind):
        identity(kind)
        with self.lock:
            if self.stops.get(kind):
                self.stops[kind].set()
            self._dispose(kind)
            self.states[kind] = {'state': 'stopped', 'message': 'MSW 启动的服务已停止'}
            return self.snapshot(kind)

    def close(self):
        with self.lock:
            self.closed = True
            for kind in SERVICES:
                self.stop(kind)
