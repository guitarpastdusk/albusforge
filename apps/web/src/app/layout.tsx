import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Outfit } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "albusforge.ai — Your own Physical AI",
    template: "%s · albusforge.ai",
  },
  description: "Describe a device in a sentence — we design, build, and put it live.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${outfit.variable} ${plexMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        {/* TODO(auth): read the session (GET /v1/me) and pass the user here. */}
        <Header user={null} />
        <div className="flex flex-1 flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
