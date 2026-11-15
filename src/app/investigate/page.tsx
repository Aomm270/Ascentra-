import { ObjectInvestigator } from "@/components/ObjectInvestigator";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("Object Investigator", "Inspect SPHEREx image metadata, sky coordinates and available catalogue context without overstating source identifications.", "/investigate");

export default function InvestigatorPage() { return <ObjectInvestigator />; }
