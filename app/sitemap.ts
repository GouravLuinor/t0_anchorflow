import type { MetadataRoute } from "next";
import { LEARN_TOPICS } from "@/lib/learn";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/tools/anchorflow`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/tools/anchorflow/learn`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...LEARN_TOPICS.map((t) => ({
      url: `${SITE_URL}/tools/anchorflow/learn/${t.slug}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.6,
    })),
  ];
}
