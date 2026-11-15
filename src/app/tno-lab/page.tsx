import { TnoIntelligenceLab } from "@/components/TnoIntelligenceLab";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("TNO Intelligence Lab", "Review published astrometry, JPL ephemerides and available observations in ASCENTRA's trans-Neptunian object research module.", "/tno-lab");

export default function TnoLabPage() {
  return <TnoIntelligenceLab />;
}
