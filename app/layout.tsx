import type { Metadata, Viewport } from "next";
import { type ReactNode } from "react";
import { Martian_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./tools/anchorflow/_components/providers/ThemeProvider";
import { SITE, SITE_URL } from "@/lib/site";

const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-schibsted",
});

const martian = Martian_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-martian",
  // The narrow width keeps 40-hex SHAs on one line in the ledger.
  axes: ["wdth"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE.title} · Anchorflow`,
    template: "%s · Anchorflow",
  },
  description: SITE.description,
  keywords: [...SITE.keywords],
  applicationName: "Anchorflow",
  creator: SITE.creator,
  alternates: { canonical: "/tools/anchorflow" },
  robots: { index: true, follow: true },
  openGraph: {
    title: `${SITE.title} · Anchorflow`,
    description: SITE.description,
    type: "website",
    url: "/tools/anchorflow",
    siteName: "Anchorflow by Nor AI",
    locale: SITE.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.title} · Anchorflow`,
    description: SITE.description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e6ece4" },
    { media: "(prefers-color-scheme: dark)", color: "#101b17" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${schibsted.variable} ${martian.variable}`}
    >
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
