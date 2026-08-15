import io
import json
import os
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

import fetch_predicted_points as fetcher


class Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def http_error(code, headers=None):
    return HTTPError("https://example.test", code, "error", headers or {}, io.BytesIO(b"error"))


def json_http_error(code, payload):
    return HTTPError(
        "https://example.test",
        code,
        "error",
        {},
        io.BytesIO(json.dumps(payload).encode("utf-8")),
    )


class RequestJsonTests(unittest.TestCase):
    def test_missing_credentials_fail_before_request(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "No credentials found"):
                fetcher.get_token(None, None, 1)

    def test_authentication_errors_are_not_retried(self):
        for status in (401, 403):
            with self.subTest(status=status):
                opener = Mock()
                opener.open.side_effect = http_error(status)
                with self.assertRaisesRegex(RuntimeError, "authentication failed"):
                    fetcher.request_json("https://example.test", {}, 1, opener=opener, sleep=Mock())
                self.assertEqual(opener.open.call_count, 1)

    def test_prediction_auth_error_explains_credential_rotation(self):
        opener = Mock()
        opener.open.side_effect = json_http_error(
            400,
            {"error": {"code": "PREDICTIONS_REQUIRE_AUTH", "message": "authentication required"}},
        )
        with self.assertRaisesRegex(RuntimeError, "invalid or expired"):
            fetcher.request_json("https://example.test", {}, 1, opener=opener, sleep=Mock())
        self.assertEqual(opener.open.call_count, 1)

    def test_configured_token_is_used_without_a_session_cookie(self):
        with patch.dict(os.environ, {"FFH_TOKEN": "working-token"}, clear=True):
            with patch.object(fetcher, "request_json") as request:
                token = fetcher.get_token(None, None, 1)
        self.assertEqual(token, "working-token")
        request.assert_not_called()

    def test_rate_limit_retries_then_succeeds(self):
        opener = Mock()
        opener.open.side_effect = [http_error(429, {"Retry-After": "0"}), Response({"data": []})]
        sleep = Mock()
        self.assertEqual(fetcher.request_json("https://example.test", {}, 1, opener=opener, sleep=sleep), {"data": []})
        self.assertEqual(opener.open.call_count, 2)
        sleep.assert_called_once_with(0.0)

    def test_server_error_retries_then_succeeds(self):
        opener = Mock()
        opener.open.side_effect = [http_error(503), Response({"data": []})]
        self.assertEqual(fetcher.request_json("https://example.test", {}, 1, opener=opener, sleep=Mock()), {"data": []})
        self.assertEqual(opener.open.call_count, 2)

    def test_network_failure_exhausts_bounded_retries(self):
        opener = Mock()
        opener.open.side_effect = URLError("timed out")
        with self.assertRaisesRegex(RuntimeError, "after 3 attempts"):
            fetcher.request_json("https://example.test", {}, 1, opener=opener, max_attempts=3, sleep=Mock())
        self.assertEqual(opener.open.call_count, 3)

    def test_malformed_json_is_fatal(self):
        response = Response({})
        response.read = Mock(return_value=b"not-json")
        opener = Mock()
        opener.open.return_value = response
        with self.assertRaisesRegex(RuntimeError, "invalid JSON"):
            fetcher.request_json("https://example.test", {}, 1, opener=opener, sleep=Mock())
        self.assertEqual(opener.open.call_count, 1)


if __name__ == "__main__":
    unittest.main()
