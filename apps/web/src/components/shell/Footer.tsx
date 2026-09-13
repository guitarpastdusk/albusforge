import Link from "next/link";

export function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-hairline bg-porcelain px-6 py-[26px] lg:px-12">
      <span className="font-mono text-[13px] text-faint">
        albusforge.ai — a wish → parts → a working gadget → Physical AI in the cloud
      </span>
      <nav aria-label="Footer" className="flex gap-[22px] text-[14px]">
        <Link href="/docs">Docs</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/security">Security pledge</Link>
      </nav>
    </footer>
  );
}
