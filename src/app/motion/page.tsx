import { MotionAnalytics } from "@/components/MotionAnalytics";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("Astronomical Motion Analytics", "Compare compatible SPHEREx observation epochs, inspect source tracks and review astrometric uncertainty and provenance.", "/motion");

export default function MotionPage() {
  return <MotionAnalytics />;
}
