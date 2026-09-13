"use client";

import { useEffect, useRef } from "react";
import { PageState } from "./PageState";

export type PageFailureProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export function PageFailure({
  error,
  retry,
  title,
  backHref,
  backLabel,
}: PageFailureProps & { title: string; backHref: string; backLabel: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The failed segment replaced the focused page/control. Put focus on its
  // recovery heading; loading states intentionally do not take focus.
  useEffect(() => {
    heading.current?.focus();
  }, [error]);
  return (
    <PageState
      title={title}
      headingRef={heading}
      description="This page could not be loaded. Your access may have changed, or the service may be unavailable. Try again to check your current session and reload the page."
      backHref={backHref}
      backLabel={backLabel}
    >
      <button
        type="button"
        onClick={retry}
        className="min-h-11 rounded-xl bg-coral-deep px-5 py-3 text-white focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        Try again
      </button>
      {error.digest && (
        <p className="w-full break-all font-mono text-xs text-muted">
          Reference: {error.digest}
        </p>
      )}
    </PageState>
  );
}
