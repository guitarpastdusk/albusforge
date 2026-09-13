#!/usr/bin/env python3
"""Exercise the checked-in numeric log predicates at operational boundaries.
The log-query language defines numeric > and missing-field exclusion; Terraform
mocks separately ensure these predicates feed integer counters and SUM policies.
No histogram percentile participates in this decision model.
"""
import pathlib
import re

source = (pathlib.Path(__file__).parents[1] / "env/telemetry-health.tf").read_text()
predicates = dict(re.findall(r'jsonPayload\.(dirty_hours|oldest_dirty_seconds|default_rows|pool_wait_ms)>(\d+)', source))
fixtures = {
    "dirty_hours": ([None, 0, 9000, 9999, 10000], [10001, 20000]),
    "oldest_dirty_seconds": ([None, 0, 600, 899.9, 900], [900.1, 1200]),
    "default_rows": ([None, 0], [1, 2]),
    "pool_wait_ms": ([None, 0, 450, 499.9, 500], [500.1, 600]),
}
checks = 0
for field, (healthy, unhealthy) in fixtures.items():
    threshold = float(predicates[field])
    for expected, values in [(False, healthy), (True, unhealthy)]:
        for value in values:
            accepted = value is not None and value > threshold
            assert accepted == expected, (field, value, threshold, expected)
            checks += 1
    # Repeated below/equal-threshold data cannot accumulate any breach count.
    assert sum(value is not None and value > threshold for value in healthy * 1000) == 0
    checks += 1
print(f"{checks} exact log-predicate boundary/history checks passed")
