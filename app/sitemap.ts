import { MetadataRoute } from "next";

// Same canonical base as layout.tsx metadataBase and app/robots.ts.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://anchor.norai.tech";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1.0,
      // Canonical/default alternate points back at the SITE base.
      alternates: { languages: { "x-default": SITE } },
    },
    {
      url: `${SITE}/tools/anchorflow`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
      alternates: { languages: { "x-default": `${SITE}/tools/anchorflow` } },
    },
  ];
}
