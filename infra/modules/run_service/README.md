# infra/modules/run_service/

A Cloud Run service with its own runtime service account (ARCHITECTURE.md §6.1: each app has its own SA).

- **Terraform owns the shape** (ingress, egress, scaling, resources, SA). **CI owns the image** ([ADR 0005](../../../docs/adr/0005-ci-owns-images-terraform-owns-shape.md)); `image` only seeds the first revision.
- Egress defaults to `ALL_TRAFFIC` through direct VPC egress, so calls to internal-ingress services count as internal ([ADR 0004](../../../docs/adr/0004-cloud-run-egress-all-traffic-with-nat.md)).
- `public_invoker` grants `allUsers` `run.invoker`. Only use it together with `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`, so the load balancer and Cloud Armor are still the only way in.
- For always-on queue consumers such as codegen, set `cpu_idle = false` and `min_instances = 1`.

Service-to-service `run.invoker` bindings are made by the caller's environment root, not here, because the call graph belongs to the system rather than to any one service.
