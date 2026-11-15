import { DiscoveryCentre } from "@/components/DiscoveryCentre";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("Astronomical Discoveries", "Review ASCENTRA's evidence-first discovery workflow. Candidate listings remain empty until observations support a verified result.", "/discoveries");

export default function DiscoveriesPage() { return <DiscoveryCentre />; }
