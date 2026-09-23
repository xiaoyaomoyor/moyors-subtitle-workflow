import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from maw.msw.local_models import LocalModels


class LocalModelControlTests(unittest.TestCase):
    def test_status_does_not_download_and_firered_keeps_punctuation_optional(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / 'isolated.env'; env.write_bytes(b'')
            service = LocalModels(env)
            with patch('maw.msw.local_models.managed_runtime_status', return_value=SimpleNamespace(ready=False)), patch(
                'maw.msw.local_models.prepare_alignment_model_in_process') as prepare, patch(
                'maw.msw.local_models.prepare_punctuation_model_in_process') as punc:
                self.assertEqual(service.snapshot()['status'], 'idle')
                prepare.assert_not_called()
                service.operate({'action': 'model', 'modelId': 'firered-asr2-ctc-local'})
                service.worker.join(3)
                self.assertEqual(service.snapshot()['status'], 'succeeded')
                self.assertEqual(prepare.call_args.kwargs['model_id'], 'firered-asr2-ctc')
                punc.assert_not_called()
            service.close()

    def test_preparation_is_single_worker_and_cancellable(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / 'isolated.env'; env.write_bytes(b'')
            service = LocalModels(env)
            started = threading.Event()
            def install(**kwargs):
                started.set(); kwargs['cancel_event'].wait(3)
            with patch('maw.msw.local_models.install_local_runtime', side_effect=install):
                service.operate({'action': 'runtime', 'modelId': 'firered-asr2-ctc-local'})
                self.assertTrue(started.wait(2))
                with self.assertRaises(ValueError): service.operate({'action': 'runtime', 'modelId': 'firered-asr2-ctc-local'})
                service.operate({'action': 'cancel'})
                service.worker.join(3)
                self.assertEqual(service.snapshot()['status'], 'cancelled')
            service.close()
