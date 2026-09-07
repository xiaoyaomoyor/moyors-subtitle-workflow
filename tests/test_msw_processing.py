from __future__ import annotations

import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from maw.msw.config import provider_payloads, resolve_settings, save_settings
from maw.msw.jobs import JobManager, TERMINAL, translate_snapshot, validate_snapshot
from maw.msw.project_codec import normalize_extension
from maw.postprocess_llm import LlmSettings
from maw.project import normalize_project, ProjectValidationFailed

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('msw_processing_server_tests', ROOT / 'server-editor' / 'serve.py')
server_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server_module
SPEC.loader.exec_module(server_module)

SETTINGS = LlmSettings('custom', 'synthetic-test-key', 'http://127.0.0.1:1/v1', 'test-model', 'off')


def snapshot():
    return {'project_id': 'project-test', 'track_id': None, 'entries': [
        {'source': {'id': 'main-a', 'start': 0, 'end': 1000, 'text': 'Hello'}, 'target': None, 'binding_id': None},
        {'source': {'id': 'main-b', 'start': 2000, 'end': 3000, 'text': 'World'}, 'target': None, 'binding_id': None},
    ]}


def payload(key='request-test'):
    return {'kind': 'translation', 'project_id': 'project-test', 'client_token': 'page-1',
            'request_key': key, 'snapshot': snapshot(), 'language': 'zh', 'prompt': ''}


class ProcessingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.managers = []

    def tearDown(self):
        for manager in self.managers:
            manager.close()
            for worker in manager.workers:
                worker.join(5)
            self.assertTrue(manager.close_complete.wait(5))
        self.temp.cleanup()

    def manager(self, **kwargs):
        manager = JobManager(self.root / 'jobs.sqlite3', **kwargs)
        self.managers.append(manager)
        return manager

    def wait(self, manager, job_id):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            result = manager.get(job_id, 'project-test')
            if result['status'] in TERMINAL:
                return result
            time.sleep(.01)
        self.fail('background task did not finish')

    def test_snapshot_processing_uses_launcher_protocol_and_preserves_real_ids(self):
        original = snapshot()
        def complete(settings, prompt, cues):
            self.assertEqual(settings, SETTINGS)
            return {'groups': [{'source_ids': [cue['id']], 'text': '译文 ' + cue['text']} for cue in cues]}
        with patch('maw.msw.jobs.complete_subtitle_groups', side_effect=complete):
            result = translate_snapshot(original, 'zh', '', SETTINGS, threading.Event(), lambda *_: None)
        self.assertEqual(result['translations'], [{'id': 'main-a', 'text': '译文 Hello'}, {'id': 'main-b', 'text': '译文 World'}])
        self.assertEqual(original, snapshot())

    def test_project_namespace_is_preserved_and_invalid_versions_rejected(self):
        extension = {'schema': 'msw.editor.v1', 'project_id': 'project-test', 'applied_results': ['job-1'],
                     'translation_applications': {'job-2': ['main-a']}, 'future_field': {'opaque': [1, 2]}}
        result = normalize_project({'segments': [], 'msw': extension})
        self.assertEqual(result['msw'], extension)
        result['msw']['future_field']['opaque'].append(3)
        self.assertEqual(extension['future_field']['opaque'], [1, 2])
        with self.assertRaises(ProjectValidationFailed):
            normalize_project({'segments': [], 'msw': {**extension, 'schema': 'msw.editor.v2'}})
        with self.assertRaises(ValueError):
            normalize_extension({**extension, 'translation_applications': {'job-1': [False]}})
        with self.assertRaises(ValueError):
            normalize_extension({**extension, 'translation_target_tracks': {'job-1': 42}})
        self.assertEqual(normalize_extension({**extension, 'translation_target_tracks': {'job-1': 'track-1'}})['translation_target_tracks'], {'job-1': 'track-1'})

    def test_snapshot_rejects_duplicate_ids_invalid_times_and_extra_credentials(self):
        data = snapshot()
        data['apiKey'] = SETTINGS.api_key
        data['entries'][0]['source']['apiKey'] = SETTINGS.api_key
        self.assertNotIn(SETTINGS.api_key, json.dumps(validate_snapshot(data)))
        for mutate in [lambda s: s['entries'].append(copy.deepcopy(s['entries'][0])),
                       lambda s: s['entries'][0]['source'].update(end=-1),
                       lambda s: s['entries'][0]['source'].update(text=' '),
                       lambda s: s.update(project_id='../bad')]:
            data = snapshot()
            mutate(data)
            with self.assertRaises(ValueError):
                validate_snapshot(data)

    def test_existing_opaque_unicode_cue_track_and_binding_ids_remain_supported(self):
        data = snapshot()
        data['track_id'] = '已有副字幕轨'
        data['entries'][0]['source']['id'] = '主字幕-' + '甲' * 140
        data['entries'][0]['binding_id'] = '字幕绑定'
        data['entries'][0]['target'] = {'id': '副字幕', 'start': 50, 'end': 950, 'text': '旧译文'}
        self.assertEqual(validate_snapshot(data), data)
        extension = {'schema': 'msw.editor.v1', 'project_id': 'project-test',
                     'translation_applications': {'job1': [data['entries'][0]['source']['id']]},
                     'translation_target_tracks': {'job1': data['track_id']}}
        self.assertEqual(normalize_extension(extension), extension)

    def test_idempotent_jobs_persist_results_and_hide_credentials(self):
        calls = []
        def translate(data, *_args):
            calls.append(data)
            return {'translations': [{'id': 'main-a', 'text': '你好'}]}
        manager = self.manager(translate=translate)
        first = manager.submit(payload(), SETTINGS)
        repeated = manager.submit(payload(), SETTINGS)
        self.assertEqual(first['id'], repeated['id'])
        done = self.wait(manager, first['id'])
        self.assertEqual(done['status'], 'succeeded')
        self.assertEqual(len(calls), 1)
        self.assertNotIn('snapshot', manager.list('project-test')['jobs'][0])
        self.assertNotIn(SETTINGS.api_key, json.dumps(done))
        raw = manager.db.execute('SELECT payload FROM jobs').fetchone()[0]
        self.assertNotIn(SETTINGS.api_key, raw)
        with self.assertRaises(KeyError):
            manager.get(first['id'], 'different-project')
        with self.assertRaises(ValueError):
            manager.submit({**payload(), 'language': 'en'}, SETTINGS)
        manager.acknowledge(first['id'], 'project-test', 'stale')
        manager.close()
        for worker in manager.workers:
            worker.join(5)
        reopened = self.manager(translate=translate)
        restored = reopened.get(first['id'], 'project-test')
        self.assertEqual(restored['application'], 'stale')
        self.assertEqual(restored['result'], done['result'])
        self.assertEqual(len(calls), 1)

    def test_cancelling_discards_late_results(self):
        started, release = threading.Event(), threading.Event()
        def translate(*_args):
            started.set()
            release.wait(3)
            return {'translations': []}
        manager = self.manager(translate=translate)
        task = manager.submit(payload(), SETTINGS)
        try:
            self.assertTrue(started.wait(2))
            self.assertEqual(manager.cancel(task['id'], 'project-test')['status'], 'cancel_requested')
        finally:
            release.set()
        result = self.wait(manager, task['id'])
        self.assertEqual(result['status'], 'cancelled')
        self.assertIsNone(result['result'])

    def test_closing_marks_unfinished_jobs_interrupted_without_retry(self):
        started, release = threading.Event(), threading.Event()
        def translate(*_args):
            started.set()
            release.wait(3)
            return {}
        manager = self.manager(translate=translate)
        task = manager.submit(payload(), SETTINGS)
        try:
            self.assertTrue(started.wait(2))
            manager.close()
        finally:
            release.set()
        for worker in manager.workers:
            worker.join(5)
        reopened = self.manager(translate=lambda *_: self.fail('must not retry'))
        self.assertEqual(reopened.get(task['id'], 'project-test')['status'], 'interrupted')

    def test_error_redacts_key_and_queue_stays_usable(self):
        def translate(*_args):
            raise RuntimeError('provider failed: ' + SETTINGS.api_key)
        manager = self.manager(translate=translate, test_connection=lambda _: None)
        task = manager.submit(payload(), SETTINGS)
        result = self.wait(manager, task['id'])
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn(SETTINGS.api_key, json.dumps(result))
        next_task = manager.submit({**payload('connection-request'), 'kind': 'connection_test'}, SETTINGS)
        self.assertEqual(self.wait(manager, next_task['id'])['status'], 'succeeded')

    def test_shared_config_masks_keys_and_rejects_insecure_cloud_url(self):
        env = self.root / 'isolated.env'
        with patch.dict(os.environ, {}, clear=True):
            public = save_settings(env, {'providerId': 'custom', 'apiKey': SETTINGS.api_key,
                                        'baseUrl': SETTINGS.base_url, 'model': SETTINGS.model, 'reasoningMode': 'off'})
            self.assertNotIn(SETTINGS.api_key, json.dumps(public))
            self.assertEqual(resolve_settings(env, {'providerId': 'custom'}), SETTINGS)
            self.assertEqual(public, provider_payloads(env))
            with self.assertRaisesRegex(ValueError, 'HTTPS'):
                resolve_settings(env, {'providerId': 'custom', 'baseUrl': 'http://example.com/v1'})


class ProcessingApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / 'project.mosp'
        self.path.write_text(json.dumps({'segments': [], 'msw': {'schema': 'msw.editor.v1', 'project_id': 'project-test'}}), encoding='utf-8')
        with patch.object(server_module, 'DEFAULT_ENV_PATH', self.root / 'isolated.env'):
            project = server_module.load_project(self.path, None, str(self.root / 'stickers'), no_waveform=True, peaks_per_second=100)
        self.server = server_module.EditorServer(('127.0.0.1', 0), project, no_waveform=True, settings_path=self.root / 'settings.json')
        self.server.processing_api.env_path = self.root / 'isolated.env'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}/api/msw/'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)
        self.temp.cleanup()

    def call(self, route, body=None, headers=None):
        request = Request(self.url + route, data=json.dumps(body).encode() if body is not None else None,
                          headers={'X-MSW-Token': self.server.request_token, 'Content-Type': 'application/json', **(headers or {})})
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_routes_require_token_and_same_origin(self):
        self.assertEqual(self.call('capabilities')[0], 200)
        self.assertEqual(self.call('providers', headers={'X-MSW-Token': ''})[0], 403)
        self.assertEqual(self.call('providers', headers={'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.call('providers', headers={'Host': 'example.com'})[0], 403)
        self.assertEqual(self.call('providers', headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.call('providers', body={'providerId': 'custom'})[0], 400)

    def test_save_guards_disk_revision_and_project_binding(self):
        _, context = self.call('capabilities')
        body = {'project': self.server.project.data, 'binding': context['binding'], 'saveRevision': context['saveRevision']}
        status, result = self.call('project', body)
        self.assertEqual(status, 200, result)
        self.assertNotEqual(result['saveRevision'], context['saveRevision'])
        # An old page cannot overwrite a newer save, even if its contents validate.
        self.assertEqual(self.call('project', body)[0], 409)
        body['saveRevision'] = result['saveRevision']
        self.server.processing_api.invalidate_binding()
        self.assertEqual(self.call('project', body)[0], 409)
        _, current = self.call('capabilities')
        body.update(binding=current['binding'], saveRevision=current['saveRevision'])
        self.path.write_text('{"segments": []}', encoding='utf-8')
        self.assertEqual(self.call('project', body)[0], 409)
        self.assertEqual(self.path.read_text(encoding='utf-8'), '{"segments": []}')


if __name__ == '__main__':
    unittest.main()
