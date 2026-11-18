"""Frozen-Linux environment contracts and runnable staged worker sources."""

import ast
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from maw import gui_platform, local_runtime, ocr_runtime, notify
from maw.runtimes import LOCAL, MOSS, OCR
from maw.msw import tts_local_services

ROOT = Path(__file__).resolve().parents[1]


class HostEnvironmentTests(unittest.TestCase):
    def test_only_frozen_linux_changes_a_copy(self):
        for platform, frozen in [('linux', True), ('linux', False), ('darwin', True), ('win32', True)]:
            for original in [None, '', '/host/lib']:
                values = {'LD_LIBRARY_PATH': '/bundle/lib', 'KEEP': 'yes'}
                if original is not None:
                    values['LD_LIBRARY_PATH_ORIG'] = original
                before = dict(values)
                with self.subTest(platform=platform, frozen=frozen, original=original), patch.object(sys, 'platform', platform), patch.object(sys, 'frozen', frozen, create=True):
                    result = gui_platform.restore_host_library_path(values)
                self.assertEqual(values, before)
                self.assertIsNot(result, values)
                self.assertEqual(result.get('LD_LIBRARY_PATH'), original if platform == 'linux' and frozen else '/bundle/lib')
                self.assertEqual(result['KEEP'], 'yes')

    def test_asr_ocr_and_managed_environments_preserve_other_settings(self):
        with patch.dict(os.environ, {'LD_LIBRARY_PATH':'/bundle/lib', 'LD_LIBRARY_PATH_ORIG':'/host/lib'}), patch.object(sys, 'platform', 'linux'), patch.object(sys, 'frozen', True, create=True):
            environments = [local_runtime._runtime_env(), ocr_runtime._runtime_env()]
            environments.extend(runtime.environment() for runtime in (LOCAL, MOSS, OCR))
            for env in environments:
                self.assertEqual(env['LD_LIBRARY_PATH'], '/host/lib')
                self.assertEqual(env['PYTHONUNBUFFERED'], '1')
            self.assertEqual(os.environ['LD_LIBRARY_PATH'], '/bundle/lib')
            # MSW TTS services already use an allowlist, never the bundle path.
            self.assertNotIn('LD_LIBRARY_PATH', tts_local_services.environment())

    def test_linux_notification_uses_host_libraries(self):
        with patch.dict(os.environ, {'LD_LIBRARY_PATH':'/bundle/lib', 'LD_LIBRARY_PATH_ORIG':'/host/lib'}), patch.object(sys, 'platform', 'linux'), patch.object(sys, 'frozen', True, create=True), patch.object(notify.shutil, 'which', return_value='/usr/bin/notify-send'), patch.object(notify.subprocess, 'Popen') as launch:
            self.assertTrue(notify.send_system_notification('Synthetic', 'Test'))
        self.assertEqual(launch.call_args.kwargs['env']['LD_LIBRARY_PATH'], '/host/lib')

    def test_runtime_bootstrap_probe_and_venv_use_host_libraries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.dict(os.environ, {'LD_LIBRARY_PATH':'/bundle/lib', 'LD_LIBRARY_PATH_ORIG':'/host/lib'}), patch.object(sys, 'platform', 'linux'), patch.object(sys, 'frozen', True, create=True), patch('maw.runtimes.base.shutil.which', return_value='/usr/bin/python3'), patch('maw.runtimes.base.subprocess.run', return_value=Mock(returncode=0)) as probe, patch.object(LOCAL, 'run') as run:
                LOCAL._prepare_host_venv(root, root/'bin/python', repair=False, emit=Mock(), cancel=__import__('threading').Event(), model_cache_root=None)
            self.assertEqual(probe.call_args.kwargs['env']['LD_LIBRARY_PATH'], '/host/lib')
            self.assertTrue(run.called)
            self.assertTrue(all(call.kwargs['env']['LD_LIBRARY_PATH'] == '/host/lib' for call in run.call_args_list))

    def test_staged_runtime_sources_import_without_workspace_fallback(self):
        tree = ast.parse((ROOT/'MSW.spec').read_text(encoding='utf-8'))
        datas = next(n.value for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'datas' for t in n.targets))
        def path_value(node):
            if isinstance(node, ast.Name) and node.id == 'ROOT': return ROOT
            if isinstance(node, ast.Constant): return node.value
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div): return path_value(node.left) / path_value(node.right)
            raise AssertionError('Unexpected data path')
        with tempfile.TemporaryDirectory() as temporary:
            for bundle, modules in [('local-runtime', ['maw.runtimes', 'maw.local_runtime', 'maw.moss_runtime', 'maw.local_runtime_worker', 'generate_subtitle_local']), ('ocr-runtime', ['maw.runtimes', 'maw.ocr_runtime_worker'])]:
                stage = Path(temporary)/bundle
                for item in datas.elts:
                    if not isinstance(item, ast.Tuple): continue
                    source, destination = item.elts
                    if not isinstance(destination, ast.Constant) or not str(destination.value).startswith(bundle): continue
                    src = path_value(source.args[0])
                    dest = Path(temporary)/destination.value/src.name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(src, dest)
                code = 'import sys,importlib; from pathlib import Path; root=Path(sys.argv[1]).resolve(); sys.path.insert(0,str(root)); modules=[importlib.import_module(n) for n in sys.argv[2:]]; assert all(Path(m.__file__).resolve().is_relative_to(root) for m in modules)'
                env = {**os.environ, 'MSW_ENV_FILE':str(stage/'isolated.env'), 'MAW_ENV_FILE':str(stage/'isolated.env'), 'MSW_APP_DATA_ROOT':str(stage/'appdata')}
                result = subprocess.run([sys.executable, '-I', '-c', code, str(stage), *modules], cwd=stage, env=env, capture_output=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace')[-2000:])


if __name__ == '__main__':
    unittest.main()
