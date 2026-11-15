import { AscentraHome } from "@/components/AscentraHome";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("The Universe Has More to Reveal", "Explore public SPHEREx infrared observations, spectral information, scientific analysis and a separate cosmic simulation.", "/");

export default function HomePage() {
  return <AscentraHome />;
}
