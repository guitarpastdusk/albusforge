import { PageState } from "@/components/page-states/PageState";

export default function Loading() {
  return (
    <PageState
      title="Loading usage"
      description="Your workspace usage is loading. This may take a moment."
      loading
      backHref="/projects"
      backLabel="Back to projects"
    />
  );
}
