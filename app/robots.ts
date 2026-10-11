import { MetadataRoute } from "next";

// Single source for the canonical base — layout.tsx `metadataBase`,
// app/sitemap.ts and this file all read it. Preview/staging deploys override
// via NEXT_PUBLIC_SITE_URL.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://anchor.norai.tech";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
