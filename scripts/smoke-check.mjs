const baseUrl = (process.env.ASCENTRA_WEB_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const routes = [
  ["/", "THE UNIVERSE"],
  ["/research", "Observation controls"],
  ["/intelligence", "Every signal"],
  ["/compare", "EPOCH COMPARISON"],
  ["/discoveries", "THE DISCOVERY CENTRE"],
  ["/investigate", "OBJECT INVESTIGATOR"],
  ["/spectral", "SPECTRAL EXPLORER"],
  ["/motion", "SKY POSITION"],
  ["/tno-lab", "Opening the TNO Intelligence Lab"],
  ["/cosmic-explorer", "COSMIC EXPLORER"],
  ["/about", "ABOUT THE MISSION"],
  ["/sources", "DATA &amp; SOURCES"],
];

for (const [route, expectedText] of routes) {
  const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(10000) });
  const html = await response.text();
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  if (!html.includes(expectedText)) throw new Error(`${route} did not render expected page marker “${expectedText}”`);
  if (!html.includes("primary-navigation")) throw new Error(`${route} is missing shared navigation`);
  if (!html.includes("Data provided by NASA/IPAC IRSA")) throw new Error(`${route} is missing data attribution`);
  if (!html.includes('<p>|Aomm|</p>')) throw new Error(`${route} is missing the exact footer attribution`);
  if (html.includes("Sebastian") || html.includes("Clarence")) throw new Error(`${route} contains a removed footer name`);
  if (!html.includes('name="description"') || !html.includes('property="og:title"') || !html.includes('name="twitter:card"')) {
    throw new Error(`${route} is missing search and social metadata`);
  }
  if (!html.includes('rel="canonical"')) throw new Error(`${route} is missing its canonical URL`);
  if (!html.includes('application/ld+json')) throw new Error(`${route} is missing structured site information`);
  console.log(`PASS ${route}: HTTP ${response.status}, page content, shared navigation, and footer attribution`);
}

const [robotsResponse, sitemapResponse, imageResponse] = await Promise.all([
  fetch(`${baseUrl}/robots.txt`, { signal: AbortSignal.timeout(10000) }),
  fetch(`${baseUrl}/sitemap.xml`, { signal: AbortSignal.timeout(10000) }),
  fetch(`${baseUrl}/opengraph-image`, { signal: AbortSignal.timeout(10000) }),
]);
const [robots, sitemap] = await Promise.all([robotsResponse.text(), sitemapResponse.text()]);
if (!robotsResponse.ok || !robots.includes("Sitemap:")) throw new Error("robots.txt is missing its sitemap declaration");
if (!sitemapResponse.ok || !sitemap.includes("/research") || !sitemap.includes("/cosmic-explorer")) {
  throw new Error("sitemap.xml is missing expected public routes");
}
if (!imageResponse.ok || !imageResponse.headers.get("content-type")?.includes("image/png")) {
  throw new Error("Open Graph preview image did not return a PNG");
}
console.log("PASS publication metadata: robots, sitemap routes, and social preview image");
