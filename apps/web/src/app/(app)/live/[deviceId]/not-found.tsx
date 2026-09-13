import { PageState } from "@/components/page-states/PageState";

export default function NotFound() {
  return (
    <PageState
      title="Device unavailable"
      description="We could not find this device in your current workspace. Check the link or return to the list of resources available to you."
      backHref="/live"
      backLabel="Back to live systems"
    />
  );
}
