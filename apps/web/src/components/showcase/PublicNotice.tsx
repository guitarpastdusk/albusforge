import Link from "next/link";

/**
 * Says what this page is, on every showcase page.
 *
 * A visitor arriving from the landing page is looking at somebody else's real
 * hardware, reading live. That is worth stating plainly: it explains why nothing
 * can be edited here, and it stops the page reading as a mock-up.
 */
export function PublicNotice({ deviceHref }: { deviceHref?: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border border-positive-edge bg-positive px-5 py-4">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-success animate-af-pulse motion-reduce:animate-none" />
      <p className="min-w-0 flex-1 text-[15px] font-light leading-[1.5] text-ink">
        A real device, running now, shown read-only. Readings arrive from the hardware; nothing here can be changed from this
        page.
      </p>
      {deviceHref ? (
        <Link href={deviceHref} className="text-[15px] font-medium text-coral-deep hover:text-coral">
          Open the device →
        </Link>
      ) : null}
    </div>
  );
}
