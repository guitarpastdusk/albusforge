"use client"; // Error boundaries must be Client Components.

import { ServiceUnavailable } from "@/components/errors/ServiceUnavailable";

/**
 * Root error boundary. Renders inside the root layout, so the header and
 * footer stay, and covers every segment below it — the (app) screens, the
 * marketplace, the build chat. Next.js 16.3: `retry` re-fetches and
 * re-renders the segment; `reset` would re-render without re-fetching, which
 * can't recover from a Server Component failure.
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ServiceUnavailable digest={error.digest} onRetry={retry} />;
}
