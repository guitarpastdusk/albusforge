import { Fraunces, IBM_Plex_Mono, Outfit } from "next/font/google";

/*
 * The design's three faces, as CSS variables on <html>. Shared by the root
 * layout and global-error.tsx, which replaces the layout and must load its
 * own fonts.
 */

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

export const fontVariables = `${fraunces.variable} ${outfit.variable} ${plexMono.variable}`;
