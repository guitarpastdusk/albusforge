# Albus Forge — UI Usage Analytics & Scoping

**Status:** Proposed scoping document, post-M2.  
**Companion documents:** [`PORTAL.md`](PORTAL.md) (screens and routes), [`ARCHITECTURE.md`](ARCHITECTURE.md) (system context & invariants), [`CLOUD-PLATFORM.md`](CLOUD-PLATFORM.md) (telemetry & privacy), and [ADR 0007](adr/0007-portal-routing.md) (portal routing & SSR contract).

---

## 1. Context & Objective

Albus Forge turns a plain-language prompt into real hardware: parts cart, printable enclosure, firmware, and cloud operation. The web portal (`apps/web`) spans two distinct operational domains:

1. **An open public onboarding surface:** landing page, showcase carousel, pricing, documentation, marketplace listings, and anonymous build creation (`/build/:id`).
2. **A private Physical AI operations hub:** live device fleet management (`/live`), per-device dashboards (`/live/:deviceId`), real-time sensor streams, and closed-loop rule creation/confirmation.

This document scopes the feasibility, architectural integration, privacy boundaries, and trade-offs of using **Google Analytics (GA4)** to track UI usage across the portal.

---

## 2. Executive Assessment

| Criterion | Evaluation | Detail |
|---|---|---|
| **Technical Feasibility** | **High** | Native support in Next.js 16 (`@next/third-parties/google`). Minimal bundle overhead; client-side asynchronous execution. |
| **Auth & Security Impact** | **None** | Host-only authentication cookies (`__Host-albus_session`, `__Host-albus_anon`) and the internal SSR header contract ([ADR 0007](adr/0007-portal-routing.md)) remain strictly isolated from Google Analytics client cookies. |
| **Network & CDN** | **Zero Overhead** | Tags load directly from Google's CDN (`googletagmanager.com`), bypassing Cloud Armor rate limits (600 req/min) enforced on the Albus Forge load balancer. |
| **Privacy & Security Pledge** | **High Risk if unconstrained** | Passing user prompts, hardware designs, or physical sensor telemetry to third parties compromises the [Security Pledge](apps/web/src/app/(static)/security/page.tsx). Strict parameter whitelisting is required. |
| **Data Fidelity & Ad-blockers** | **Medium (30–50% loss)** | High ad-blocker adoption (uBlock, Brave, Pi-hole) among makers, engineers, and lab operators means GA will systematically undercount technical engagement. |
| **Regulatory (GDPR/ePrivacy)** | **Friction** | GA4 uses non-essential cookies (`_ga`), requiring a consent banner in the EU/UK. This conflicts with the zero-friction *"one question in → device out"* anonymous onboarding philosophy. |

---

## 3. Surface Partitioning: What to Track vs. What to Exclude

To satisfy the platform's security and tenant isolation invariants, UI tracking must enforce a strict boundary between public marketing and private physical device control:

```mermaid
flowchart TD
    subgraph PublicSurface["Public Top-of-Funnel (Safe for GA4)"]
        L["Landing (/)"] --> C["Showcase Carousel"]
        C --> P["Pricing & Docs (/pricing, /docs)"]
        P --> M["Marketplace Browsing (/marketplace)"]
        M --> B["Anonymous Build CTA (/build/:id)"]
    end

    subgraph PrivateSurface["Physical Operations (First-Party Only)"]
        BC["Intake Chat Transcript"]
        LF["Live Fleet View (/live)"]
        DD["Sensor Dashboard (/live/:deviceId)"]
        CR["Rule Proposal & Confirmation"]
    end

    PublicSurface -.->|GA4 Events & Funnels| GA[(Google Analytics)]
    PrivateSurface -.->|Audit Logs & DB Telemetry| DB[(Internal DB / Gateway Logs)]
```

### 3.1 Public Surface (Permitted for GA4)
Tracking on public and static routes focuses on conversion funnels and product discovery:
* **Landing Page (`/`):** Hero CTA clicks ("Start building"), example build card clicks, carousel navigation.
* **Static Content (`/about`, `/pricing`, `/docs`, `/security`):** Scroll depth, document section viewings.
* **Marketplace (`/marketplace`):** Category pill clicks (`Garden`, `Home`, `Workshop`, `Industrial`), listing detail views, clone/remix initiation.
* **Onboarding Funnel Events:**
  * `build_initiated`: Anonymous build creation.
  * `signup_prompt_reached`: Visitor reaches the save/claim gate.
  * `signup_completed`: Verified email code authentication.

