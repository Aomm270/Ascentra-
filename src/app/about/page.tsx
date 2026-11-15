import Link from "next/link";
import { ArrowRight, Globe2, Orbit, ScanLine, Telescope } from "lucide-react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("About the SPHEREx Mission", "Learn how NASA SPHEREx surveys the sky in near-infrared light and how independent ASCENTRA presents public archive data.", "/about");

const facts = [
  { n: "0.75–5.0", unit: "μm", label: "Near-infrared coverage" },
  { n: "102", unit: "", label: "Nominal spectral channels" },
  { n: "6", unit: "bands", label: "Detector wavelength bands" },
  { n: "2 years", unit: "planned", label: "All-sky survey mission" },
];

export default function AboutPage() {
  return <div className="subpage">
    <section className="subpage-hero"><div className="eyebrow"><span className="eyebrow-star">✳</span> ABOUT THE MISSION</div><div className="subpage-tag"><Orbit size={13} /> SPHEREx · NASA ASTROPHYSICS</div><h1>Read the universe<br /><span className="gradient-text">in its own light.</span></h1><p>SPHEREx is a NASA space telescope mapping the entire sky in near-infrared light. ASCENTRA makes its public archive easier to explore across place, time and wavelength.</p></section>
    <section className="mission-facts">{facts.map((fact) => <div className="fact-tile" key={fact.label}><strong>{fact.n}<small>{fact.unit}</small></strong><span>{fact.label}</span></div>)}</section>
    <section className="mission-story"><div className="story-visual"><div className="story-orbit story-orbit-one" /><div className="story-orbit story-orbit-two" /><div className="story-star" /><div className="story-beam" /><div className="story-marker"><span>SPHEREx</span></div><div className="story-caption">AN ALL-SKY SPECTRAL SURVEY</div></div><div className="story-copy"><span className="section-kicker">A NEW VIEW OF THE COSMOS</span><h2>One sky.<br />Many wavelengths.</h2><p>SPHEREx is short for the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer. From low Earth orbit, its linear variable filters record near-infrared images at different wavelengths as the telescope surveys the whole sky.</p><p>The survey supports studies of the origin of the universe, the history of galaxy formation, and the abundance of water and biogenic ices in our galaxy.</p><a href="https://www.nasa.gov/spherex/" target="_blank" rel="noreferrer" className="subpage-cta">NASA mission overview <ArrowRight size={13} /></a></div></section>
    <section className="subpage-section"><div className="subpage-section-heading"><h2>How ASCENTRA explores</h2><p>Designed to keep the provenance attached to every view.</p></div><div className="content-grid"><article className="content-card"><div className="card-icon"><Globe2 size={16} /></div><h3>Start with the sky</h3><p>Resolve an object name or enter right ascension and declination. Search the current DR1 or QR3 collections, including their deep-field sets, for images whose sky coverage intersects your region.</p><Link href="/research#observatory">Open the SPHEREx observatory <ArrowRight size={12} /></Link></article><article className="content-card"><div className="card-icon"><ScanLine size={16} /></div><h3>Compare carefully</h3><p>Review image dates and archive wavelength and calibration metadata. Side-by-side and slider views can help inspect a pair; ASCENTRA does not label raw pixel subtraction as a discovery.</p><Link href="/compare">Compare epochs <ArrowRight size={12} /></Link></article><article className="content-card"><div className="card-icon"><Telescope size={16} /></div><h3>Go to the source</h3><p>Each image record links directly to its IRSA product. Scientific measurements and nominal-channel mosaics remain tied to the official processing tools.</p><Link href="/sources">Read the methodology <ArrowRight size={12} /></Link></article></div></section>
    <div className="independent-notice"><strong>ASCENTRA is an independent public-facing exploration interface.</strong><span>It is not an official NASA product and is not affiliated with NASA, JPL or Caltech.</span></div>
  </div>;
}
