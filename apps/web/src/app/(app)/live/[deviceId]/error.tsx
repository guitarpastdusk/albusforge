"use client";

import {
  PageFailure,
  type PageFailureProps,
} from "@/components/page-states/PageFailure";

export default function Error(props: PageFailureProps) {
  return (
    <PageFailure
      {...props}
      title="Device telemetry could not load"
      backHref="/live"
      backLabel="Back to live systems"
    />
  );
}
