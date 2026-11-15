import { ExploreDashboard } from "@/components/ExploreDashboard";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("Compare SPHEREx Observation Epochs", "Inspect SPHEREx images from different observation times while keeping wavelength, calibration and product limitations visible.", "/compare");

export default function ComparePage() { return <ExploreDashboard mode="compare" />; }
