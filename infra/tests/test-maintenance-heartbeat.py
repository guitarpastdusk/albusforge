#!/usr/bin/env python3
"""Run the exact Terraform PromQL against deterministic Prometheus histories.
Requires Docker; no cloud credentials or mutations. JSON is valid YAML.
"""
import json
import pathlib
import re
import subprocess

source = (pathlib.Path(__file__).parents[1] / "env/telemetry-health.tf").read_text()
block = source.split('resource "google_monitoring_alert_policy" "telemetry_maintenance_heartbeat"')[1]
encoded = re.search(r'query\s*=\s*("(?:\\.|[^"\\])*\")', block).group(1)
query = json.loads(encoded).replace('${google_logging_metric.telemetry_maintenance_heartbeat.name}', 'telemetry_maintenance_heartbeat')
series = '{"logging.googleapis.com/user/telemetry_maintenance_heartbeat",monitored_resource="cloud_run_job",job_name="telemetry-maintain"}'
cases = [
    {"name": "recent daily success", "input_series": [{"series": series, "values": "1 _x24"}], "eval_time": "24h", "expected": []},
    {"name": "missing past grace window", "input_series": [{"series": series, "values": "1 _x27"}], "eval_time": "27h", "expected": [{"labels": "{}", "value": 1}]},
    {"name": "zero counters are not success", "input_series": [{"series": series, "values": "0x28"}], "eval_time": "27h", "expected": [{"labels": "{}", "value": 0}]},
    {"name": "never seen is unhealthy", "input_series": [], "eval_time": "27h", "expected": [{"labels": "{}", "value": 1}]},
    {"name": "fresh recovery clears incident", "input_series": [{"series": series, "values": "1 _x25 1 _"}], "eval_time": "27h", "expected": []},
]
tests = {"evaluation_interval": "5m", "tests": [{"name": c["name"], "interval": "1h", "input_series": c["input_series"], "promql_expr_test": [{"expr": f"sum({query})", "eval_time": c["eval_time"], "exp_samples": c["expected"]}]} for c in cases]}
subprocess.run(["docker", "run", "--rm", "-i", "--entrypoint", "sh", "prom/prometheus:v3.5.0@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996", "-c", "cat > /tmp/heartbeat-tests.json && promtool test rules /tmp/heartbeat-tests.json"], input=json.dumps(tests), text=True, check=True)
