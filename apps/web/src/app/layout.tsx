import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
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
        {/* TODO(auth): read the session (GET /v1/me) and pass the user here. */}
        <Header user={null} />
        <div className="flex flex-1 flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
