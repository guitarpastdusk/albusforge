# apps/

Deployable services. Each becomes one Cloud Run service with the same name.

| App | What it is |
| --- | --- |
| [web](web/) | The portal: landing chat, sign-up, projects, live systems, device dashboard, marketplace. Serves the apex and every tenant subdomain; `/v1/*` goes to gateway ([ADR 0007](../docs/adr/0007-portal-routing.md)). |

The services in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §3 — gateway, intake, matcher, codegen, fulfillment, cloudlink, marketplace — land here as their milestones start.
