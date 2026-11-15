import { CosmicExplorer } from "@/components/CosmicExplorer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("Cosmic Explorer", "Explore a procedural starship simulation with source-linked NASA facts at selected destinations and a handoff to scientific research.", "/cosmic-explorer");

export default function CosmicExplorerPage() {
  return <CosmicExplorer />;
}
