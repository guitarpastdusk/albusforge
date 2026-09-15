import { liveDemoUrl } from "@/lib/live-demo";

/**
 * A link beside the title to a running device, so a visitor can see a real one
 * before describing their own.
 *
 * It renders only when a destination is configured. The device pages inside this
 * app (`/live/:id`, `/setup`) require a session, so pointing a public "live demo"
 * at one would send every stranger to a sign-in wall — worse than showing
 * nothing. Until there is a destination a signed-out visitor can actually read,
 * this stays hidden rather than promising something it can't deliver.
 */
export function LiveDemoPill() {
  const url = liveDemoUrl();
  if (!url) return null;
  const external = /^https?:\/\//.test(url);
  return (
    <a
      href={url}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      className="mb-5 inline-flex items-center gap-2.5 rounded-full border border-hairline bg-white px-[18px] py-2 text-[14px] text-ink transition-colors hover:border-coral hover:text-coral-deep"
    >
      <span aria-hidden className="size-2 rounded-full bg-success animate-af-pulse motion-reduce:animate-none" />
      Live demo
      <span aria-hidden className="text-muted">→</span>
      <span className="sr-only">: see a device that is running now</span>
    </a>
  );
}
