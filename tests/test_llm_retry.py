"""Bounded service retries and real pipeline recovery, without cloud requests."""

import json
import tempfile
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import MagicMock, Mock, patch

from requests.exceptions import HTTPError, ReadTimeout, SSLError

from maw.launcher_processing import native_project
from maw.postprocess_llm import LlmClientError, LlmSettings, complete_subtitle_groups
from maw.postprocess_pipeline import PostprocessCancelled, PostprocessPipelineError, run_postprocess_pipeline


SETTINGS = LlmSettings('custom', 'synthetic-secret', 'https://example.test/v1', 'test')
CUES = [{'id': 'c0001', 'text': 'Helo world'}]


def groups(cues):
    return {'groups': [{'id': c['id'], 'source_text': c['text'], 'text': c['text'].replace('Helo', 'Hello')} for c in cues]}


def response(status=200, content=None, diagnostic='', headers=None):
    result = Mock(status_code=status, headers=headers or {})
    if status >= 400:
        result.json.return_value = {'error': {'message': diagnostic}}
        result.raise_for_status.side_effect = HTTPError(str(status))
    else:
        result.json.return_value = {'choices': [{'message': {'content': content or json.dumps(groups(CUES))}}]}
    return result


def session_for(responses):
    session = MagicMock()
    session.__enter__.return_value = session
    session.post.side_effect = responses
    return session


