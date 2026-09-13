"use client"; // Error boundaries must be Client Components.

import { ServiceUnavailable } from "@/components/errors/ServiceUnavailable";
import { fontVariables } from "./fonts";
import "./globals.css";

/**
 * Replaces the root layout when the layout itself fails. It must render its
 * own <html> and <body>, and bring its own styles and fonts. There is no
 * header or footer here, since they may be what failed. `metadata` isn't
 * supported in global-error, so the title is a React <title>.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="flex min-h-screen flex-col">
        <title>Service unavailable · albusforge.ai</title>
        <ServiceUnavailable digest={error.digest} onRetry={retry} />
      </body>
    </html>
  );
}
