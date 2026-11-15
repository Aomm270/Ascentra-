import { SpectralExplorer } from "@/components/SpectralExplorer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("SPHEREx Spectral Explorer", "Explore measured SPHEREx DR1 All-Sky Cube samples across its 102 spectral channels with wavelength and quality metadata.", "/spectral");

export default function SpectralPage() { return <SpectralExplorer />; }
