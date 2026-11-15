import type { Metadata, Viewport } from "next";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { StructuredData } from "@/components/StructuredData";
import { IS_PREVIEW_DEPLOYMENT, SITE_URL } from "@/lib/seo";
import "./globals.css";
import "./experience.css";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: { default: "ASCENTRA — Explore the Universe in 102 Colours", template: "%s | ASCENTRA" },
  description: "Explore real SPHEREx observations through time and wavelength, powered by NASA/IPAC IRSA.",
  icons: { icon: "/favicon.svg" },
  applicationName: "ASCENTRA",
  robots: IS_PREVIEW_DEPLOYMENT ? { index: false, follow: false } : { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "ASCENTRA",
    title: "ASCENTRA — Explore the Universe in 102 Colours",
    description: "Explore public SPHEREx observations, spectral channels and an independent cosmic simulation.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "ASCENTRA · Explore the Universe in 102 Colours" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ASCENTRA — Explore the Universe in 102 Colours",
    description: "Explore public SPHEREx observations, spectral channels and an independent cosmic simulation.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#050916",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><StructuredData /><div className="starfield" aria-hidden="true" /><Navigation /><main className="app-main">{children}</main><Footer /></body></html>;
}
