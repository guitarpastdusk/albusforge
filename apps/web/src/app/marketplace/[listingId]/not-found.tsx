import { PageState } from "@/components/page-states/PageState";

export default function NotFound() {
  return (
    <PageState
      title="Build not found"
      description="There is no build with this address in the Marketplace. It may have been unlisted, or the link may be incomplete."
      backHref="/marketplace"
      backLabel="Back to the Marketplace"
    />
  );
}
