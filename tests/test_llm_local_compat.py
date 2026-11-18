"""Local protocol compatibility without external services or personal settings."""

import json
import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from requests.exceptions import HTTPError

from maw import postprocess_llm as llm
from maw.gui_web import LauncherApi, LauncherPaths
from maw.msw.config import provider_payloads, resolve_settings, save_settings
from maw.postprocess_pipeline import validate_plan


SETTINGS = llm.LlmSettings('custom', '', 'http://127.0.0.1:12345/v1', 'local-test')
GROUPS = {'groups': [{'id': 'c0001', 'text': 'Hello <think>literal</think>'}]}


def response(status=200, content=None, message='unsupported response_format'):
    result = Mock(status_code=status, headers={})
    if status >= 400:
        result.json.return_value = {'error': {'message': message}}
        result.raise_for_status.side_effect = HTTPError(str(status))
    else:
        result.json.return_value = {'choices': [{'message': {'content': content if content is not None else json.dumps(GROUPS)}}]}
    return result


class LocalLlmTests(unittest.TestCase):
    def setUp(self):
        llm._json_constraint_modes.clear()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / 'isolated.env'
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(llm._json_constraint_modes.clear)

    def complete(self, replies, **kwargs):
        session = MagicMock()
        session.__enter__.return_value = session
        session.post.side_effect = replies
        with patch.object(llm.requests, 'Session', return_value=session):
            result = llm.complete_subtitle_groups(SETTINGS, 'Return JSON groups.', [], **kwargs)
        return result, session

    def test_schema_negotiation_is_cached_per_endpoint_and_model(self):
        rejected, accepted = response(400), response()
        result, session = self.complete([rejected, accepted])
        self.assertEqual(result, GROUPS)
        self.assertEqual([c.kwargs['json']['response_format']['type'] for c in session.post.call_args_list], ['json_object', 'json_schema'])
        schema = session.post.call_args.kwargs['json']['response_format']['json_schema']['schema']
        self.assertIn('groups', schema['properties'])
        self.assertEqual(session.post.call_args.kwargs['headers'], {})
        for item in [rejected, accepted]:
            item.close.assert_called_once()
        _, cached = self.complete([response()])
        self.assertEqual(cached.post.call_args.kwargs['json']['response_format']['type'], 'json_schema')
        other = replace(SETTINGS, model='another')
        with patch.object(llm, '_request_completion_once', return_value=response().json()) as request:
            llm._request_completion(other, '', [], on_delta=None)
        self.assertEqual(request.call_args.kwargs['json_format']['type'], 'json_object')

    def test_explicit_rejections_reach_text_once_and_keep_local_validation(self):
        result, session = self.complete([response(400), response(422), response()])
        self.assertEqual(result, GROUPS)
        self.assertEqual(session.post.call_count, 3)
        self.assertNotIn('response_format', session.post.call_args.kwargs['json'])
        _, cached = self.complete([response()])
        self.assertNotIn('response_format', cached.post.call_args.kwargs['json'])

    def test_auth_and_unrelated_bad_requests_never_downgrade(self):
        for status, message in [(401, 'unsupported response_format'), (403, 'invalid json_schema'), (400, 'model not found'), (422, 'invalid messages')]:
            with self.subTest(status=status, message=message):
                with patch.object(llm, '_request_completion_once', side_effect=llm.LlmClientError(message, status_code=status)) as request:
                    with self.assertRaises(llm.LlmClientError):
                        llm._request_completion(SETTINGS, '', [], on_delta=None)
                request.assert_called_once()

    def test_cancel_before_fallback_prevents_second_request(self):
        class Cancelled(Exception):
            pass
        wait = Mock(side_effect=Cancelled)
        with self.assertRaises(Cancelled):
            self.complete([response(400)], retry_wait=wait)
        wait.assert_called_once_with(0)

    def test_closed_thinking_and_fences_strip_only_before_answer(self):
        result, session = self.complete([response(content='<think>consider {"wrong":true}</think>\n```json\n' + json.dumps(GROUPS) + '\n```')])
        self.assertEqual(result, GROUPS)
        session.post.assert_called_once()
        self.assertEqual(llm._strip_json_fence('<think>{"groups":[]}'), '')
        with self.assertRaises(json.JSONDecodeError):
            llm._loads_with_trailing_repair('{"groups":[{"text":"unfinished')

    def test_tail_repair_does_not_change_text_or_accept_mid_content_damage(self):
        valid = json.dumps(GROUPS)
        for value in [valid[:-2], valid[:-1] + ',}', valid[:-1] + ',']:
            self.assertEqual(llm._loads_with_trailing_repair(value), GROUPS)
        for value in ['{,}', '[,]', '{"groups":[}', '{"groups":', '{"x":1,,}', valid + valid]:
            with self.subTest(value=value), self.assertRaises(json.JSONDecodeError):
                llm._loads_with_trailing_repair(value)

    def test_streaming_uses_same_negotiation_and_final_parser(self):
        accepted = response()
        accepted.iter_lines.return_value = [
            ('data: ' + json.dumps({'choices': [{'delta': {'content': text}}]})).encode()
            for text in ['<thi', 'nk>analysis</think>', json.dumps(GROUPS)]
        ] + [b'data: [DONE]']
        delta = Mock()
        result, _ = self.complete([response(400), accepted], on_delta=delta)
        self.assertEqual(result, GROUPS)
        self.assertEqual(delta.call_args_list[0].args, ('reset', ''))
        accepted.close.assert_called_once()

    def test_key_policy_accepts_only_custom_valid_loopback(self):
        for url in ['http://127.0.0.1:1234/v1', 'http://localhost/v1', 'https://[::1]/v1']:
            self.assertFalse(llm.postprocess_api_key_required('custom', url))
            self.assertTrue(llm.postprocess_api_key_required('deepseek', url))
        for url in ['http://192.168.1.2/v1', 'https://example.test/v1', 'localhost:1234', 'http://localhost:bad', 'http://localhost@evil.test', 'http://localhost/?token=x']:
            self.assertTrue(llm.postprocess_api_key_required('custom', url))

    def test_editor_save_resolve_and_payload_support_keyless_local_only(self):
        payload = {'providerId': 'custom', 'baseUrl': SETTINGS.base_url, 'model': SETTINGS.model}
        save_settings(self.env, payload)
        self.assertEqual(resolve_settings(self.env, payload).api_key, '')
        local = next(p for p in provider_payloads(self.env)['providers'] if p['id'] == 'custom')
        self.assertFalse(local['requiresApiKey'])
        self.assertFalse(local['hasApiKey'])
        with self.assertRaisesRegex(ValueError, 'API Key'):
            resolve_settings(self.env, {**payload, 'baseUrl': 'https://example.test/v1'})

    def test_launcher_test_catalog_run_and_pipeline_share_key_policy(self):
        api = LauncherApi(paths=LauncherPaths(root=self.root, env_path=self.env, launcher_html=self.root/'launcher.html', recent_metadata=self.root/'recent.json', project_registry=self.root/'registry.json'), window_getter=lambda: None)
        payload = {'providerId': 'custom', 'baseUrl': SETTINGS.base_url, 'model': SETTINGS.model, 'save': True}
        with patch('maw.gui_web.test_llm_connection'), patch('maw.gui_web.list_llm_models', return_value=['local-test']), patch('maw.gui_web.process_llm_postprocess', return_value=SimpleNamespace()):
            result = api.test_postprocess_connection(payload)
            self.assertTrue(result['ok'], result)
            self.assertFalse(result['requiresApiKey'])
            self.assertTrue(api.get_postprocess_models(payload)['ok'])
            self.assertTrue(api.run_llm_postprocess(payload)['ok'])
            self.assertEqual(api.test_postprocess_connection({**payload, 'baseUrl':'https://example.test/v1'})['code'], 'api_key_missing')
        plan = {'enabled':True,'steps':[{'id':'translate','enabled':True,'providerId':'custom','target':'zh'}]}
        _, errors = validate_plan(plan, env_path=self.env, media_path=self.root/'synthetic.wav')
        self.assertEqual(errors, ())
        with patch('maw.postprocess_pipeline._llm_values', return_value={'apiKey':'','baseUrl':'https://example.test/v1','model':'test'}):
            _, errors = validate_plan(plan, env_path=self.env, media_path=self.root/'synthetic.wav')
        self.assertTrue(any(e['field']=='llmApiKey' for e in errors))


if __name__ == '__main__':
    unittest.main()
