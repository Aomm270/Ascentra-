import type { MetadataRoute } from "next";
import { IS_PREVIEW_DEPLOYMENT, SITE_URL } from "@/lib/seo";

const publicRoutes = [
  ["/", 1.0, "weekly"],
  ["/about", 0.7, "monthly"],
  ["/research", 0.9, "weekly"],
  ["/compare", 0.8, "monthly"],
  ["/discoveries", 0.7, "weekly"],
  ["/intelligence", 0.8, "monthly"],
  ["/investigate", 0.8, "monthly"],
  ["/motion", 0.8, "monthly"],
  ["/sources", 0.7, "monthly"],
  ["/spectral", 0.8, "monthly"],
  ["/tno-lab", 0.7, "monthly"],
  ["/cosmic-explorer", 0.9, "monthly"],
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE_URL || IS_PREVIEW_DEPLOYMENT) return [];
  return publicRoutes.map(([path, priority, changeFrequency]) => ({
    url: new URL(path, SITE_URL).toString(),
    priority,
    changeFrequency,
  }));
}
