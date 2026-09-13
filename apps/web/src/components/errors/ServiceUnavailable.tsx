import { Button, PageContainer, PageTitle } from "@/components/ui";

/**
 * Shown by the error boundaries when a page can't render — today most often
 * because gateway is unreachable or not answering with the API. Says so
 * plainly; the cause is in the server logs under the same digest.
 */
export function ServiceUnavailable({ digest, onRetry }: { digest?: string; onRetry: () => void }) {
  return (
    <PageContainer>
      <PageTitle
        kicker="Service unavailable"
        title="We can’t reach the service right now."
        description="This page couldn’t load what it needs. It’s usually temporary."
      />
      <div className="mt-8 flex flex-wrap items-center gap-5">
        <Button
          variant="coral"
          pill
          className="px-[26px] py-[13px] text-[16px] font-semibold"
          onClick={() => onRetry()}
        >
          Try again
        </Button>
        {digest ? <p className="font-mono text-[13px] text-faint">Reference: {digest}</p> : null}
      </div>
    </PageContainer>
  );
}
