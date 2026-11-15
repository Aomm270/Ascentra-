"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowDown, ArrowRight, AudioLines, Compass, Database, Layers3, MapPin, Orbit, ScanSearch, Waves } from "lucide-react";
import { useRef } from "react";

const SPHEREX_FIRST_IMAGE = "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/pia/pia26/pia26280/PIA26280.jpg?fit=clip&h=995&w=1536";
const SPHEREX_DUST_IMAGE = "https://assets.science.nasa.gov/dynamicimage/assets/science/cds/open-science/article-media/spherex-cloud-1.jpg?fit=clip&h=1000&w=1500";
const WEBB_PILLARS_IMAGE = "https://assets.science.nasa.gov/dynamicimage/assets/science/missions/webb/science/2022/10/STScI-01GGF8H15VZ09MET9HFBRQX4S3.png?fit=clip&h=1600&w=924";
const NASA_FIRST_IMAGES = "https://science.nasa.gov/photojournal/first-images-from-nasas-spherex/";
const NASA_SPHEREX_MAP = "https://science.nasa.gov/open-science/spherex-universe-map/";
const NASA_PILLARS = "https://science.nasa.gov/asset/webb/pillars-of-creation-nircam-image/";

function Reveal({ children, className = "", ariaLabel }: { children: React.ReactNode; className?: string; ariaLabel?: string }) {
  const reducedMotion = useReducedMotion();
  return <motion.div
    className={className}
    aria-label={ariaLabel}
    role={ariaLabel ? "group" : undefined}
    initial={reducedMotion ? false : { opacity: 0, y: 24 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.16 }}
    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
  >{children}</motion.div>;
}

const channelMarks = Array.from({ length: 102 }, (_, index) => index);

