"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/ui";
import { cx } from "@/lib/cx";

export interface HeaderUser {
  email: string;
  displayName: string | null;
}

const NAV: Array<{ href: string; label: string; isActive: (pathname: string) => boolean }> = [
  { href: "/", label: "Build", isActive: (p) => p === "/" || p.startsWith("/build/") },
  { href: "/projects", label: "Projects", isActive: (p) => p.startsWith("/projects") },
  { href: "/live", label: "Live systems", isActive: (p) => p.startsWith("/live") },
  { href: "/marketplace", label: "Marketplace", isActive: (p) => p.startsWith("/marketplace") },
];

function initials({ displayName, email }: HeaderUser): string {
  const words = (displayName ?? email.split("@")[0] ?? "").split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Header({ user }: { user: HeaderUser | null }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 flex items-center gap-4 border-b border-hairline bg-porcelain px-6 py-[22px] lg:gap-9 lg:px-12">
      <Link href="/" className="flex shrink-0 items-baseline gap-0.5 text-ink hover:text-ink">
        <span className="font-display text-[24px] font-semibold tracking-[-0.01em]">albusforge</span>
        <span className="font-mono text-[20px] text-coral">.ai</span>
      </Link>

      <nav aria-label="Primary" className="ml-3 flex min-w-0 gap-2 overflow-x-auto">
        {NAV.map(({ href, label, isActive }) => {
          const active = isActive(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "whitespace-nowrap rounded-full px-4 py-2 text-[16px] hover:text-ink",
                active ? "bg-nav-active font-semibold text-ink" : "font-normal text-muted",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-3.5">
        {user ? (
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-full bg-pastel-peach text-[15px] font-semibold text-coral-deep"
            >
              {initials(user)}
            </span>
            <span className="text-[15px] text-muted">{user.email}</span>
          </div>
        ) : (
          <>
            <Link href="/signin" className="whitespace-nowrap text-[16px] text-muted hover:text-ink">
              Sign in
            </Link>
            <ButtonLink href="/signup" variant="dark" pill className="px-6 py-[11px] text-[16px] font-medium">
              Get started
            </ButtonLink>
          </>
        )}
      </div>
    </header>
  );
}
