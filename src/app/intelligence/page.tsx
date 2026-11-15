import { IntelligenceHub } from "@/components/ExperienceHubs";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("Cosmic Intelligence", "Connect SPHEREx spectral samples with object investigation, measured motion workflows and published small-body data.", "/intelligence");

export default function IntelligencePage() {
  return <IntelligenceHub />;
}
