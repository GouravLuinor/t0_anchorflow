import type { Metadata, Viewport } from "next";
import { type ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./tools/anchorflow/_components/providers/ThemeProvider";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://anchor.norai.tech";

const description =
  "Anchorflow is a 100% client-side GitHub Actions workstation: SHA-pinning, permission audits, injection-sink detection and a red/green diff of exactly what changed. Your workflow never leaves your browser.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Anchorflow — GitHub Actions Workstation",
    template: "%s · Anchorflow",
  },
  description,
  keywords: [
    "github actions",
    "pin actions to sha",
    "sha pinning",
    "actions permissions audit",
    "workflow security audit",
    "template injection",
    "Anchorflow",
    "NorAI",
  ],
  applicationName: "Anchorflow",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Anchorflow — GitHub Actions Workstation",
    description,
    type: "website",
    url: "/",
    siteName: "Anchorflow",
  },
  twitter: {
    card: "summary_large_image",
    title: "Anchorflow — GitHub Actions Workstation",
    description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e0b" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans bg-canvas text-ink min-h-screen antialiased selection:bg-brand-lime/25">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
