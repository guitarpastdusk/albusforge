import { PageState } from "@/components/page-states/PageState";

export default function NotFound() {
  return (
    <PageState
      title="Project unavailable"
      description="We could not find this project in your current workspace. Check the link or return to the list of resources available to you."
      backHref="/projects"
      backLabel="Back to projects"
    />
  );
}
