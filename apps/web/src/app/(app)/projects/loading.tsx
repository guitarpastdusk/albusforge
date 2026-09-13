import { PageState } from "@/components/page-states/PageState";

export default function Loading() {
  return (
    <PageState
      title="Loading projects"
      description="Your projects are loading. You can keep navigating while we check your workspace."
      loading
      backHref="/"
      backLabel="Start a new build"
    />
  );
}
