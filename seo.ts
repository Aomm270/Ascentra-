import type { Metadata } from "next";

export const SITE_NAME = "ASCENTRA";

function resolveSiteUrl(): URL | undefined {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const localFallback = process.env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined;
  const value = configured || localFallback;
  if (!value) return undefined;

  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(normalized);
    return url.protocol === "https:" || url.hostname === "localhost" ? new URL(url.origin) : undefined;
  } catch {
    return undefined;
  }
}

export const SITE_URL = resolveSiteUrl();
export const IS_PREVIEW_DEPLOYMENT = process.env.VERCEL_ENV === "preview";

export function pageMetadata(title: string, description: string, pathname: string): Metadata {
  const canonical = SITE_URL ? new URL(pathname, SITE_URL).toString() : undefined;
  const image = { url: "/opengraph-image", width: 1200, height: 630, alt: "ASCENTRA · Explore the Universe in 102 Colours" };

  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    robots: IS_PREVIEW_DEPLOYMENT ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title,
      description,
      siteName: SITE_NAME,
      locale: "en_US",
      type: "website",
      ...(canonical ? { url: canonical } : {}),
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image.url],
    },
  };
}