### 3.2 Private & Operational Surface (Strictly Excluded from GA4)
The following data and surfaces must **never** be transmitted to Google Analytics:
* **Build Prompts & Chat Content:** Proprietary device concepts, internal specifications, and customer requirements entered into `/build/:id`.
* **Tenant & Device Identifiers:** Raw UUIDs, device tokens, or tenant slugs.
* **Sensor & Telemetry Streams:** Real-time sensor readings (temperatures, moisture levels, presence indicators) displayed on `/live` or `/live/:deviceId`.
* **Closed-Loop Rule Executions:** Triggering or confirming physical actions (e.g. servo activation, pump relays, alert configurations). These belong exclusively in the gateway's auditable database tables (`audit_log`, `device_actions`).

---

## 4. Technical Architecture & Next.js 16 Integration

### 4.1 Implementation Pattern
Next.js 16 (`16.3.5`) provides first-class support via the `@next/third-parties/google` package:

```tsx
// apps/web/src/app/layout.tsx
import { GoogleAnalytics } from "@next/third-parties/google";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
        )}
      </body>
    </html>
  );
}
```

### 4.2 Multi-Tenant Subdomain Routing
Per [ADR 0007](adr/0007-portal-routing.md), the portal serves the apex (`albusforge.ai`) and tenant subdomains (`<tenant>.albusforge.ai`).
* **Cross-domain tracking:** GA4 cookie configuration should set `cookie_domain: 'auto'` to maintain cross-subdomain sessions across apex and tenant subdomains.
* **Tenant masking:** When virtual page views are fired, URL paths must strip out sensitive tenant subdomains or replace them with a generic identifier to prevent tenant enumeration in analytics dashboards.

### 4.3 App Router Virtual Pageviews
Next.js App Router relies on client-side routing. Navigation via `<Link>` components does not trigger standard full-page browser loads.
* GA4's default **Enhanced Measurement** automatically listens to browser History API state changes (`pushState`, `replaceState`) to log virtual page views.
* Custom event tracking should be abstracted into a typed wrapper (`apps/web/src/lib/analytics.ts`) that verifies user consent and strips unapproved metadata before calling `window.gtag()`.

---

## 5. Alternatives & Privacy-First Considerations

| Approach | Setup Effort | Ad-Blocker Resilience | Privacy / Cookie Banner | Operational Cost |
|---|---|---|---|---|
| **Google Analytics 4 (GA4)** | Very Low (< 0.5 day) | Poor (30–50% blocked) | Requires Cookie Consent Banner (EU) | Free tier |
| **Privacy-First (Plausible / Umami)** | Low (1 day) | High (when proxied) | No cookies, fully GDPR compliant without banner | ~$9/mo or self-hosted Cloud Run |
| **First-Party Gateway Logging** | Low (already in progress) | Immune (100% accurate) | First-party server logs, no client tracking | $0 (included in Cloud Run/DB) |

---

## 6. Recommendations & Phased Rollout

1. **Phase 1 — Public Funnel GA4 (Immediate):**
   * Install `@next/third-parties/google` in `apps/web`.
   * Bind `NEXT_PUBLIC_GA_ID` through Terraform Secret Manager / environment variables.
   * Enable GA4 solely on public and static routes (`/`, `/about`, `/pricing`, `/docs`, `/marketplace`).
   * Enforce an allowlist on custom event payloads to guarantee zero transmission of device IDs, prompt text, or telemetry.

2. **Phase 2 — Server-Side & First-Party Analytics (Post-M2):**
   * Rely on `apps/gateway` structured access logs and Cloud Platform usage records ([`CLOUD-PLATFORM.md §9`](CLOUD-PLATFORM.md)) for authenticated operational metrics (active projects, live device counts, rule executions).
   * Evaluate cookieless analytics (such as Plausible) if international regulatory requirements or developer ad-blocker loss justify the additional tooling.
