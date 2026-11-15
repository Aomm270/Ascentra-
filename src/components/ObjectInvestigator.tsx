"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, Globe2, LoaderCircle, MapPin, Search, Telescope } from "lucide-react";
import { API_BASE, dateLabel, Observation, ObservationResponse, wavelengthLabel } from "@/lib/api";

export function ObjectInvestigator() {
  const [name, setName] = useState("M31");
  const [ra, setRa] = useState("");
  const [dec, setDec] = useState("");
  const [release, setRelease] = useState("dr1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [items, setItems] = useState<Observation[]>([]);
  const [targetName, setTargetName] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryRa = Number(params.get("ra")), queryDec = Number(params.get("dec"));
    if (Number.isFinite(queryRa) && queryRa >= 0 && queryRa < 360 && Number.isFinite(queryDec) && queryDec >= -90 && queryDec <= 90) {
      const target = params.get("target") || "ICRS position";
      setName(target); setRa(String(queryRa)); setDec(String(queryDec)); setTargetName(target);
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setWarning(""); setPreviewFailed(false); setItems([]);
    try {
      const hasRa = Boolean(ra.trim());
      const hasDec = Boolean(dec.trim());
      if (hasRa !== hasDec) throw new Error("Enter both RA and Dec, or clear both coordinate fields to search by name.");
      let resolvedRa = Number.NaN, resolvedDec = Number.NaN;
      let label = targetName || "ICRS position";
      if (hasRa && hasDec) {
        resolvedRa = Number(ra);
        resolvedDec = Number(dec);
      } else {
        if (!name.trim()) throw new Error("Enter an object name or both sky coordinates.");
        label = name.trim();
        const coordinates = name.match(/^\s*(\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (coordinates) { resolvedRa = Number(coordinates[1]); resolvedDec = Number(coordinates[2]); label = "ICRS position"; }
        else {
          const response = await fetch(`${API_BASE}/api/resolve?name=${encodeURIComponent(name.trim())}`, { signal: AbortSignal.timeout(15000) });
          const data = await response.json(); if (!response.ok) throw new Error(data.detail || "Name resolution failed.");
          resolvedRa = data.ra; resolvedDec = data.dec;
        }
      }
      if (!Number.isFinite(resolvedRa) || !Number.isFinite(resolvedDec) || resolvedRa < 0 || resolvedRa >= 360 || resolvedDec < -90 || resolvedDec > 90) throw new Error("Enter RA from 0° to under 360° and Dec from −90° to +90°.");
      setRa(String(resolvedRa)); setDec(String(resolvedDec)); setTargetName(label);
      const params = new URLSearchParams({ ra: String(resolvedRa), dec: String(resolvedDec), radius: "0.1", release, limit: "60" });
      const response = await fetch(`${API_BASE}/api/observations?${params}`, { signal: AbortSignal.timeout(40000) });
      const data = await response.json() as ObservationResponse & { detail?: string };
      if (!response.ok) throw new Error(data.detail || "Archive search failed.");
      setItems(data.observations);
      if (data.truncated) setWarning(data.message || "IRSA reached the result limit; these products may be incomplete.");
      if (!data.observations.length) setError("No image products were returned for this position and release.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The search could not be completed."); }
    finally { setLoading(false); }
  }

  const active = items[0];
  return <div className="subpage">
    <section className="subpage-hero"><div className="eyebrow"><span className="eyebrow-star">✳</span> OBJECT INVESTIGATOR</div><div className="subpage-tag"><Telescope size={13} /> INSPECT THE EVIDENCE</div><h1>Follow a source<br /><span className="gradient-text">through the archive.</span></h1><p>Resolve a known name or enter ICRS coordinates, then inspect real SPHEREx image products, observation timing and reported spectral coverage.</p></section>
    <form className="object-search-card investigate-form" onSubmit={submit}><label className="object-search-input">Object name or coordinate pair<input value={name} onChange={(event) => { setName(event.target.value); setTargetName(""); }} placeholder="e.g. M31 or 10.68, 41.27" /></label><label>Right ascension · degrees<input inputMode="decimal" value={ra} onChange={(event) => { setRa(event.target.value); setTargetName(""); }} placeholder="Optional" /></label><label>Declination · degrees<input inputMode="decimal" value={dec} onChange={(event) => { setDec(event.target.value); setTargetName(""); }} placeholder="Optional" /></label><label>Release<select value={release} onChange={(event) => setRelease(event.target.value)}><option value="dr1">DR1</option><option value="dr1_deep">DR1 Deep</option><option value="qr3">QR3</option><option value="qr3_deep">QR3 Deep</option></select></label><button type="submit" className="primary-button" disabled={loading}>{loading ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}{loading ? "Searching" : "Investigate"}<ArrowRight size={13} /></button></form>
    {error && <div className="query-message is-error" role="status"><span>!</span>{error}</div>}
    {warning && <div className="query-message" role="status"><span>i</span>{warning}</div>}
    {active ? <><div className="investigator-result-count"><span><i /> {items.length} image products · IRSA {active.release}</span><span>{targetName === "ICRS position" ? "Coordinates supplied directly" : "Coordinates resolved by CDS Sesame when a name was used"}</span></div><section className="investigation-result">
      <div className="investigation-image">{previewFailed ? <div className="image-load-empty"><strong>Preview unavailable</strong><span>The archive product remains available as FITS.</span><a href={active.original_url} target="_blank" rel="noreferrer">Open original data <ExternalLink size={12} /></a></div> : <><img src={`${API_BASE}${active.preview_url}?ra=${ra}&dec=${dec}`} alt={`FITS preview for ${targetName}`} onError={() => setPreviewFailed(true)} /><span>VISUAL STRETCH · NOT RAW PIXEL VALUES</span></>}</div>
      <div className="investigation-details"><span className="section-kicker">ARCHIVE RECORD · {active.collection}</span><h2>{targetName || active.target || active.product_id}</h2><p>Image-product metadata supplied by NASA/IPAC IRSA. This search does not return a catalog classification or source flux measurement.</p><div className="meta-line"><span>Product identifier</span><strong>{active.product_id}</strong></div><div className="meta-line"><span>Image center</span><strong><MapPin size={11} /> {active.ra?.toFixed(5) ?? "—"}, {active.dec?.toFixed(5) ?? "—"}°</strong></div><div className="meta-line"><span>Observation date</span><strong>{dateLabel(active.observation_start)}</strong></div><div className="meta-line"><span>Wavelength coverage</span><strong>{wavelengthLabel(active.wavelength_min_um, active.wavelength_max_um)}</strong></div><div className="meta-line"><span>Calibration level</span><strong>{active.calibration_level ? `Level ${active.calibration_level}` : "Not reported"}</strong></div><a className="original-data-button" href={active.original_url} target="_blank" rel="noreferrer"><span><Telescope size={14} /> Open original IRSA product</span><ExternalLink size={13} /></a><Link className="cosmic-research-link" href={`/cosmic-explorer?ra=${encodeURIComponent(ra)}&dec=${encodeURIComponent(dec)}&target=${encodeURIComponent(targetName || active.target || "Research target")}`}><Globe2 size={13} /> View in Cosmic Explorer <ArrowRight size={12} /></Link><div className="candidate-empty"><strong>Candidate assessment unavailable.</strong> This product alone does not establish movement, brightness variability or a new source. A same-channel repeat visit and calibrated source measurements are needed.</div></div>
    </section><section className="subpage-section"><div className="subpage-section-heading"><h2>Products in this field</h2><p>Separate image products can have different observation dates or wavelength coverage.</p></div><div className="source-list">{items.slice(0, 12).map((item) => <div className="source-row" key={item.id}><span>{dateLabel(item.observation_start)}</span><div><strong>{item.product_id}</strong><p>{wavelengthLabel(item.wavelength_min_um, item.wavelength_max_um)} · Calibration {item.calibration_level ? `level ${item.calibration_level}` : "not reported"}</p></div><a href={item.original_url} target="_blank" rel="noreferrer" aria-label="Open original data"><ExternalLink size={14} /></a></div>)}</div></section></> : <section className="empty-discovery investigator-empty"><div className="empty-discovery-icon"><Telescope size={22} /></div><span className="section-kicker" style={{ marginTop: 15 }}>A SOURCE-LED VIEW</span><h2>Start with a name or coordinate.</h2><p>ASCENTRA resolves object names through CDS Sesame, then searches current DR1 or QR3 image products in IRSA. Products are returned as they exist in the archive.</p><Link href="/sources" className="subpage-cta">View data sources <ArrowRight size={13} /></Link></section>}
  </div>;
}
