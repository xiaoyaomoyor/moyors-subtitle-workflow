import json
import tempfile
import unittest
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest import mock

from maw.hub_download import (MIRROR_REVISIONS, find_hub_snapshot, prepare_hub_snapshot,
                              resolve_model_source, snapshot_is_complete)


QWEN = 'Qwen/Qwen3-ASR-0.6B'


def model(path):
    path.mkdir(parents=True, exist_ok=True)
    (path / 'config.json').write_text('{}', encoding='utf-8')
    (path / 'model.safetensors').write_bytes(b'weights')
    return path


class HubDownloadTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.hf = self.root / 'hf'
        self.ms = self.root / 'ms'
        for target, root in [('_huggingface_cache_roots', self.hf), ('_modelscope_cache_roots', self.ms)]:
            patcher = mock.patch('maw.local_models.' + target, return_value=[root])
            patcher.start()
            self.addCleanup(patcher.stop)
        self.hf_download = mock.Mock()
        self.ms_download = mock.Mock()
        patcher = mock.patch.dict('sys.modules', {
            'huggingface_hub': SimpleNamespace(snapshot_download=self.hf_download),
            'modelscope': SimpleNamespace(snapshot_download=self.ms_download),
        })
        patcher.start()
        self.addCleanup(patcher.stop)

    def prepare(self, **kwargs):
        return prepare_hub_snapshot(QWEN, model_cache_root=self.root, **kwargs)

    def test_hf_download_then_network_fallback(self):
        expected = model(self.root / 'download')
        self.hf_download.return_value = expected
        self.assertEqual(self.prepare().source, 'huggingface')
        self.ms_download.assert_not_called()
        self.hf_download.side_effect = ConnectionError('token=private-value')
        self.ms_download.return_value = expected
        events = []
        self.assertEqual(self.prepare(emit=events.append).path, expected)
        self.assertEqual(self.ms_download.call_args.args, (QWEN,))
        self.assertNotIn('private-value', ''.join(events))

    def test_local_errors_and_authentication_do_not_fallback(self):
        for error in (PermissionError('readonly'), OSError(28, 'disk full'), ValueError('bad argument')):
            with self.subTest(error=error):
                self.hf_download.side_effect = error
                with self.assertRaises(type(error)):
                    self.prepare()
        for status in (401, 403, 404):
            error = RuntimeError('http error')
            error.response = SimpleNamespace(status_code=status)
            self.hf_download.side_effect = error
            with self.assertRaises(RuntimeError):
                self.prepare()
        self.ms_download.assert_not_called()

    def test_wrapped_connection_and_server_error_fallback(self):
        for status in (429, 503, None):
            error = RuntimeError('offline')
            if status:
                error.response = SimpleNamespace(status_code=status)
            else:
                error.__cause__ = TimeoutError()
            self.hf_download.side_effect = error
            self.ms_download.return_value = model(self.root / 'download')
            self.assertEqual(self.prepare().source, 'modelscope')

    def test_failed_both_sources_has_safe_summary(self):
        self.hf_download.side_effect = TimeoutError('token=secret')
        self.ms_download.side_effect = ConnectionError('password=secret')
        with self.assertRaisesRegex(RuntimeError, '两处下载均失败') as ctx:
            self.prepare()
        self.assertNotIn('secret', str(ctx.exception))

    def test_hf_cache_miss_wrapper_and_httpx_read_errors_fallback(self):
        cache_error_type = type('LocalEntryNotFoundError', (FileNotFoundError,), {'__module__': 'huggingface_hub.errors'})
        wrapped = cache_error_type('metadata unavailable')
        wrapped.__cause__ = TimeoutError()
        network_error_type = type('NetworkError', (Exception,), {'__module__': 'httpx'})
        read_error_type = type('ReadError', (network_error_type,), {'__module__': 'httpx'})
        for error in (wrapped, read_error_type('read interrupted')):
            self.hf_download.side_effect = error
            self.ms_download.return_value = model(self.root / 'download')
            self.assertEqual(self.prepare().source, 'modelscope')

    def test_cancel_before_between_and_after_sources(self):
        event = Event()
        event.set()
        with self.assertRaisesRegex(RuntimeError, '取消'):
            self.prepare(cancel_event=event)
        self.hf_download.assert_not_called()
        event.clear()
        def cancelled_hf(**kwargs):
            event.set()
            raise TimeoutError()
        self.hf_download.side_effect = cancelled_hf
        with self.assertRaisesRegex(RuntimeError, '取消'):
            self.prepare(cancel_event=event)
        self.ms_download.assert_not_called()
        event.clear()
        self.hf_download.side_effect = TimeoutError()
        def cancelled_ms(*args, **kwargs):
            event.set()
            return model(self.root / 'download')
        self.ms_download.side_effect = cancelled_ms
        with self.assertRaisesRegex(RuntimeError, '取消'):
            self.prepare(cancel_event=event)

    def test_complete_cache_is_reused_without_import_or_network(self):
        for relative in ('Qwen/Qwen3-ASR-0.6B', 'models/Qwen--Qwen3-ASR-0.6B/snapshots/abc', 'hub/Qwen/Qwen3-ASR-0.6B'):
            with self.subTest(layout=relative), tempfile.TemporaryDirectory(dir=self.root) as directory:
                root = Path(directory)
                path = model(root / relative)
                with mock.patch('maw.local_models._modelscope_cache_roots', return_value=[root]):
                    result = self.prepare()
                self.assertEqual(result.source, 'modelscope')
                self.assertEqual(result.path, path.resolve())
        self.hf_download.assert_not_called()
        self.ms_download.assert_not_called()
        path = model(self.hf / 'models--Qwen--Qwen3-ASR-0.6B/snapshots/main')
        self.assertEqual(self.prepare().path, path.resolve())

    def test_incomplete_shards_do_not_count_as_installed(self):
        path = model(self.root / 'download')
        (path / 'model.safetensors.index.json').write_text(json.dumps({'weight_map': {'a': 'part1.safetensors', 'b': 'part2.safetensors'}}))
        self.assertFalse(snapshot_is_complete(path))
        (path / 'part1.safetensors').write_bytes(b'one')
        self.assertFalse(snapshot_is_complete(path))
        (path / 'part2.safetensors').write_bytes(b'two')
        self.assertTrue(snapshot_is_complete(path))
        (path / 'config.json').write_text('')
        self.assertFalse(snapshot_is_complete(path))

    def test_default_moss_pin_uses_equivalent_mirror_revision(self):
        (repo, revision), mirror_revision = next(iter(MIRROR_REVISIONS.items()))
        wrong = model(self.hf / ('models--' + repo.replace('/', '--')) / 'snapshots/wrong')
        self.assertIsNone(find_hub_snapshot(repo, self.root, revision=revision))
        self.hf_download.side_effect = TimeoutError()
        path = model(self.ms / 'models/OpenMOSS--MOSS-Transcribe-Diarize')
        self.ms_download.return_value = path
        result = prepare_hub_snapshot(repo, model_cache_root=self.root, revision=revision)
        self.assertEqual(result.path, path)
        self.assertEqual(self.hf_download.call_args.kwargs['revision'], revision)
        self.assertEqual(self.ms_download.call_args.kwargs['revision'], mirror_revision)
        self.assertEqual(find_hub_snapshot(repo, self.root, revision=revision).path, path.resolve())

    def test_unknown_mirror_is_not_guessed(self):
        self.hf_download.side_effect = TimeoutError()
        with self.assertRaises(TimeoutError):
            prepare_hub_snapshot('someone/custom', model_cache_root=self.root)
        self.ms_download.assert_not_called()

    def test_local_paths_never_download(self):
        self.assertEqual(resolve_model_source(str(self.root)), str(self.root))
        with self.assertRaises(ValueError):
            resolve_model_source(str(self.root / 'missing'))
        self.hf_download.assert_not_called()


if __name__ == '__main__':
    unittest.main()
