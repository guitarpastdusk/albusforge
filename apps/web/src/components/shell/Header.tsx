"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/actions/auth";
import { ButtonLink } from "@/components/ui";
import { cx } from "@/lib/cx";

export interface HeaderUser {
  email: string;
  displayName: string | null;
}

interface NavItem {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  /** Shown only with a session — the routes behind the guard (proxy.ts, lib/session.ts). */
  signedIn?: true;
}

const NAV: NavItem[] = [
  { href: "/", label: "Build", isActive: (p) => p === "/" || p.startsWith("/build/") },
  { href: "/projects", label: "Projects", isActive: (p) => p.startsWith("/projects"), signedIn: true },
  { href: "/live", label: "Live systems", isActive: (p) => p.startsWith("/live"), signedIn: true },
  { href: "/marketplace", label: "Marketplace", isActive: (p) => p.startsWith("/marketplace") },
];

const MENU_ID = "site-menu";

function initials({ displayName, email }: HeaderUser): string {
  const words = (displayName ?? email.split("@")[0] ?? "").split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Avatar({ user, size }: { user: HeaderUser; size: "desktop" | "compact" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-pastel-peach font-semibold text-coral-deep",
        size === "desktop" ? "size-9 text-[15px]" : "size-8 text-[14px]",
      )}
    >
      {initials(user)}
    </span>
  );
}

/**
 * `user` comes from the server session (SessionHeader). `pending` is the
 * Suspense fallback while it loads: public nav only, and nothing on the
 * right, so neither signed-in nor signed-out chrome flashes.
 *
 * From `lg` up this is the design's header, unchanged. Below `lg` the nav and
 * account controls move into a menu behind one button, so nothing overflows
 * the viewport however long the email is.
 */
export function Header({ user, pending = false }: { user: HeaderUser | null; pending?: boolean }) {
  const pathname = usePathname() ?? "";
  const items = NAV.filter((item) => !item.signedIn || user);
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 flex items-center gap-4 border-b border-hairline bg-porcelain px-4 py-[22px] sm:px-6 lg:gap-9 lg:px-12">
      <Link href="/" className="flex shrink-0 items-baseline gap-0.5 text-ink hover:text-ink">
        <span className="font-display text-[24px] font-semibold tracking-[-0.01em]">albusforge</span>
        <span className="font-mono text-[20px] text-coral">.ai</span>
      </Link>

      <nav aria-label="Primary" className="ml-3 hidden min-w-0 gap-2 overflow-x-auto lg:flex">
        {items.map(({ href, label, isActive }) => {
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

      <div className="ml-auto hidden shrink-0 items-center gap-3.5 lg:flex">
        {pending ? null : user ? (
          <div className="flex items-center gap-2.5">
            <Avatar user={user} size="desktop" />
            <span className="text-[15px] text-muted">{user.email}</span>
            <form action={signOut} className="ml-1.5">
              <button type="submit" className="whitespace-nowrap text-[14px] text-faint hover:text-coral-deep">
                Sign out
              </button>
            </form>
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

      <button
        ref={buttonRef}
        type="button"
        aria-expanded={menuOpen}
        aria-controls={MENU_ID}
        aria-label={user ? `Menu, signed in as ${user.email}` : "Menu"}
        onClick={() => setMenuOpen((open) => !open)}
        className="ml-auto flex shrink-0 items-center gap-2 rounded-full border border-hairline bg-white py-1 pr-3.5 pl-1 text-[15px] text-ink hover:border-ink lg:hidden"
      >
        {user ? (
          <Avatar user={user} size="compact" />
        ) : (
          <span aria-hidden className="flex size-8 flex-col items-center justify-center gap-[5px]">
            <span className="h-[1.5px] w-4 rounded-full bg-ink" />
            <span className="h-[1.5px] w-4 rounded-full bg-ink" />
            <span className="h-[1.5px] w-4 rounded-full bg-ink" />
          </span>
        )}
        <span aria-hidden>{menuOpen ? "Close" : "Menu"}</span>
      </button>

      {menuOpen ? (
        <HeaderMenu id={MENU_ID} items={items} pathname={pathname} user={user} pending={pending} onNavigate={() => setMenuOpen(false)} />
      ) : null}
    </header>
  );
}

/** The menu below `lg`: the nav, then the account (full email and Sign out) or Sign in and Get started. */
export function HeaderMenu({
  id,
  items,
  pathname,
  user,
  pending,
  onNavigate,
}: {
  id: string;
  items: NavItem[];
  pathname: string;
  user: HeaderUser | null;
  pending: boolean;
  onNavigate: () => void;
}) {
  return (
    <div
      id={id}
      className="absolute inset-x-0 top-full border-b border-hairline bg-porcelain px-4 pt-3 pb-5 shadow-[0_24px_60px_-30px_rgb(46_42_51/0.2)] sm:px-6 lg:hidden"
    >
      <nav aria-label="Menu">
        <ul className="flex flex-col gap-1">
          {items.map(({ href, label, isActive }) => {
            const active = isActive(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "block rounded-[14px] px-4 py-3 text-[17px] hover:text-ink",
                    active ? "bg-nav-active font-semibold text-ink" : "text-muted",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {pending ? null : (
        <div className="mt-3 border-t border-hairline px-1 pt-4">
          {user ? (
            <>
              <div className="flex items-center gap-3">
                <Avatar user={user} size="desktop" />
                <span className="min-w-0 break-all text-[15px] text-muted">{user.email}</span>
              </div>
              <form action={signOut}>
                <button
                  type="submit"
                  className="mt-4 w-full rounded-[14px] border border-hairline bg-white py-3 text-[16px] text-ink hover:border-ink"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <Link href="/signin" onClick={onNavigate} className="rounded-[14px] px-3 py-2 text-[17px] text-muted hover:text-ink">
                Sign in
              </Link>
              <ButtonLink href="/signup" onClick={onNavigate} variant="dark" className="w-full rounded-[14px] py-3 text-[16px] font-medium">
                Get started
              </ButtonLink>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
