import { PageState } from "@/components/page-states/PageState";

export default function NotFound() {
  return (
    <PageState
      title="Build unavailable"
      description="We could not find this build. It may belong to another browser session or workspace, or the link may be incomplete. Start a new build from the home page."
      backHref="/"
      backLabel="Start a new build"
    />
  );
}
