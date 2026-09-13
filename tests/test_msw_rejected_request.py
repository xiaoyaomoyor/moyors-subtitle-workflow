"""Rejected POSTs keep 403 readable without waiting on an upload body."""

import io
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from maw.msw.api import ProcessingAPI


class RejectedRequestTests(unittest.TestCase):
    def reject(self, length, stream=None, extra=None):
        api = object.__new__(ProcessingAPI)
        api.authorize = Mock(side_effect=PermissionError("denied"))
        connection = Mock()
        connection.gettimeout.return_value = None
        handler = SimpleNamespace(
            path="/api/msw/providers",
            headers={"Content-Length": str(length), **(extra or {})},
            connection=connection,
            rfile=stream or io.BytesIO(b"{}"),
            send_json=Mock(),
            close_connection=False,
        )
        self.assertTrue(api.handle(handler, post=True))
        self.assertEqual(handler.send_json.call_args.args[0], 403)
        self.assertTrue(handler.close_connection)
        return handler

    def test_small_rejected_body_is_drained_with_timeout_restored(self):
        handler = self.reject(2)
        self.assertEqual(handler.rfile.tell(), 2)
        self.assertEqual(
            [call.args for call in handler.connection.settimeout.call_args_list],
            [(0.25,), (None,)],
        )

    def test_large_invalid_or_chunked_body_is_not_read(self):
        for length, extra in [
            (65537, None),
            (-1, None),
            ("bad", None),
            (2, {"Transfer-Encoding": "chunked"}),
        ]:
            with self.subTest(length=length, extra=extra):
                handler = self.reject(length, extra=extra)
                self.assertEqual(handler.rfile.tell(), 0)
                handler.connection.settimeout.assert_not_called()

    def test_slow_body_still_returns_forbidden(self):
        stream = Mock()
        stream.read1.side_effect = TimeoutError()
        handler = self.reject(2, stream)
        handler.connection.settimeout.assert_called_with(None)
