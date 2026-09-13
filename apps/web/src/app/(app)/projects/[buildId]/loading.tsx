import { PageState } from "@/components/page-states/PageState";

export default function Loading() {
  return (
    <PageState
      title="Loading project"
      description="Your saved project is loading. You can return to your projects while you wait."
      loading
      backHref="/projects"
      backLabel="Back to projects"
    />
  );
}
