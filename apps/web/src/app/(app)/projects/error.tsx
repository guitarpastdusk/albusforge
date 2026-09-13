"use client";

import {
  PageFailure,
  type PageFailureProps,
} from "@/components/page-states/PageFailure";

export default function Error(props: PageFailureProps) {
  return (
    <PageFailure
      {...props}
      title="Projects could not load"
      backHref="/"
      backLabel="Start a new build"
    />
  );
}
