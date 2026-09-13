# docs/adr/

Architecture decision records. Each records one decision: its context, what was decided, and what that costs. A superseded ADR stays in place with its status updated. It is not deleted.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-shared-ci-project.md) | Shared CI project; one image digest promoted from staging to prod | Accepted |
| [0002](0002-dns-cloud-dns-delegated-from-godaddy.md) | DNS in Cloud DNS, delegated from GoDaddy; staging as a subzone | Accepted |
| [0003](0003-edge-lb-only-ingress-and-separate-ingest-backend.md) | Public traffic enters only through the LB; ingest gets its own backend | Accepted |
| [0004](0004-cloud-run-egress-all-traffic-with-nat.md) | Cloud Run egress is all-traffic through the VPC, with Cloud NAT | Accepted |
| [0005](0005-ci-owns-images-terraform-owns-shape.md) | CI owns images; Terraform owns everything else | Accepted |
| [0006](0006-terraform-layout.md) | Terraform layout: a bootstrap root and a workspace-per-environment root | Accepted |
| [0007](0007-portal-routing.md) | Portal on the apex; `/v1` to gateway, everything else to web, on every hostname | Accepted |
