import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { SessionHeader } from "@/components/shell/SessionHeader";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "albusforge.ai — Your own Physical AI",
    template: "%s · albusforge.ai",
  },
  description: "Describe a device in a sentence — we design, build, and put it live.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="flex min-h-screen flex-col">
        {/* The session read streams in its own boundary, so it doesn't hold back the page. */}
        <Suspense fallback={<Header user={null} pending />}>
          <SessionHeader />
        </Suspense>
        <div className="flex flex-1 flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
