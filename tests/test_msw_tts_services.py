"""Lifecycle tests use synthetic installations and loopback protocols only."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

from index_service_fixture import IndexFixture, wav_bytes
from maw.msw import tts_engines
from maw.msw.index_tts import IndexTts, DEFAULT_RECIPE
from maw.msw.tts import TtsService, validate_snapshot
from maw.msw.assets import AssetStore
from maw.msw.jobs import JobCancelled
from maw.msw.tts_local_services import LocalTtsServices, PortLease, installation, probe, environment
from maw.msw.tts_service_runner import local_network_only


def wait(manager, kind='indextts'):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        state = manager.snapshot(kind)
        if state['state'] not in {'checking', 'loading'}:
            return state
        time.sleep(.02)
    raise AssertionError('lifecycle did not settle')


class EngineTests(unittest.TestCase):
    def test_missing_provider_is_legacy_but_unknown_is_rejected(self):
        self.assertEqual(tts_engines.provider({}).id, 'qwen')
        for value in ['future', '', None, []]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                tts_engines.provider({'recipe': {'provider': value}})
        self.assertEqual([v['id'] for v in tts_engines.capabilities()], ['qwen', 'yukkuri', 'indextts', 'gpt-sovits', 'edge', 'minimax', 'mossland'])

    def test_unknown_cannot_fall_through_to_paid_synthesis(self):
        synth = Mock()
        with self.assertRaises(ValueError):
            tts_engines.synthesize(SimpleNamespace(provider_id='future'), {'text': 'hello'}, threading.Event(), synth)
        synth.assert_not_called()

    def test_every_engine_checks_unicode_bounds(self):
        for provider in tts_engines.ENGINES:
            raw = {'project_id': 'project', 'entries': [{'key': 'entry', 'id': 'cue', 'track_id': None,
                    'start': 0, 'end': 1, 'text': '好' * 600}]}
            self.assertEqual(validate_snapshot(raw, provider), raw)
            raw['entries'][0]['text'] += '好'
            with self.assertRaises(ValueError):
                validate_snapshot(raw, provider)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.install = self.root / 'bundle with spaces' / 'nested'
        self.install.mkdir(parents=True)
        (self.install / 'webui.py').write_text('# fixture', encoding='utf-8')
        (self.install / 'api_v2.py').write_text('# fixture', encoding='utf-8')
        (self.install / 'runtime').mkdir()
        (self.install / 'runtime/python.exe').write_bytes(b'fixture')
        self.manager = LocalTtsServices(self.root / 'data')
        self.addCleanup(self.manager.close)

    def configure(self, kind='indextts', **extra):
        return self.manager.configure(kind, {'directory': str(self.install.parent), **extra})

    def test_nested_install_and_settings_do_not_start_anything(self):
        with patch('maw.msw.tts_local_services.popen_process_tree') as spawn:
            state = self.configure()
            self.assertEqual(state['settings']['directory'], str(self.install))
            self.assertTrue(state['configured'])
            spawn.assert_not_called()
        with self.assertRaises(ValueError):
            installation('gpt-sovits', self.install.anchor)

    def test_ambiguous_install_rejected_and_unsafe_settings_rejected(self):
        other = self.install.parent / 'other'
        (other / 'runtime').mkdir(parents=True)
        (other / 'webui.py').write_text('')
        (other / 'runtime/python.exe').write_text('')
        with self.assertRaisesRegex(ValueError, '多个'):
            installation('indextts', str(self.install.parent))
        for raw in [{'port': True}, {'port': 1}, {'startup_timeout': 0}, {'qwen_emo': 'true'}]:
            with self.assertRaises(ValueError):
                self.manager.configure('indextts', raw)

    def test_external_index_connects_without_install_and_never_stops(self):
        service = IndexFixture()
        self.addCleanup(service.close)
        self.manager.configure('indextts', {'port': int(service.url.rsplit(':', 1)[1])})
        with patch('maw.msw.tts_local_services.popen_process_tree') as spawn, patch('maw.msw.tts_local_services.terminate_process_tree') as kill:
            self.manager.start('indextts')
            state = wait(self.manager)
            self.assertEqual(state['state'], 'external')
            self.assertFalse(state['owned'])
            self.manager.close()
            spawn.assert_not_called(); kill.assert_not_called()
        self.assertTrue(probe('indextts', int(service.url.rsplit(':', 1)[1])))

    def test_port_conflict_never_launches_or_kills(self):
        with patch('maw.msw.tts_local_services.port_open', return_value=True), patch('maw.msw.tts_local_services.probe', side_effect=ValueError()), patch('maw.msw.tts_local_services.popen_process_tree') as spawn:
            self.manager.start('gpt-sovits')
            self.assertEqual(wait(self.manager, 'gpt-sovits')['state'], 'conflict')
            spawn.assert_not_called()

    def test_same_service_start_coalesces_and_stop_cleans_only_owned(self):
        self.configure()
        gate = threading.Event()
        process = Mock(pid=12345, returncode=None)
        process.poll.return_value = None
        process.stdout.readline.return_value = b''
        def check(*args): gate.wait(3)
        with patch('maw.msw.tts_local_services.port_open', return_value=False), patch('maw.msw.tts_local_services.model_check', side_effect=check) as preflight, patch('maw.msw.tts_local_services.popen_process_tree', return_value=process) as spawn, patch('maw.msw.tts_local_services.terminate_process_tree') as kill, patch('maw.msw.tts_local_services.release_process_tree'):
            self.manager.start('indextts'); self.manager.start('indextts')
            gate.set()
            deadline = time.monotonic() + 3
            while not spawn.called and time.monotonic() < deadline: time.sleep(.01)
            self.assertEqual(preflight.call_count, 1); self.assertEqual(spawn.call_count, 1)
            args, kwargs = spawn.call_args
            self.assertIsInstance(args[0], list)
            self.assertIn('127.0.0.1', args[0]); self.assertNotIn('0.0.0.0', args[0])
            self.assertEqual(kwargs['cwd'], self.install)
            self.assertNotIn('shell', kwargs)
            self.manager.stop('indextts'); self.manager.workers['indextts'].join(2)
            kill.assert_called_once_with(process)

    def test_cancel_while_loading_does_not_kill_shared_service(self):
        self.configure()
        cancelled = threading.Event()
        with patch.object(self.manager, 'start'), patch('maw.msw.tts_local_services.terminate_process_tree') as kill:
            self.manager.states['indextts'] = {'state': 'loading', 'message': 'loading'}
            timer = threading.Timer(.1, cancelled.set); timer.start()
            with self.assertRaises(JobCancelled):
                self.manager.ensure('indextts', 'http://127.0.0.1:7860', cancelled)
            timer.join(); kill.assert_not_called()

    def test_settings_changed_after_submit_rejected(self):
        state = self.configure()
        self.configure(qwen_emo=True)
        with self.assertRaisesRegex(ValueError, '提交后已变化'):
            self.manager.ensure('indextts', state['service_url'], threading.Event(), state['settings'])

    def test_missing_models_never_spawn(self):
        self.configure()
        with patch('maw.msw.tts_local_services.port_open', return_value=False), patch('maw.msw.tts_local_services.model_check', side_effect=ValueError('缺少模型')), patch('maw.msw.tts_local_services.popen_process_tree') as spawn:
            self.manager.start('indextts')
            self.assertEqual(wait(self.manager)['state'], 'failed')
            spawn.assert_not_called()

    def test_failed_child_releases_lease(self):
        self.configure()
        process = Mock(pid=123, returncode=2); process.poll.return_value = 2
        process.stdout.readline.return_value = b''
        with patch('maw.msw.tts_local_services.port_open', return_value=False), patch('maw.msw.tts_local_services.model_check'), patch('maw.msw.tts_local_services.popen_process_tree', return_value=process), patch('maw.msw.tts_local_services.release_process_tree'):
            self.manager.start('indextts')
            self.assertEqual(wait(self.manager)['state'], 'failed')
            self.assertFalse(self.manager.leases)

    def test_cross_instance_lease_released_on_close(self):
        lease = PortLease(self.root, 12345)
        with self.assertRaises(ValueError): PortLease(self.root, 12345)
        lease.close()
        PortLease(self.root, 12345).close()

    def test_loading_timeout_stops_only_owned_process(self):
        self.configure(startup_timeout=30)
        process = Mock(pid=123, returncode=None); process.poll.return_value = None
        process.stdout.readline.return_value = b''
        with patch('maw.msw.tts_local_services.port_open', return_value=False), patch('maw.msw.tts_local_services.model_check'), patch('maw.msw.tts_local_services.popen_process_tree', return_value=process), patch('maw.msw.tts_local_services.terminate_process_tree') as kill, patch('maw.msw.tts_local_services.release_process_tree'), patch('maw.msw.tts_local_services.time.monotonic', side_effect=[0, 31]):
            self.manager._start('indextts', threading.Event(), False)
            self.assertEqual(self.manager.snapshot('indextts')['state'], 'failed')
            self.assertIn('超时', self.manager.snapshot('indextts')['message'])
            kill.assert_called_once_with(process)
            self.assertFalse(self.manager.leases)

    def test_shutdown_during_preflight_prevents_late_spawn(self):
        self.configure()
        gate, entered = threading.Event(), threading.Event()
        def preflight(*args):
            entered.set(); gate.wait(3)
        with patch('maw.msw.tts_local_services.port_open', return_value=False), patch('maw.msw.tts_local_services.model_check', side_effect=preflight), patch('maw.msw.tts_local_services.popen_process_tree') as spawn:
            self.manager.start('indextts'); self.assertTrue(entered.wait(2))
            self.manager.close(); gate.set(); self.manager.workers['indextts'].join(2)
            spawn.assert_not_called()
            self.assertFalse(self.manager.leases)

    def test_offline_environment_no_keys_and_network_guard(self):
        with patch.dict('os.environ', {'DASHSCOPE_API_KEY': 'never-forward', 'PYTHONPATH': 'bad'}):
            env = environment()
            self.assertNotIn('DASHSCOPE_API_KEY', env); self.assertNotIn('PYTHONPATH', env)
            self.assertEqual(env['HF_HUB_OFFLINE'], '1')
        local_network_only('socket.connect', (None, ('127.0.0.1', 9880)))
        with self.assertRaises(OSError): local_network_only('socket.connect', (None, ('8.8.8.8', 443)))

    def test_gpt_config_copy_and_controlled_command(self):
        self.configure('gpt-sovits')
        config = {'custom': {'version': 'v2Pro'}}
        process = Mock(pid=123, returncode=1); process.poll.return_value = 1
        process.stdout.readline.return_value = b''
        with patch('maw.msw.tts_local_services.port_open', return_value=False), patch('maw.msw.tts_local_services.model_check', return_value=config), patch('maw.msw.tts_local_services.popen_process_tree', return_value=process) as spawn, patch('maw.msw.tts_local_services.release_process_tree'):
            self.manager.start('gpt-sovits'); wait(self.manager, 'gpt-sovits')
            command = spawn.call_args.args[0]
            self.assertEqual(command[-6:-2], ['-a', '127.0.0.1', '-p', '9880'])
            copied = Path(command[-1])
            self.assertTrue(copied.is_relative_to(self.manager.root))
            self.assertEqual(json.loads(copied.read_text()), config)

    def test_index_start_then_generate_freezes_recipe_and_cancel_before_submit(self):
        service = IndexFixture(); self.addCleanup(service.close)
        controller = IndexTts(self.root, lambda data, suffix: data)
        ref = controller.store_reference('test.wav', wav_bytes())
        controller.services = Mock()
        controller.services.snapshot.return_value = {'configured': True, 'service_url': service.url, 'settings': {}}
        raw = {'recipe': {**copy.deepcopy(DEFAULT_RECIPE), 'speaker_ref': ref['id']}, 'service_url': service.url}
        settings = controller.resolve(raw)
        raw['recipe']['emotion_vector'][0] = .9
        self.assertEqual(settings.recipe['emotion_vector'][0], 0)
        assets = AssetStore(self.root / 'assets')
        job = {'project_id': 'project', 'id': 'job', 'snapshot': {'entries': [
            {'key': 'entry', 'id': 'cue', 'track_id': None, 'start': 0, 'end': 1000, 'text': 'frozen'}]}}
        result = TtsService(assets).run(job, settings, threading.Event(), lambda *a: None)
        self.assertEqual(result['items'][0]['status'], 'ready')
        controller.services.ensure.assert_called_once()
        self.assertEqual(len([c for c in service.calls if c[0] == 'gen_single']), 1)
        controller.services.ensure.side_effect = JobCancelled()
        with self.assertRaises(JobCancelled): TtsService(assets).run(job, settings, threading.Event(), lambda *a: None)
        self.assertEqual(len([c for c in service.calls if c[0] == 'gen_single']), 1)
        controller.services.ensure.side_effect = None
        service.modes = service.modes[:3]
        invalid = controller.resolve({**raw, 'recipe': {**raw['recipe'], 'emotion_mode': 'text'}})
        with self.assertRaisesRegex(ValueError, 'QwenEmotion'):
            TtsService(assets).run(job, invalid, threading.Event(), lambda *a: None)
        self.assertEqual(len([c for c in service.calls if c[0] == 'gen_single']), 1)


if __name__ == '__main__':
    unittest.main()
