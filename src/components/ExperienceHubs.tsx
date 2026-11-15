import Link from "next/link";
import { Activity, ArrowRight, AudioLines, Orbit, ScanSearch, Telescope, Waves } from "lucide-react";
import { ExploreDashboard } from "@/components/ExploreDashboard";

const intelligenceRoutes = [
  { number: "01", title: "Spectral Intelligence", subtitle: "Read the 102-channel cube where samples exist.", detail: "Inspect wavelength centers, sampled surface brightness, NHITS and FLAGS from the returned DR1 tile.", href: "/spectral", icon: Waves, tone: "violet" },
  { number: "02", title: "Object Investigator", subtitle: "Follow an archive source back to its record.", detail: "Search by name or ICRS position, inspect image products and open original IRSA data.", href: "/investigate", icon: ScanSearch, tone: "blue" },
  { number: "03", title: "Motion Analytics", subtitle: "Measure only what compatible epochs support.", detail: "Select same-band observations, inspect source tracks and review uncertainty and quality limits.", href: "/motion", icon: Activity, tone: "gold" },
  { number: "04", title: "TNO Intelligence Lab", subtitle: "Published positions beside JPL ephemerides.", detail: "Review the ED138 observation ledger, orbital solution and prediction provenance.", href: "/tno-lab", icon: Orbit, tone: "rose" },
];

export function ResearchHub() {
  return <div className="research-route">
    <div className="research-route-prelude"><span>CHAPTER 02 · THE OBSERVATORY</span><span>NASA/IPAC IRSA · PUBLIC ARCHIVE</span></div>
    <div id="observatory"><ExploreDashboard mode="explore" /></div>
    <section className="research-route-tail"><div><span>CONTINUE THE INVESTIGATION</span><h2>From one image to a wider view.</h2></div><div className="research-tail-links"><Link href="/compare">Compare returned epochs <ArrowRight size={13} /></Link><Link href="/spectral">Explore spectral channels <ArrowRight size={13} /></Link><Link href="/sources">Read data provenance <ArrowRight size={13} /></Link></div></section>
  </div>;
}

export function IntelligenceHub() {
  return <div className="intelligence-page">
    <section className="intelligence-masthead">
      <span className="chapter-marker"><i>04</i><span>DECODING THE COSMOS</span></span>
      <p className="intelligence-index">COSMIC INTELLIGENCE · ASCENTRA RESEARCH</p>
      <h1>Every signal<br />needs <em>context.</em></h1>
      <p className="intelligence-lede">A set of connected tools for reading light, matching positions and following observations through time—while keeping the source and limits attached.</p>
      <Link className="chapter-link" href="/research#observatory"><Telescope size={14} /> Begin with an archive observation <ArrowRight size={14} /></Link>
    </section>
    <section className="intelligence-module-list" aria-label="Scientific intelligence modules">
      {intelligenceRoutes.map(({ number, title, subtitle, detail, href, icon: Icon, tone }) => <Link className={`intelligence-module ${tone}`} key={href} href={href}>
        <span className="intelligence-module-number">{number}</span><span className="intelligence-module-icon"><Icon size={19} /></span><span className="intelligence-module-copy"><small>{subtitle}</small><strong>{title}</strong><span>{detail}</span></span><ArrowRight className="intelligence-module-arrow" size={17} />
      </Link>)}
    </section>
    <aside className="intelligence-method-note"><AudioLines size={16} /><p><strong>Evidence remains separated from interpretation.</strong> A cube sample is not source photometry, a positional match is not an identity, and a candidate track is not a confirmed moving object.</p><Link href="/sources">Read the method <ArrowRight size={12} /></Link></aside>
    <section className="intelligence-discovery-link"><div><span>CHAPTER 06 · THE DISCOVERIES</span><h2>Follow a question<br />to its evidence.</h2></div><Link href="/discoveries">Open the Discovery Centre <ArrowRight size={14} /></Link></section>
  </div>;
}