class LlmRetryTests(unittest.TestCase):
    def test_transient_statuses_retry_same_request_with_increasing_wait_and_close_responses(self):
        for status in (408, 429, 500, 502, 503, 504):
            with self.subTest(status=status):
                responses = [response(status), response(status), response()]
                session = session_for(responses)
                wait, report = Mock(), Mock()
                with patch('maw.postprocess_llm.requests.Session', return_value=session), patch('maw.postprocess_llm.random.uniform', return_value=0.25):
                    result = complete_subtitle_groups(SETTINGS, 'Proofread', CUES, retry_wait=wait, on_retry=report)
                self.assertEqual(result, groups(CUES))
                self.assertEqual([c.args[0] for c in wait.call_args_list], [2.25, 4.25])
                self.assertEqual([c.args for c in report.call_args_list], [(1, 2.25, status), (2, 4.25, status)])
                self.assertTrue(all(call == session.post.call_args_list[0] for call in session.post.call_args_list))
                for item in responses:
                    item.close.assert_called_once()

    def test_retry_budget_is_shared_with_json_repair_and_preserves_error_metadata(self):
        responses = [response(503), response(503), response(content='{invalid'), response(503), response(503)]
        session = session_for(responses)
        wait = Mock()
        with patch('maw.postprocess_llm.requests.Session', return_value=session):
            with self.assertRaises(LlmClientError) as caught:
                complete_subtitle_groups(SETTINGS, 'Proofread', CUES, retry_wait=wait)
        self.assertEqual(session.post.call_count, 5)  # 2 format attempts + only 3 service retries.
        self.assertEqual(wait.call_count, 3)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.category, 'provider_response')
        self.assertIn('已重试 3 次', str(caught.exception))
        self.assertNotIn('synthetic-secret', str(caught.exception))

    def test_permanent_errors_quotas_and_ambiguous_network_failures_are_not_retried(self):
        for item in [response(code) for code in (400, 401, 402, 403, 404, 422, 501)] + [
            response(429, diagnostic='insufficient_quota synthetic-secret'),
            response(429, diagnostic='Quota exceeded per day'),
            ReadTimeout('timed out'), SSLError('certificate failed'),
        ]:
            session = session_for([item])
            wait = Mock()
            with patch('maw.postprocess_llm.requests.Session', return_value=session):
                with self.assertRaises(LlmClientError):
                    complete_subtitle_groups(SETTINGS, 'Proofread', CUES, retry_wait=wait)
            session.post.assert_called_once()
            wait.assert_not_called()

    def test_retry_after_seconds_date_invalid_and_long_delay(self):
        for header, expected in [('7', 7.0), ('Thu, 01 Jan 1970 00:16:50 GMT', 10.0), ('junk', 2.0), ('nan', 2.0)]:
            with self.subTest(header=header):
                session = session_for([response(503, headers={'Retry-After': header}), response()])
                wait = Mock()
                with patch('maw.postprocess_llm.requests.Session', return_value=session), patch('maw.postprocess_llm.time.time', return_value=1000), patch('maw.postprocess_llm.random.uniform', return_value=0):
                    complete_subtitle_groups(SETTINGS, 'Proofread', CUES, retry_wait=wait)
                wait.assert_called_once_with(expected)
        session = session_for([response(503, headers={'Retry-After': '120'})])
        wait = Mock()
        with patch('maw.postprocess_llm.requests.Session', return_value=session), self.assertRaisesRegex(LlmClientError, '超过 60 秒'):
            complete_subtitle_groups(SETTINGS, 'Proofread', CUES, retry_wait=wait)
        session.post.assert_called_once()
        wait.assert_not_called()

    def test_stream_retry_resets_display_and_closes_failed_response(self):
        failed, success = response(503), response()
        success.iter_lines.return_value = [
            ('data: ' + json.dumps({'choices': [{'delta': {'content': json.dumps(groups(CUES))}}]})).encode(),
            b'data: [DONE]',
        ]
        session = session_for([failed, success])
        delta = Mock()
        with patch('maw.postprocess_llm.requests.Session', return_value=session):
            result = complete_subtitle_groups(SETTINGS, 'Proofread', CUES, on_delta=delta, retry_wait=Mock())
        self.assertEqual(result, groups(CUES))
        self.assertEqual(delta.call_args_list[0].args, ('reset', ''))
        failed.close.assert_called_once()
        success.close.assert_called_once()

    def test_pipeline_503_exhaustion_resume_reuses_completed_batches_and_steps(self):
        # Exercise the actual HTTP client, validators, atomic checkpoints and
        # native track adapter together, not a stubbed completion function.
        for step_id in ('proofread', 'translate'):
            with self.subTest(step_id=step_id), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / 'source.mosp'
                original = native_project({'segments': [
                    {'id': f's{i}', 'start': i * 1000, 'end': i * 1000 + 900, 'text': f'Helo world {i}'} for i in range(201)
                ]})
                source.write_text(json.dumps(original), encoding='utf-8')
                env = root / 'empty.env'
                env.write_text('', encoding='utf-8')
                plan = {'enabled': True, 'retainIntermediate': False, 'outputDirectory': str(root / 'out'), 'steps': [
                    {'id': 'replace', 'enabled': True, 'conversion': 'off', 'replacements': [{'source': 'world', 'target': 'planet'}]},
                    {'id': step_id, 'enabled': True, 'providerId': 'custom', 'target': 'zh'},
                ]}
                args = dict(media_path=root / 'movie.mp4', project_path=source, srt_path=root / 'source.srt', env_path=env,
                            ffmpeg_path=None, cancel_event=Event(), llm_settings={'custom': {
                                'apiKey': SETTINGS.api_key, 'baseUrl': SETTINGS.base_url, 'model': SETTINGS.model, 'verified': '1'}})
                calls, events = [], []
                failing = True

                def post(_url, **kwargs):
                    cues = json.loads(kwargs['json']['messages'][1]['content'])
                    calls.append(cues[0]['id'])
                    if failing and cues[0]['id'] == 'c0161':
                        return response(503, diagnostic='UNAVAILABLE synthetic-secret')
                    body = groups(cues)
                    if step_id == 'translate':
                        for group in body['groups']:
                            group['text'] = '译文 ' + group['text']
                    return response(content=json.dumps(body))

                session = session_for(post)
                with patch('maw.postprocess_llm.requests.Session', return_value=session), patch.object(args['cancel_event'], 'wait', return_value=False):
                    with self.assertRaises(PostprocessPipelineError) as caught:
                        run_postprocess_pipeline(plan, **args, on_event=events.append)
                    error = caught.exception
                    self.assertEqual(error.status_code, 503, str(error))
                    self.assertEqual(error.failed_index, 1)
                    self.assertEqual(calls, ['c0001', 'c0041', 'c0081', 'c0121'] + ['c0161'] * 4)
                    cache = error.run_directory / f'{step_id if step_id == "proofread" else "translation"}-progress.json'
                    saved_cache = cache.read_text(encoding='utf-8')
                    self.assertEqual(len(json.loads(saved_cache)['batches']), 4)
                    self.assertNotIn(SETTINGS.api_key, saved_cache)
                    self.assertEqual(len([e for e in events if e['stage'] == 'llm_retry']), 3)
                    self.assertNotIn(SETTINGS.api_key, json.dumps(events))
                    manifest = json.loads((error.run_directory / 'manifest.json').read_text(encoding='utf-8'))
                    self.assertEqual([s['status'] for s in manifest['steps']], ['done', 'failed'])
                    failing = False
                    calls.clear()
                    events.clear()
                    result = run_postprocess_pipeline(plan, **args, on_event=events.append,
                        resume_directory=error.run_directory, resume_from=error.failed_index,
                        resume_project_path=error.current_project, resume_srt_path=error.current_srt)
                self.assertEqual(calls, ['c0161', 'c0201'])
                self.assertEqual([e['step'] for e in events if e['stage'] == 'step_start'], [step_id])
                saved = json.loads(result.project_path.read_text(encoding='utf-8'))
                self.assertEqual(len(saved['subtitles']['cues']), 201 if step_id == 'proofread' else 402)
                self.assertEqual(json.loads(source.read_text(encoding='utf-8')), original)

    def test_cancellation_during_retry_stops_requests_and_keeps_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mosp'
            source.write_text(json.dumps(native_project({'segments': [
                {'id': f's{i}', 'start': i * 1000, 'end': i * 1000 + 900, 'text': f'Helo world {i}'} for i in range(41)
            ]})), encoding='utf-8')
            env = root / 'empty.env'
            env.write_text('', encoding='utf-8')
            cancel, events = Event(), []

            def post(_url, **kwargs):
                cues = json.loads(kwargs['json']['messages'][1]['content'])
                return response(503) if cues[0]['id'] == 'c0041' else response(content=json.dumps(groups(cues)))

            def on_event(event):
                events.append(event)
                if event['stage'] == 'llm_retry':
                    cancel.set()

            session = session_for(post)
            with patch('maw.postprocess_llm.requests.Session', return_value=session), self.assertRaises(PostprocessCancelled):
                run_postprocess_pipeline({'enabled': True, 'steps': [{'id': 'proofread', 'enabled': True, 'providerId': 'custom'}]},
                    media_path=root / 'movie.mp4', project_path=source, srt_path=root / 'source.srt', env_path=env,
                    ffmpeg_path=None, cancel_event=cancel, on_event=on_event, llm_settings={'custom': {
                        'apiKey': 'test', 'baseUrl': SETTINGS.base_url, 'model': 'test', 'verified': '1'}})
            self.assertEqual(session.post.call_count, 2)
            self.assertEqual(events[-1]['stage'], 'cancelled')
            cache = Path(events[-1]['runDirectory']) / 'proofread-progress.json'
            self.assertEqual(len(json.loads(cache.read_text(encoding='utf-8'))['batches']), 1)


if __name__ == '__main__':
    unittest.main()
