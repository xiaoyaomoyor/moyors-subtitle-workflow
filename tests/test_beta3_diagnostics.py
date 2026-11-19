"""Quiet successful polling and actionable resegmentation failures."""
import copy
import unittest
from unittest.mock import Mock, patch

from test_local_editor_server import server_editor
from maw.postprocess import LlmPostprocessRequest, OutputMode, PostprocessStepError, process_llm_snapshot


class PollLoggingTests(unittest.TestCase):
    def handler(self, path, method='GET'):
        handler = object.__new__(server_editor.EditorRequestHandler)
        handler.path, handler.command = path, method
        handler.requestline = f'{method} {path} HTTP/1.1'
        handler.log_message = Mock()
        return handler

    def test_successful_polling_only_is_quiet(self):
        for path in ['/api/waveform', '/api/msw/jobs?project_id=synthetic', '/api/msw/audio-exports',
                     '/api/msw/media-analysis', '/api/msw/asr-local-models', '/api/msw/yukkuri-runtime',
                     '/api/msw/qwen-voice-jobs/synthetic']:
            for code in [200, 204, '304']:
                with self.subTest(path=path, code=code):
                    handler = self.handler(path)
                    handler.log_request(code)
                    handler.log_message.assert_not_called()

    def test_failures_writes_results_and_unknown_routes_remain_logged(self):
        for path, method, code in [('/api/msw/jobs', 'GET', 401), ('/api/waveform', 'GET', 500),
                                  ('/api/msw/jobs', 'POST', 200), ('/api/msw/project', 'POST', 200),
                                  ('/api/msw/jobs/id/result', 'GET', 200), ('/api/msw/unknown', 'GET', 200),
                                  ('/api/msw/qwen-voice-jobs/id/result', 'GET', 200), ('/', 'GET', 200)]:
            with self.subTest(path=path, method=method, code=code):
                handler = self.handler(path, method)
                handler.log_request(code)
                handler.log_message.assert_called_once()


class ResegmentDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.source = {'segments': [
            {'id':'cue-first','start':1000,'end':2000,'text':'PRIVATE BODY ONE'},
            {'id':'cue-second','start':3000,'end':4000,'text':'PRIVATE BODY TWO'}]}
        self.before = copy.deepcopy(self.source)
        self.request = LlmPostprocessRequest(None, None, OutputMode.JSON, 'resegment', '')

    def assert_location(self, error, stage):
        message = str(error)
        self.assertIn(f'「{stage}」', message)
        self.assertIn('处理范围第', message)
        self.assertIn('cue-', message)
        self.assertIn('00:00:0', message)
        self.assertNotIn('PRIVATE BODY', message)
        self.assertNotIn('PRIVATE MODEL', message)
        self.assertEqual(self.source, self.before)

    def test_provider_failure_keeps_category_and_locates_the_actual_batch(self):
        def complete(_, cues):
            if cues[0]['id'] == 'c0002':
                raise PostprocessStepError('network failure', category='network', status_code=503, diagnostic='retry later')
            return {'groups':[{'atom_ids':[a['id'] for c in cues for a in c['items']]}]}
        with patch('maw.postprocess._llm_batches', side_effect=lambda cues:[[cue] for cue in cues]):
            with self.assertRaises(PostprocessStepError) as caught:
                process_llm_snapshot(self.source, self.request, complete=complete)
        self.assert_location(caught.exception, '模型调用')
        self.assertIn('第 2/2 批', str(caught.exception))
        self.assertIn('第 2–2 条', str(caught.exception))
        self.assertEqual(caught.exception.category, 'network')
        self.assertEqual(caught.exception.status_code, 503)

    def test_invalid_protocol_and_coverage_add_context_without_body_dumps(self):
        for response in [[], {'groups':[{'id':'c0001','text':'PRIVATE MODEL REWRITE'}]},
                         {'groups':[{'atom_ids':['unknown']}]}]:
            with self.subTest(response=response), self.assertRaises(ValueError) as caught:
                process_llm_snapshot(self.source, self.request, complete=lambda *_:response)
            self.assert_location(caught.exception, '结果校验')

    def test_reconstruction_failure_has_location_and_never_mutates_source(self):
        # Boundary protection normally prevents unsafe reconstruction. Inject
        # a local failure after valid model output to verify this error surface.
        with patch('maw.postprocess._apply_llm_atom_groups_with_warnings', side_effect=ValueError('invalid local boundary')), self.assertRaises(ValueError) as caught:
            process_llm_snapshot(self.source, self.request, complete=lambda _, cues:
                {'groups':[{'atom_ids':[a['id'] for c in cues for a in c['items']]}]})
        self.assert_location(caught.exception, '重建字幕')
