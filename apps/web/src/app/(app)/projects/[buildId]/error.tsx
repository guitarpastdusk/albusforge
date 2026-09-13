"use client";

import {
  PageFailure,
  type PageFailureProps,
} from "@/components/page-states/PageFailure";

export default function Error(props: PageFailureProps) {
  return (
    <PageFailure
      {...props}
      title="Project could not load"
      backHref="/projects"
      backLabel="Back to projects"
    />
  );
}
