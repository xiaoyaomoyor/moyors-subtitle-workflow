"""Explicit, cancellable local-model preparation from the standalone editor."""

import threading
import sys

from maw.gui_config import PROVIDERS, effective_config
from maw.local_models import prepare_local_model
from maw.local_runtime import (install_local_runtime, managed_runtime_status,
    prepare_alignment_model_in_process, prepare_alignment_model_in_runtime,
    prepare_punctuation_model_in_process, prepare_punctuation_model_in_runtime)
from maw.alignment_models import alignment_model_by_id
from maw.local_log import redact_sensitive_text


class LocalModels:
    def __init__(self, env_path):
        self.env_path = env_path
        self.lock = threading.RLock()
        self.worker = None
        self.cancel = threading.Event()
        self.state = {'status': 'idle', 'message': ''}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def operate(self, payload):
        action = payload.get('action')
        if action == 'cancel':
            self.cancel.set()
            return self.snapshot()
        if action not in {'runtime', 'model', 'aligner', 'punctuation'}:
            raise ValueError('未知本地模型操作')
        model = None
        model_id = str(payload.get('modelId', ''))
        if action in {'runtime', 'model'}:
            model = next((m for p in PROVIDERS if p.kind == 'local' for m in p.models if m.id == model_id), None)
            if model is None:
                raise ValueError('未知本地识别模型')
        if action == 'aligner':
            alignment_model_by_id(model_id)
        root = effective_config(self.env_path).model_cache_root
        with self.lock:
            if self.worker and self.worker.is_alive():
                raise ValueError('已有本地模型准备任务，请等待完成或取消')
            self.cancel = threading.Event()
            self.state = {'status': 'running', 'message': '正在准备，首次下载可能需要数 GB', 'action': action}
            self.worker = threading.Thread(target=self._run, args=(action, model, model_id, root, self.cancel), daemon=True)
            self.worker.start()
            return self.snapshot()

    def _run(self, action, model, model_id, root, cancel):
        def emit(*values):
            with self.lock:
                self.state['message'] = redact_sensitive_text(str(values[-1]))[-1000:] if values else ''
        try:
            common = dict(model_cache_root=root, cancel_event=cancel, on_event=emit)
            if action == 'runtime':
                install_local_runtime(engine=model.engine, repair=True, **common)
            elif action == 'model' and model.engine != 'firered':
                prepare_local_model(model, **common)
            else:
                managed = managed_runtime_status(root).ready
                if not managed and getattr(sys, 'frozen', False):
                    raise RuntimeError('请先安装或修复本地模型运行环境，再下载模型。')
                if action == 'punctuation':
                    prepare = prepare_punctuation_model_in_runtime if managed else prepare_punctuation_model_in_process
                    prepare(**common)
                else:
                    prepare = prepare_alignment_model_in_runtime if managed else prepare_alignment_model_in_process
                    prepare(model_id='firered-asr2-ctc' if action == 'model' else model_id, **common)
            status, message = ('cancelled', '已取消') if cancel.is_set() else ('succeeded', '准备完成，请刷新模型状态')
        except Exception as error:
            status, message = ('cancelled', '已取消') if cancel.is_set() else ('failed', redact_sensitive_text(str(error))[-1000:])
        with self.lock:
            self.state.update(status=status, message=message)

    def close(self):
        self.cancel.set()
        if self.worker:
            self.worker.join(timeout=3)
