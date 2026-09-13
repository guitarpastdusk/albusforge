import { PageState } from "@/components/page-states/PageState";

export default function Loading() {
  return (
    <PageState
      title="Loading device telemetry"
      description="Stored readings are loading. You can return to the fleet while you wait."
      loading
      backHref="/live"
      backLabel="Back to live systems"
    />
  );
}