export function AscentraHome() {
  const heroRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const imageY = useTransform(scrollYProgress, [0, 1], ["0%", "14%"]);

  return <div className="ascentra-home">
    <section className="home-hero" id="chapter-01" ref={heroRef} aria-labelledby="home-title">
      <motion.div className="home-hero-image" style={{ y: reducedMotion ? 0 : imageY }}>
        <Image src={SPHEREX_FIRST_IMAGE} alt="A wide early SPHEREx infrared exposure rendered in a palette of visible colors" fill priority unoptimized sizes="100vw" />
      </motion.div>
      <div className="home-hero-shade" />
      <div className="home-hero-orbit home-hero-orbit-a" aria-hidden="true" />
      <div className="home-hero-orbit home-hero-orbit-b" aria-hidden="true" />
      <div className="home-hero-content">
        <span className="home-overline"><i /> CHAPTER 01 · THE UNKNOWN</span>
        <h1 id="home-title">THE UNIVERSE<br />HAS MORE <br className="home-title-mobile-break" /><em>TO REVEAL.</em></h1>
        <p>Explore the invisible universe through infrared observations, scientific intelligence and immersive cosmic exploration.</p>
        <div className="home-hero-actions">
          <Link className="home-button home-button-primary" href="/research">Enter scientific research <ArrowRight size={15} /></Link>
          <Link className="home-button home-button-quiet" href="/cosmic-explorer"><Orbit size={15} /> Launch Cosmic Explorer</Link>
        </div>
        <a className="home-scroll-cue" href="#chapter-02"><span>BEGIN THE JOURNEY</span><ArrowDown size={14} /></a>
      </div>
      <div className="home-image-credit"><span>EARLY SPHEREx EXPOSURE · UNCALIBRATED TEST IMAGE</span><a href={NASA_FIRST_IMAGES} target="_blank" rel="noreferrer">NASA / JPL-Caltech · captured 27 March 2025 ↗</a></div>
      <span className="home-chapter-index">01 <i /> 07</span>
    </section>

    <section className="home-intro-band" aria-label="ASCENTRA overview">
      <span>AN EXPLORATION OF PLACE, LIGHT &amp; TIME</span>
      <p>Every point of light carries a story. We begin by learning how to read it.</p>
      <Link href="/about">The mission <ArrowRight size={13} /></Link>
    </section>

    <nav className="home-chapter-nav" aria-label="Journey chapters">
      <a href="#chapter-01"><span>01</span> The Unknown</a>
      <a href="#chapter-02"><span>02</span> The Observatory</a>
      <a href="#chapter-03"><span>03</span> The Observations</a>
      <a href="#chapter-04"><span>04</span> Decoding</a>
      <a href="#chapter-05"><span>05</span> Time &amp; Motion</a>
      <a href="#chapter-06"><span>06</span> Discoveries</a>
      <a href="#chapter-07"><span>07</span> Beyond the Screen</a>
    </nav>

    <section className="home-chapter home-observatory" id="chapter-02">
      <Reveal className="chapter-copy">
        <span className="chapter-marker"><i>02</i><span>THE OBSERVATORY</span></span>
        <h2>Light beyond<br />the visible.</h2>
        <p className="chapter-lede">The universe does not stop at what our eyes can see.</p>
        <p>SPHEREx maps the whole sky in 102 infrared wavelengths. Different wavelengths reveal different signatures in stars, galaxies, gas and dust. ASCENTRA connects that mission to the public NASA/IPAC archive, one measured image product at a time.</p>
        <div className="chapter-factline"><strong>102</strong><span>nominal infrared channels<br />across the SPHEREx survey</span></div>
        <Link className="chapter-link" href="/research#observatory">Step into the observatory <ArrowRight size={14} /></Link>
        <a className="chapter-next" href="#chapter-03">Continue to the observations <ArrowDown size={12} /></a>
      </Reveal>
      <Reveal className="chapter-visual chapter-visual-observatory">
        <figure className="home-image-figure">
          <Image src={SPHEREX_DUST_IMAGE} alt="A SPHEREx early test image showing an interstellar dust cloud in one infrared wavelength" fill unoptimized sizes="(max-width: 850px) 100vw, 55vw" />
          <figcaption><span>3.29 μm · ONE INFRARED WAVELENGTH</span><a href={NASA_SPHEREX_MAP} target="_blank" rel="noreferrer">NASA / JPL-Caltech · early test image ↗</a></figcaption>
        </figure>
        <div className="infrared-note"><Waves size={14} /><span>Invisible infrared data are mapped to visible color for display. Color here is a visualization choice.</span></div>
        <span className="visual-side-label">A DIFFERENT WAY OF SEEING</span>
      </Reveal>
    </section>

    <section className="home-observations" id="chapter-03" aria-labelledby="observations-title">
      <Reveal className="observations-copy">
        <span className="chapter-marker"><i>03</i><span>THE OBSERVATIONS</span></span>
        <h2 id="observations-title">A sky recorded<br />visit by visit.</h2>
        <p>SPHEREx images become archive products with observation times, wavelength coverage and other metadata where reported. ASCENTRA keeps those records beside each display preview and links back to the original FITS product.</p>
        <Link className="chapter-link" href="/research#observatory">Open the live observation search <ArrowRight size={14} /></Link>
        <a className="chapter-next" href="#chapter-04">Continue to decoding <ArrowDown size={12} /></a>
      </Reveal>
      <Reveal className="observation-flow" ariaLabel="Conceptual workflow from a selected sky region to an IRSA product record and its FITS provenance">
        <div className="observation-flow-heading"><span>FROM SKY POSITION TO SOURCE RECORD</span><small>WORKFLOW MAP · NOT A SAMPLE OBSERVATION</small></div>
        <div className="observation-flow-step"><span>01</span><MapPin size={16} /><div><strong>Select a sky region</strong><small>Coordinates and filters chosen by the visitor</small></div></div>
        <div className="observation-flow-connector" aria-hidden="true" />
        <div className="observation-flow-step"><span>02</span><Database size={16} /><div><strong>Query the IRSA archive</strong><small>Returned product records and reported metadata</small></div></div>
        <div className="observation-flow-connector" aria-hidden="true" />
        <div className="observation-flow-step"><span>03</span><Layers3 size={16} /><div><strong>Inspect image and provenance</strong><small>Display preview, original FITS and source link</small></div></div>
        <p>Available fields vary by product. An archive record is not, by itself, a source measurement or discovery.</p>
      </Reveal>
    </section>

    <section className="home-chapter home-decoding" id="chapter-04">
      <Reveal className="decoding-visual">
        <figure className="home-image-figure decoding-image">
          <Image src={WEBB_PILLARS_IMAGE} alt="NASA Webb near-infrared view of the Pillars of Creation in the Eagle Nebula" fill unoptimized sizes="(max-width: 850px) 100vw, 42vw" />
          <figcaption><span>COMPOSITE · MULTIPLE NIRCam FILTERS</span><a href={NASA_PILLARS} target="_blank" rel="noreferrer">NASA / ESA / CSA / STScI ↗</a></figcaption>
        </figure>
        <div className="wavelength-ribbon" aria-label="A visual scale representing SPHEREx's 102 nominal infrared channels">
          <div>{channelMarks.map((index) => <i key={index} style={{ height: `${7 + ((index * 13) % 25)}px`, backgroundColor: `hsl(${188 + index * 1.34} 54% 69% / .82)` }} />)}</div>
          <span><small>NEAR INFRARED</small><small>102 CHANNELS · VISUAL SCALE</small><small>LONGER WAVELENGTH</small></span>
        </div>
      </Reveal>
      <Reveal className="chapter-copy decoding-copy">
        <span className="chapter-marker"><i>04</i><span>DECODING THE COSMOS</span></span>
        <h2>Read the<br />light’s signature.</h2>
        <p className="chapter-lede">A spectrum is a story written across wavelength.</p>
        <p>Explore the real channel table and sampled cube values when they are available. Then follow a source into archive records, catalogue context and careful image analysis—without turning a display color into a measurement.</p>
        <div className="chapter-links-list">
          <Link href="/spectral"><span><AudioLines size={16} /> SPECTRAL EXPLORER</span><ArrowRight size={14} /></Link>
          <Link href="/investigate"><span><ScanSearch size={16} /> OBJECT INVESTIGATOR</span><ArrowRight size={14} /></Link>
          <Link href="/intelligence"><span><Compass size={16} /> COSMIC INTELLIGENCE</span><ArrowRight size={14} /></Link>
        </div>
        <a className="chapter-next" href="#chapter-05">Continue to time and motion <ArrowDown size={12} /></a>
      </Reveal>
    </section>

    <section className="home-chronology" id="chapter-05">
      <Reveal className="chronology-heading">
        <span className="chapter-marker"><i>05</i><span>TIME AND MOTION</span></span>
        <h2>The sky is not<br /><em>a still image.</em></h2>
        <p>Observations arrive at different times, through different instruments and under different conditions. Follow a target through the archive while keeping those differences visible.</p>
        <Link className="chapter-link" href="/motion">Explore motion &amp; chronology <ArrowRight size={14} /></Link>
        <a className="chapter-next" href="#chapter-06">Continue to discoveries <ArrowDown size={12} /></a>
      </Reveal>
      <Reveal className="chronology-visual" ariaLabel="Conceptual diagram of observations across time">
        <div className="chronology-axis"><span>EARLIER</span><i /><i /><i /><i /><i /><span>LATER</span></div>
        <div className="chronology-events"><div><b>01</b><span>OBSERVATION<br />SOURCE + TIME</span></div><div><b>02</b><span>COMPATIBILITY<br />BAND + QUALITY</span></div><div><b>03</b><span>ANALYSIS<br />MEASURED CHANGE</span></div></div>
        <p>Conceptual workflow · plotted measurements appear only after compatible observations are retrieved and analyzed.</p>
      </Reveal>
    </section>

    <section className="home-beyond" id="chapter-06">
      <Reveal className="beyond-heading">
        <span className="chapter-marker"><i>06</i><span>THE DISCOVERIES</span></span>
        <h2>Curiosity needs<br />good evidence.</h2>
        <p>Interesting does not always mean confirmed. ASCENTRA leaves discovery feeds empty until the observations support a defensible candidate.</p>
      </Reveal>
      <Reveal className="beyond-note">
        <span className="beyond-symbol">∴</span>
        <span className="section-kicker">THE VALUE OF AN EMPTY RESULT</span>
        <p>No verified candidate is currently listed in the discovery feed. Explore published astrometry and ephemerides for the ED138 benchmark, or inspect the method behind every result.</p>
        <div><Link href="/discoveries">Open discoveries <ArrowRight size={13} /></Link><Link href="/tno-lab">Investigate 2026 ED138 <ArrowRight size={13} /></Link></div>
        <a className="chapter-next" href="#chapter-07">Continue beyond the screen <ArrowDown size={12} /></a>
      </Reveal>
    </section>

    <section className="home-explorer" id="chapter-07">
      <div className="home-explorer-stars" aria-hidden="true" />
      <Reveal className="explorer-copy">
          <span className="chapter-marker"><i>07</i><span>BEYOND THE SCREEN</span></span>
        <h2>From measured sky<br />to open <em>space.</em></h2>
        <p>Leave the research console and take the helm. Cosmic Explorer is a separate procedural simulation with its own destinations, missions and NASA-sourced briefings at arrival.</p>
        <div className="explorer-actions"><Link className="home-button home-button-primary" href="/cosmic-explorer">Enter Cosmic Explorer <ArrowRight size={15} /></Link><Link className="chapter-link" href="/research">Return to the observatory</Link></div>
      </Reveal>
      <div className="explorer-radar" aria-hidden="true"><div /><div /><div /><i /><span>PROCEDURAL FLIGHT SPACE</span></div>
      <div className="home-independent-note">Research uses archived observations. Explorer scenery is a simulation. ASCENTRA is an independent public-facing interface, not an official NASA product.</div>
    </section>
  </div>;
}
