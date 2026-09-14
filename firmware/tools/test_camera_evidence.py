import importlib.util
import json
import http.client
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("camera_evidence", Path(__file__).with_name("record_camera_evidence.py"))
recorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recorder)


def health(**overrides):
    value = {"clock_ready": True, "storage_ready": True, "upload_paused": False,
             "queued_count": 0, "queued_bytes": 0, "last_capture": 1700000000,
             "last_successful_upload": 1700000000, "last_http_status": 201,
             "dropped": 0, "corrupt": 0, "quarantined": 0, "quarantine_dropped": 0,
             "last_error": "none"}
    value.update(overrides)
    return value


def full_day_samples():
    # The first capture belongs to the preceding run; the next occurs one
    # second after startup. Polling then observes 96 actual in-run timestamps.
    return [{"elapsed_s": i * 30, "observed_at": 1700000000 + i * 30,
             "health": health(last_capture=1700000000 - 899 + ((i * 30 + 899) // 900) * 900)}
            for i in range(2880)]


class EvidenceRecorder(unittest.TestCase):
    def test_only_explicit_local_addresses_are_allowed(self):
        for origin in ["http://127.0.0.1:8080", "http://192.168.4.1", "http://10.1.2.3"]:
            self.assertEqual(recorder.local_origin(origin), origin)
        for origin in ["http://8.8.8.8", "http://camera.local", "https://192.168.4.1", "http://user:secret@192.168.4.1", "http://192.168.4.1/secret", "http://192.168.4.1?token=secret"]:
            with self.assertRaises(ValueError): recorder.local_origin(origin)

    def test_no_24_hour_claim_before_real_elapsed_time(self):
        samples = full_day_samples()
        short = recorder.summarize(samples, 60, 1700000000)
        self.assertFalse(short["completed_24h"])
        self.assertNotEqual(short["cadence_evidence"], "local_capture_cadence_matches_15_minutes")
        complete = recorder.summarize(samples, 86400, 1700000000)
        self.assertEqual(complete["distinct_capture_transitions_observed"], 96)
        self.assertEqual(complete["cadence_evidence"], "local_capture_cadence_matches_15_minutes")
        self.assertEqual(complete["physical_acceptance"], "not_certified_by_this_recorder")
        self.assertIn("required_separately", complete["cloud_receipt_verification"])

    def test_preexisting_capture_is_not_counted_as_a_new_capture(self):
        samples = [{"elapsed_s": i * 30, "observed_at": 1700000000 + i * 30,
                    "health": health(last_capture=1700000000 + (i // 30) * 900)} for i in range(2880)]
        result = recorder.summarize(samples, 86400, 1700000000.5)
        self.assertEqual(result["distinct_capture_transitions_observed"], 95)
        self.assertNotEqual(result["cadence_evidence"], "local_capture_cadence_matches_15_minutes")

    def test_positive_verdict_requires_start_and_end_coverage_and_no_resets(self):
        for samples in [full_day_samples()[3:], full_day_samples()[:-3]]:
            result = recorder.summarize(samples, 86400, 1700000000)
            self.assertNotEqual(result["cadence_evidence"], "local_capture_cadence_matches_15_minutes")
        for field in ["last_capture", "last_successful_upload", "dropped"]:
            samples = full_day_samples()
            samples[100]["health"][field] = 5 if field == "dropped" else 0
            result = recorder.summarize(samples, 86400, 1700000000)
            self.assertTrue(result["counter_reset_observed"])
            self.assertEqual(result["cadence_evidence"], "counter_or_clock_reset_requires_review")

    def test_reset_does_not_count_reappearing_old_upload_as_new(self):
        samples = [{"elapsed_s": i * 30, "observed_at": 1700000000 + i * 30,
                    "health": health(last_successful_upload=value)}
                   for i, value in enumerate([1700000000, 0, 1700000000])]
        result = recorder.summarize(samples, 60, 1700000000)
        self.assertEqual(result["minimum_upload_transitions_observed"], 0)

    def test_malformed_http_is_recorded_as_failure_without_leaking_response(self):
        with patch.object(recorder, "read_local", side_effect=http.client.BadStatusLine("private response")):
            result = recorder.sample("http://127.0.0.1", 0, 1700000000)
        self.assertEqual(result["health_error"], "unavailable_or_invalid")
        self.assertEqual(result["snapshot_error"], "unavailable_or_invalid")
        self.assertNotIn("private response", json.dumps(result))

    def test_slow_drip_headers_cannot_extend_total_deadline(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                try:
                    for byte in b"HTTP/1.1 200 OK\r\nX-Slow: never-finished":
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                        time.sleep(0.03)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            def log_message(self, *_args): pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            started = time.monotonic()
            with self.assertRaises((TimeoutError, recorder.urllib.error.URLError)):
                recorder.read_local(f"http://127.0.0.1:{server.server_port}", "/health", 16384, timeout=0.15)
            self.assertLess(time.monotonic() - started, 0.8)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_redirects_and_oversized_responses_are_rejected(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/must-not-follow")
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.send_header("Content-Length", "5")
                    self.end_headers()
                    self.wfile.write(b"12345")
            def log_message(self, *_args): pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            with self.assertRaises(recorder.urllib.error.HTTPError):
                recorder.read_local(origin, "/redirect", 10)
            with self.assertRaisesRegex(ValueError, "exceeds its bound"):
                recorder.read_local(origin, "/large", 4)
            self.assertEqual(requests, ["/redirect", "/large"])
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_reports_recovery_and_counter_resets_without_inventing_upload_counts(self):
        samples = [{"elapsed_s": 0, "observed_at": 1700000000, "health": health(queued_count=3, dropped=2)},
                   {"elapsed_s": 30, "observed_at": 1700000030, "health": health(queued_count=0, dropped=0, last_successful_upload=1700000030)}]
        result = recorder.summarize(samples, 30, 1700000000)
        self.assertTrue(result["queue_decrease_with_upload_observed"])
        self.assertTrue(result["counter_reset_observed"])
        self.assertEqual(result["minimum_upload_transitions_observed"], 1)

    def test_real_loopback_polling_stores_no_picture_or_unknown_secret_fields(self):
        picture = b"\xff\xd8private-camera-pixels\xff\xd9"
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps(health(token="must-never-be-recorded")).encode() if self.path == "/health" else picture
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_args): pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                output = Path(folder) / "evidence"
                result = recorder.record(f"http://127.0.0.1:{server.server_port}", output, 0.1, 1)
                self.assertFalse(result["completed_24h"])
                self.assertEqual(result["snapshot_polls_ok"], 1)
                data = (output / "observations.jsonl").read_bytes()
                self.assertNotIn(b"private-camera-pixels", data)
                self.assertNotIn(b"must-never-be-recorded", data)
                self.assertEqual((output / "observations.jsonl").stat().st_mode & 0o777, 0o600)
                self.assertEqual(output.stat().st_mode & 0o777, 0o700)
                self.assertEqual({p.name for p in output.iterdir()}, {"summary.json", "observations.jsonl", "run.json"})
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_counter_bounds_and_unrecognized_errors_are_sanitized(self):
        self.assertEqual(recorder.checked_health(health(last_error="private text"))["last_error"], "unrecognized")
        for bad in [health(queued_count=1000), health(last_http_status=999), health(dropped=True)]:
            with self.assertRaises(ValueError): recorder.checked_health(bad)


if __name__ == "__main__":
    unittest.main()
