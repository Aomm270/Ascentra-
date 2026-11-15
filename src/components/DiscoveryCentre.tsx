"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CalendarDays, CircleHelp, Filter, ScanSearch, Sparkles } from "lucide-react";

const categories = ["All categories", "Possible motion", "Brightness variation", "New sources", "Spectral interest", "Unusual regions"];

export function DiscoveryCentre() {
  const [category, setCategory] = useState(categories[0]);
  const [date, setDate] = useState("");
  return <div className="subpage">
    <section className="subpage-hero"><div className="eyebrow"><span className="eyebrow-star">✳</span> THE DISCOVERY CENTRE</div><div className="subpage-tag"><Sparkles size={13} /> EVIDENCE FIRST</div><h1>Interesting skies.<br /><span className="gradient-text">Honest signals.</span></h1><p>ASCENTRA only lists candidates when observation data and quality checks support them. There are no prefilled discoveries or synthetic source claims.</p></section>
    <section className="filter-bar"><div className="filter-label"><Filter size={14} /><span>DISCOVERY FILTERS</span></div><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Observation date</span><span className="filter-date"><CalendarDays size={13} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></span></label><button className="filter-clear" onClick={() => { setCategory(categories[0]); setDate(""); }}>Clear filters</button></section>
    <section className="empty-discovery"><div className="empty-discovery-icon"><Activity size={23} /></div><span className="section-kicker" style={{ marginTop: 15 }}>NO VERIFIED CANDIDATES</span><h2>Nothing to report yet.</h2><p>{category !== categories[0] || date ? "The selected filters have no verified candidates. The discovery feed will stay empty until repeat observations pass compatibility and quality checks." : "A useful change search needs aligned visits, matching wavelength coverage, comparable calibration, variance and PSF checks. This release has not produced a verified candidate set for this view."}</p><Link href="/compare" className="subpage-cta"><ScanSearch size={14} /> Compare a region <ArrowRight size={13} /></Link></section>
    <div className="candidate-method-note"><CircleHelp size={14} /><p><strong>Why an empty feed is the scientific choice.</strong> A position shift alone does not prove motion, and fluxes from different wavelength channels are not a time series. Candidate labels require a verified same-band comparison and follow-up checks.</p></div>
  </div>;
}
