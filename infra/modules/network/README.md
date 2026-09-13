# infra/modules/network/

One VPC per environment with a single regional `/24` (ARCHITECTURE.md §12.3).

- **Private Google Access** on the subnet.
- **Cloud Router + Cloud NAT**, required because Cloud Run egress is `ALL_TRAFFIC` ([ADR 0004](../../../docs/adr/0004-cloud-run-egress-all-traffic-with-nat.md)).
- **Private services access**: a reserved `/16` peered to `servicenetworking`, which Cloud SQL private IP and Memorystore use. It is separate from the `/24`, so managed services don't consume Cloud Run's addresses.

Direct VPC egress takes subnet IPs per Cloud Run instance. A `/24` is ample at MVP scale; widen it before instance counts reach the low hundreds across all services.
