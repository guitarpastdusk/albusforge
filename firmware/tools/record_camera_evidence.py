#!/usr/bin/env python3
"""Privately record native camera health and snapshot metadata, never photographs.

Local observations alone do not certify cloud receipts or physical acceptance.
"""
import argparse
import hashlib
import http.client
import ipaddress
import json
import math
import os
import signal
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request


ERRORS = {"none", "capture_failed", "sd_unavailable", "payload_corrupt", "frame_rejected",
          "auth_paused", "ack_mismatch_or_retry", "network_error"}
BOOLEANS = ("clock_ready", "storage_ready", "upload_paused")
COUNTERS = ("queued_count", "queued_bytes", "last_capture", "last_successful_upload", "last_http_status",
            "dropped", "corrupt", "quarantined", "quarantine_dropped")


def local_origin(value):
    parsed = urllib.parse.urlsplit(value)
    try:
        address = ipaddress.ip_address(parsed.hostname or "")
        port = parsed.port
    except ValueError as error:
        raise ValueError("Use an explicit loopback or RFC1918 LAN IP address") from error
    networks = (ipaddress.ip_network("10.0.0.0/8"), ipaddress.ip_network("172.16.0.0/12"), ipaddress.ip_network("192.168.0.0/16"))
    allowed = address.is_loopback or any(address in network for network in networks)
    if parsed.scheme != "http" or not allowed or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment or (port is not None and not 1 <= port <= 65535):
        raise ValueError("Use an explicit local HTTP origin without credentials, path or query")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def read_local(origin, path, maximum, timeout=10):
    # urllib's socket timeout only limits inactivity. A slow-drip header or
    # chunk delimiter can otherwise keep a request alive indefinitely. This
    # command runs on the main thread on macOS/Linux; SIGALRM supplies the
    # independent total deadline, including response headers and framing.
    if not hasattr(signal, "setitimer") or signal.getitimer(signal.ITIMER_REAL)[0]:
        raise ValueError("A dedicated macOS/Linux recorder process is required")
    def timed_out(_signum, _frame):
        raise TimeoutError("Local response deadline exceeded")
    previous = signal.signal(signal.SIGALRM, timed_out)
    signal.setitimer(signal.ITIMER_REAL, timeout)
    try:
        return _read_local(origin, path, maximum, timeout)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _read_local(origin, path, maximum, timeout):
    # Ignore environment proxy settings: private camera data never reaches a proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    deadline = time.monotonic() + timeout
    with opener.open(origin + path, timeout=timeout) as response:
        if response.status != 200:
            raise ValueError("Unexpected local HTTP status")
        chunks, size = [], 0
        while True:
            if time.monotonic() >= deadline:
                raise ValueError("Local response deadline exceeded")
            chunk = response.read1(min(65536, maximum + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > maximum:
                raise ValueError("Local response exceeds its bound")
        return b"".join(chunks)


def checked_health(value):
    if not isinstance(value, dict):
        raise ValueError("Invalid health response")
    result = {}
    for name in BOOLEANS:
        if type(value.get(name)) is not bool:
            raise ValueError("Invalid health boolean")
        result[name] = value[name]
    for name in COUNTERS:
        v = value.get(name)
        if type(v) is not int or not 0 <= v <= 253402300799:
            raise ValueError("Invalid health counter")
        result[name] = v
    if result["last_http_status"] > 599 or result["queued_bytes"] > 64 * 1024 * 1024 or result["queued_count"] > 672:
        raise ValueError("Health exceeds the native profile")
    error = value.get("last_error")
    result["last_error"] = error if isinstance(error, str) and error in ERRORS else "unrecognized"
    return result


def sample(origin, elapsed, wall_time):
    observation = {"elapsed_s": elapsed, "observed_at": wall_time}
    try:
        observation["health"] = checked_health(json.loads(read_local(origin, "/health", 16384)))
    except (ValueError, OSError, urllib.error.URLError, http.client.HTTPException, RecursionError):
        observation["health_error"] = "unavailable_or_invalid"
    try:
        picture = read_local(origin, "/snapshot", 1048576)
        if len(picture) < 4 or picture[:2] != b"\xff\xd8" or picture[-2:] != b"\xff\xd9":
            raise ValueError("Invalid snapshot envelope")
        observation["snapshot"] = {"bytes": len(picture), "sha256": hashlib.sha256(picture).hexdigest()}
        del picture  # Deliberately never persisted; this is not an image archive.
    except (ValueError, OSError, urllib.error.URLError, http.client.HTTPException):
        observation["snapshot_error"] = "unavailable_or_invalid"
    return observation


def summarize(samples, elapsed, started_at):
    healthy = [item for item in samples if "health" in item]
    captures = []
    for item in healthy:
        captured = item["health"]["last_capture"]
        # An integer-second timestamp at/before startup may predate this run.
        # Future device timestamps are not evidence of an observed capture.
        if started_at < captured <= item["observed_at"] and (not captures or captured != captures[-1]):
            captures.append(captured)
    intervals = [later - earlier for earlier, later in zip(captures, captures[1:])]
    cadence_matches = bool(intervals) and all(895 <= value <= 905 for value in intervals)
    full_duration = elapsed >= 86400
    gaps = [later["elapsed_s"] - earlier["elapsed_s"] for earlier, later in zip(samples, samples[1:])]
    edges_covered = bool(samples) and 0 <= samples[0]["elapsed_s"] <= 65 and 0 <= elapsed - samples[-1]["elapsed_s"] <= 65
    uninterrupted = edges_covered and all("health" in item for item in samples) and all(0 <= gap <= 65 for gap in gaps)
    verdict = "insufficient_elapsed_time_or_observations"
    if intervals and not cadence_matches:
        verdict = "deviation_or_missed_observation"
    elif full_duration and len(captures) >= 96 and cadence_matches and uninterrupted:
        verdict = "local_capture_cadence_matches_15_minutes"
    queue = [item["health"]["queued_count"] for item in healthy]
    uploads = [item["health"]["last_successful_upload"] for item in healthy]
    upload_transitions = 0
    upload_high_water = uploads[0] if uploads else 0
    for item in healthy[1:]:
        uploaded = item["health"]["last_successful_upload"]
        if uploaded > upload_high_water and started_at < uploaded <= item["observed_at"]:
            upload_transitions += 1
        upload_high_water = max(upload_high_water, uploaded)
    loss_increases = {}
    resets = False
    for name in ("dropped", "corrupt", "quarantine_dropped"):
        values = [item["health"][name] for item in healthy]
        loss_increases[name] = sum(max(0, later - earlier) for earlier, later in zip(values, values[1:]))
        resets |= any(later < earlier for earlier, later in zip(values, values[1:]))
    for name in ("last_capture", "last_successful_upload"):
        values = [item["health"][name] for item in healthy]
        resets |= any(later < earlier for earlier, later in zip(values, values[1:]))
    if resets:
        verdict = "counter_or_clock_reset_requires_review"
    return {"elapsed_s": elapsed, "completed_24h": full_duration, "polls": len(samples),
            "health_polls_ok": len(healthy), "snapshot_polls_ok": sum("snapshot" in item for item in samples),
            "distinct_capture_transitions_observed": len(captures), "capture_intervals_s": intervals,
            "cadence_evidence": verdict, "maximum_poll_gap_s": max(gaps, default=0),
            "minimum_upload_transitions_observed": upload_transitions,
            "maximum_queue_count": max(queue, default=0), "final_queue_count": queue[-1] if queue else None,
            "queue_decrease_with_upload_observed": any(b < a and v > u for a, b, u, v in zip(queue, queue[1:], uploads, uploads[1:])),
            "loss_counter_increases": loss_increases, "counter_reset_observed": resets,
            "cloud_receipt_verification": "required_separately; local polling can miss catch-up uploads",
            "physical_acceptance": "not_certified_by_this_recorder"}


def private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def record(origin, output, duration, interval):
    origin = local_origin(origin)
    if not 1 <= interval <= 60 or not math.isfinite(duration) or not 0 < duration <= 7 * 86400:
        raise ValueError("Polling must be every 1–60 seconds for a positive duration")
    output = Path(output).resolve()
    repository = Path(__file__).resolve().parents[2]
    if output == repository or repository in output.parents:
        raise ValueError("Keep private evidence outside the repository")
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    started = time.monotonic()
    started_at = time.time()
    observations = []
    private_json(output / "run.json", {"schema_version": 1, "origin": origin, "started_at": started_at,
        "requested_duration_s": duration, "poll_interval_s": interval,
        "recorder_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
    descriptor = os.open(output / "observations.jsonl", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    interrupted = False
    with os.fdopen(descriptor, "w") as stream:
        try:
            while True:
                poll_start = time.monotonic()
                if poll_start - started >= duration:
                    break
                current = sample(origin, poll_start - started, time.time())
                observations.append(current)
                stream.write(json.dumps(current, separators=(",", ":")) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
                summary = summarize(observations, time.monotonic() - started, started_at)
                private_json(output / "summary.json", summary)
                remaining = min(interval - (time.monotonic() - poll_start), duration - (time.monotonic() - started))
                if remaining > 0:
                    time.sleep(remaining)
        except KeyboardInterrupt:
            interrupted = True
    summary = summarize(observations, time.monotonic() - started, started_at)
    summary["interrupted"] = interrupted
    private_json(output / "summary.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True, help="Explicit local IP, e.g. http://192.168.1.241")
    parser.add_argument("--output", type=Path, required=True, help="New private directory outside the repository")
    parser.add_argument("--hours", type=float, default=24)
    parser.add_argument("--interval", type=float, default=30)
    args = parser.parse_args()
    print(json.dumps(record(args.origin, args.output, args.hours * 3600, args.interval), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError):
        raise SystemExit("Evidence recording failed. Check the explicit local address and new private output directory.")
