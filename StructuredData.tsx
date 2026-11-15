import { SITE_NAME, SITE_URL } from "@/lib/seo";

export function StructuredData() {
  const organization = {
    "@type": "Organization",
    name: SITE_NAME,
    description: "An independent public-facing astronomical exploration interface; not an official NASA product.",
    ...(SITE_URL ? { "@id": `${SITE_URL}/#organization`, url: SITE_URL.toString(), logo: `${SITE_URL}/favicon.svg` } : {}),
  };
  const website = {
    "@type": "WebSite",
    name: "ASCENTRA — SPHEREx Sky Chronicles",
    description: "Explore public SPHEREx observations, spectral channels and an independent cosmic simulation.",
    inLanguage: "en",
    ...(SITE_URL ? { "@id": `${SITE_URL}/#website`, url: SITE_URL.toString() } : {}),
    publisher: { "@type": "Organization", name: SITE_NAME },
  };
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": [organization, website] }).replace(/</g, "\\u003c");

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />;
}
