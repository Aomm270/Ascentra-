import { ResearchHub } from "@/components/ExperienceHubs";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("SPHEREx Scientific Research", "Search public SPHEREx observations by sky position and inspect observation dates, wavelength coverage and NASA/IPAC IRSA provenance.", "/research");

export default function ResearchPage() {
  return <ResearchHub />;
}
