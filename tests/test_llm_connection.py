"""LLM connection checks must verify generation, not just catalog/HTTP access."""
import json
import ssl
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from requests.exceptions import ConnectTimeout, HTTPError, ReadTimeout, SSLError

from maw.postprocess_llm import (
    LlmClientError, LlmSettings, _reasoning_parameters, complete_subtitle_groups,
    list_llm_models, reasoning_capabilities, test_llm_connection as check_connection,
)


GOOGLE = "https://generativelanguage.googleapis.com/v1beta/openai/"


def settings(model="models/gemini-3.8-flash", mode="off", url=GOOGLE):
    return LlmSettings("custom", "test-only-secret", url, model, mode)


def session_for(body=None):
    session = mock.MagicMock()
    session.__enter__.return_value = session
    session.post.return_value.json.return_value = body or {"choices": [{"message": {"content": "OK"}}]}
    session.post.return_value.headers = {"Content-Type": "application/json"}
    return session


class GeminiConnectionTests(unittest.TestCase):
    def test_step_reasoning_choices_match_supported_requests(self):
        self.assertEqual(reasoning_capabilities(settings())["modes"], ["auto", "low", "medium", "high"])
        self.assertEqual(_reasoning_parameters(settings("gemini-3.6-flash", "off")), {"reasoning_effort": "minimal"})
        self.assertEqual(reasoning_capabilities(settings("gemini-3-pro-preview"))["modes"], ["auto", "low", "high"])
        for mode, expected in (("off", "low"), ("low", "low"), ("medium", "high"), ("high", "high"), ("max", "max")):
            value = LlmSettings("zhipu", "test", "https://open.bigmodel.cn/api/paas/v4", "glm-5.3-flash", mode)
            self.assertEqual(reasoning_capabilities(value)["modes"], ["auto", "low", "high", "max"])
            self.assertEqual(_reasoning_parameters(value), {"thinking": {"type": "enabled"}, "reasoning_effort": expected})
        self.assertEqual(reasoning_capabilities(settings("unknown", url="https://unknown.test/v1"))["modes"], ["auto"])

    def test_official_catalog_normalizes_and_deduplicates_resource_names_only(self):
        session = session_for()
        session.get.return_value.json.return_value = {"data": [
            {"id": "models/gemini-3.8-flash"}, {"id": "gemini-3.8-flash"},
            {"id": "models/gemini-2.5-pro"},
        ]}
        with mock.patch("maw.postprocess_llm.requests.Session", return_value=session):
            self.assertEqual(list_llm_models(settings()), ["gemini-3.8-flash", "gemini-2.5-pro"])
            self.assertEqual(len(list_llm_models(settings(url="https://proxy.example/v1"))), 3)

    def test_test_and_completion_use_same_google_model_and_reasoning(self):
        session = session_for()
        # A provider taking 45 seconds to prepare a reply would exceed the old
        # 30-second read deadline. Check the configured deadline without sleep.
        def respond(*args, **kwargs):
            if kwargs["timeout"][1] < 45:
                raise ReadTimeout("simulated delayed first response")
            return session.post.return_value
        session.post.side_effect = respond
        with mock.patch("maw.postprocess_llm.requests.Session", return_value=session):
            check_connection(settings())
            payload = session.post.call_args.kwargs["json"]
            self.assertEqual(payload["model"], "gemini-3.8-flash")
            self.assertEqual(payload["reasoning_effort"], "low")
            self.assertEqual(payload["max_tokens"], 4096)
            self.assertTrue(payload["stream"])
            self.assertTrue(session.post.call_args.kwargs["stream"])
            self.assertEqual(session.post.call_args.kwargs["timeout"], (10, 90))
            session.post.return_value.json.return_value = {"choices": [{"message": {
                "content": json.dumps({"groups": [{"source_ids": ["c1"], "text": "你好"}]})
            }}]}
            result = complete_subtitle_groups(settings(), "Return JSON.", [{"id": "c1", "text": "Hello"}])
            self.assertEqual(result["groups"][0]["text"], "你好")
            full = session.post.call_args.kwargs["json"]
            self.assertEqual(full["model"], payload["model"])
            self.assertEqual(full["reasoning_effort"], payload["reasoning_effort"])
            self.assertNotIn("temperature", full)

    def test_reasoning_explicit_levels_auto_and_older_models(self):
        for model, mode, expected in [
            ("models/gemini-3.8-flash", "off", {"reasoning_effort": "low"}),
            ("gemini-3.8-flash", "auto", {}),
            ("gemini-3.8-flash", "medium", {"reasoning_effort": "medium"}),
            ("gemini-3.8-flash", "high", {"reasoning_effort": "high"}),
            ("gemini-2.5-pro", "off", {"reasoning_effort": "low"}),
            ("gemini-2.5-flash", "off", {"reasoning_effort": "none"}),
            ("gemini-2.0-flash", "off", {}),
        ]:
            with self.subTest(model=model, mode=mode):
                self.assertEqual(_reasoning_parameters(settings(model, mode)), expected)
        for url in ["https://proxy.example/v1", "https://generativelanguage.googleapis.com.example/v1"]:
            session = session_for()
            with mock.patch("maw.postprocess_llm.requests.Session", return_value=session):
                check_connection(settings(url=url))
            payload = session.post.call_args.kwargs["json"]
            self.assertEqual(payload["model"], "models/gemini-3.8-flash")
            self.assertNotIn("reasoning_effort", payload)

    def test_timeouts_are_distinguished_redacted_and_not_retried(self):
        for exception, category in [(ReadTimeout, "response_headers_timeout"), (ConnectTimeout, "connect_timeout")]:
            with self.subTest(category=category):
                session = session_for()
                session.post.side_effect = exception("https://private.example?key=test-only-secret")
                with mock.patch("maw.postprocess_llm.requests.Session", return_value=session):
                    with self.assertRaises(LlmClientError) as caught:
                        check_connection(settings())
                self.assertEqual(caught.exception.category, category)
                self.assertNotIn("private.example", str(caught.exception))
                self.assertNotIn("test-only-secret", str(caught.exception))
                session.post.assert_called_once()

    def test_tls_eof_and_certificate_failures_are_safe_and_not_retried(self):
        for cause, category in [
            (ssl.SSLEOFError(8, "[SSL: UNEXPECTED_EOF_WHILE_READING] private.example test-only-secret"), "tls_eof"),
            (ssl.SSLCertVerificationError(1, "certificate verify failed test-only-secret"), "tls_error"),
        ]:
            with self.subTest(category=category):
                session = session_for()
                session.post.side_effect = SSLError(cause)
                with mock.patch("maw.postprocess_llm.requests.Session", return_value=session):
                    with self.assertRaises(LlmClientError) as caught:
                        check_connection(settings())
                self.assertEqual(caught.exception.category, category)
                self.assertNotIn("test-only-secret", str(caught.exception))
                self.assertNotIn("private.example", str(caught.exception))
                session.post.assert_called_once()
                self.assertNotIn("verify", session.post.call_args.kwargs)

    def test_503_reports_response_without_claiming_google_or_network_cause(self):
        for body in [{}, {"error": {"code": 503, "status": "UNAVAILABLE", "message": "Model busy test-only-secret"}}]:
            with self.subTest(body=body):
                session = session_for(body)
                response = session.post.return_value
                response.status_code = 503
                response.json.return_value = body
                response.raise_for_status.side_effect = HTTPError("503 Service Unavailable")
                with mock.patch("maw.postprocess_llm.requests.Session", return_value=session):
                    with self.assertRaises(LlmClientError) as caught:
                        check_connection(settings())
                error = caught.exception
                self.assertEqual(error.status_code, 503)
                self.assertEqual(error.category, "provider_response")
                self.assertIn("intermediary gateway", str(error))
                self.assertNotIn("not a network outage", str(error))
                self.assertNotIn("test-only-secret", str(error))
                self.assertEqual(bool(error.diagnostic), bool(body))
                if body:
                    self.assertIn("status=UNAVAILABLE", error.diagnostic)
                session.post.assert_called_once()
                response.close.assert_called_once()

    def test_stream_requires_actual_text_not_thinking_or_http_success(self):
        for lines, category in [
            ([b'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}', b'data: [DONE]'], "empty_response"),
            ([b'data: {"error":{"message":"quota exceeded"}}'], "provider_response"),
            ([b'data: invalid json'], "protocol"),
        ]:
            with self.subTest(category=category):
                session = session_for()
                session.post.return_value.headers = {"Content-Type": "text/event-stream; charset=utf-8"}
                session.post.return_value.iter_lines.return_value = lines
                with mock.patch("maw.postprocess_llm.requests.Session", return_value=session):
                    with self.assertRaises(LlmClientError) as caught:
                        check_connection(settings())
                self.assertEqual(caught.exception.category, category)
                session.post.return_value.close.assert_called_once()
                session.post.assert_called_once()

    def test_real_stream_first_text_returns_without_waiting_for_buffer_or_close(self):
        calls = []
        release = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            mode = "ok"
            protocol_version = "HTTP/1.1"
            def log_message(self, *_args):
                pass
            def do_POST(self):
                calls.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                mode = self.mode
                if mode == "headers_timeout":
                    release.wait(1)
                    self.close_connection = True
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                # Deliberately shorter than requests' default 512-byte buffer,
                # with no [DONE] and no socket close until the check returns.
                if mode == "ok":
                    self.wfile.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n'.encode())
                    self.wfile.flush()
                release.wait(1)
                self.close_connection = True
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        endpoint = f"http://127.0.0.1:{server.server_port}/v1/chat/completions"
        try:
            # Only reroute transport to localhost; keep real Gemini payload,
            # response parsing, and requests/urllib3 timeout behavior.
            with mock.patch("maw.postprocess_llm._chat_endpoint", return_value=endpoint), \
                 mock.patch("maw.postprocess_llm.CONNECTION_TEST_READ_TIMEOUT", 0.15):
                check_connection(settings())
                for mode, category in [("body_timeout", "response_body_timeout"), ("headers_timeout", "response_headers_timeout")]:
                    Handler.mode = mode
                    with self.assertRaises(LlmClientError) as caught:
                        check_connection(settings())
                    self.assertEqual(caught.exception.category, category)
            self.assertEqual(len(calls), 3)
            self.assertTrue(all(call["stream"] for call in calls))
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_http_200_is_not_success_without_text(self):
        for body, category in [
            ({"choices": [{"message": {"content": " "}}]}, "empty_response"),
            ({"choices": [{"message": {"content": None}, "finish_reason": "length"}]}, "empty_response"),
            ({"choices": []}, "protocol"), ({"models": []}, "protocol"),
        ]:
            with self.subTest(body=body):
                session = session_for(body)
                with mock.patch("maw.postprocess_llm.requests.Session", return_value=session):
                    with self.assertRaises(LlmClientError) as caught:
                        check_connection(settings())
                self.assertEqual(caught.exception.category, category)
                session.post.assert_called_once()

    def test_real_local_http_catalog_and_generation_and_timeout(self):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            mode = "ok"
            def log_message(self, *_args):
                pass
            def do_GET(self):
                self.reply({"data": [{"id": "test-model"}]})
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append(payload)
                if self.mode == "timeout":
                    time.sleep(0.15)
                if self.mode == "html":
                    self.reply(b"<html>Not a chat endpoint</html>")
                else:
                    self.reply({"choices": [{"message": {"content": "OK" if self.mode == "ok" else ""}}]})
            def reply(self, body):
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        local = settings("test-model", url=f"http://127.0.0.1:{server.server_port}/v1")
        try:
            self.assertEqual(list_llm_models(local), ["test-model"])
            check_connection(local)
            for mode, category in [("empty", "empty_response"), ("html", "protocol"), ("timeout", "read_timeout")]:
                Handler.mode = mode
                with mock.patch("maw.postprocess_llm.CONNECTION_TEST_READ_TIMEOUT", 0.05):
                    with self.assertRaises(LlmClientError) as caught:
                        check_connection(local)
                self.assertEqual(caught.exception.category, category)
            self.assertEqual(len(calls), 4)  # No hidden retry, even on read timeout.
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
