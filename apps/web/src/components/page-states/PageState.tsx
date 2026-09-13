import type { ReactNode, Ref } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/ui";

/** No protected data: safe to stream while page authorization is still pending. */
export function PageState({
  title,
  description,
  loading = false,
  backHref,
  backLabel,
  headingRef,
  children,
}: {
  title: string;
  description: string;
  loading?: boolean;
  backHref: string;
  backLabel: string;
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
}) {
  return (
    <PageContainer>
      <div className="max-w-[640px]">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-[32px] leading-tight sm:text-[42px] break-words outline-none"
        >
          {title}
        </h1>
        <p
          role={loading ? "status" : undefined}
          className="mt-4 text-[17px] leading-relaxed text-muted"
        >
          {description}
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          {children}
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center rounded-xl border border-hairline px-5 py-3 text-coral-deep focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            {backLabel}
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
