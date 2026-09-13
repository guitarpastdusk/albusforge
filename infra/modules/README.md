# infra/modules/

Reusable pieces composed by [`../env/`](../env/). Each takes `project_id` explicitly and has no provider block of its own.

| Module | Creates | Added |
| --- | --- | --- |
| [`network/`](network/) | VPC, subnet, Cloud Router + NAT, private services access | M0 |
| [`run_service/`](run_service/) | Cloud Run service + its own runtime SA | M0 |
| [`edge/`](edge/) | global HTTPS LB, Certificate Manager cert, Cloud Armor, DNS records | M0 |

Planned: `sql` (M1), `run_job` (M1), `redis` + `buckets` (M4), `observability` (M2).
