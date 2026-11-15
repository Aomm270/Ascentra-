"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, Info, Layers3, LoaderCircle, MoveRight, Waves } from "lucide-react";
import { API_BASE, Observation, ObservationResponse, wavelengthLabel } from "@/lib/api";

type SpectralChannel = {
  channel: number;
  detector: number;
  subchannel: number;
  wavelength_um: number;
  wavelength_min_um: number;
  wavelength_max_um: number;
  resolving_power: number | null;
  surface_brightness_mjy_sr: number | null;
  contributing_input_pixels: number;
  flags: number;
  blank_channel: boolean;
  has_measurement: boolean;
};

type SpectralProfile = {
  product_id: string;
  source: string;
  original_url: string;
  retrieved_at: string;
  file_size_bytes: number;
  cached: boolean;
  target: { ra_deg: number; dec_deg: number; coordinate_frame: string };
  sample: { method: string; pixel_x: number; pixel_y: number; pixel_center_ra_deg: number; pixel_center_dec_deg: number; target_to_pixel_center_arcsec: number; pixel_scale_arcsec: number };
  measurement: { quantity: string; unit: string; uncertainty: number | null; uncertainty_note: string; limitations: string[] };
  channel_count: number;
  channels: SpectralChannel[];
};

function numberLabel(value: number | null | undefined, digits = 4) {
  return value == null || !Number.isFinite(value) ? "Unavailable" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function ProfileChart({ channels, selected }: { channels: SpectralChannel[]; selected: number }) {
  const width = 900, height = 260, left = 62, right = 20, top = 20, bottom = 40;
  const measured = channels.filter((item) => item.has_measurement && item.surface_brightness_mjy_sr != null).map((item) => item.surface_brightness_mjy_sr as number);
  if (!measured.length) return <div className="spectral-chart-empty">IRSA returned no usable pixel values at this coordinate.</div>;
  const minimum = Math.min(0, ...measured), maximum = Math.max(...measured);
  const spread = Math.max(maximum - minimum, Math.abs(maximum) * 0.05, 1e-8);
  const lower = minimum - spread * 0.05, upper = maximum + spread * 0.05;
  const x = (channel: number) => left + (channel - 1) / 101 * (width - left - right);
  const y = (value: number) => top + (upper - value) / (upper - lower) * (height - top - bottom);
  const segments: SpectralChannel[][] = [];
  for (const item of channels) {
    if (!item.has_measurement || item.surface_brightness_mjy_sr == null) {
      if (segments.at(-1)?.length) segments.push([]);
      continue;
    }
    if (!segments.length) segments.push([]);
    segments.at(-1)?.push(item);
  }
  const completeSegments = segments.filter((segment) => segment.length);
  return <svg className="spectral-profile-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Measured SPHEREx All-Sky Cube surface brightness at the selected sky coordinate across its 102 spectral channels">
    {[0, 1, 2, 3].map((index) => {
      const value = upper - (upper - lower) * index / 3;
      const yy = y(value);
      return <g key={index}><line x1={left} y1={yy} x2={width - right} y2={yy} className="spectral-grid-line" /><text x={left - 9} y={yy + 4} textAnchor="end" className="spectral-chart-label">{value.toExponential(2)}</text></g>;
    })}
    {[1, 17, 34, 51, 68, 85, 102].map((channel) => <g key={channel}><line x1={x(channel)} y1={top} x2={x(channel)} y2={height - bottom} className="spectral-grid-line vertical" /><text x={x(channel)} y={height - 18} textAnchor="middle" className="spectral-chart-label">{channel}</text></g>)}
    {completeSegments.map((segment, index) => segment.length > 1 && <polyline key={index} points={segment.map((item) => `${x(item.channel)},${y(item.surface_brightness_mjy_sr as number)}`).join(" ")} className="spectral-profile-line" />)}
    {channels.filter((item) => item.has_measurement && item.surface_brightness_mjy_sr != null).map((item) => <circle key={item.channel} cx={x(item.channel)} cy={y(item.surface_brightness_mjy_sr as number)} r={item.channel === selected ? 5 : 2.2} className={item.channel === selected ? "spectral-profile-point selected" : "spectral-profile-point"}><title>{`Channel ${item.channel} · ${item.wavelength_um.toFixed(4)} μm · ${item.surface_brightness_mjy_sr?.toExponential(5)} MJy/sr · NHITS ${item.contributing_input_pixels} · FLAGS ${item.flags}`}</title></circle>)}
    <text x={left} y={14} className="spectral-chart-label">MJy/sr · cube pixel value</text>
    <text x={width / 2} y={height - 2} textAnchor="middle" className="spectral-chart-label">Nominal SPHEREx channel · measured wavelength is shown in the readout</text>
  </svg>;
}

export function SpectralExplorer() {
  const [ra, setRa] = useState("210.80225");
  const [dec, setDec] = useState("54.34894");
  const [release, setRelease] = useState("dr1_cube");
  const [channel, setChannel] = useState(1);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [profile, setProfile] = useState<SpectralProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [error, setError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [warning, setWarning] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raParam = params.get("ra"), decParam = params.get("dec");
    const nextRa = raParam == null ? Number.NaN : Number(raParam);
    const nextDec = decParam == null ? Number.NaN : Number(decParam);
    if (Number.isFinite(nextRa) && nextRa >= 0 && nextRa < 360) setRa(String(nextRa));
    if (Number.isFinite(nextDec) && nextDec >= -90 && nextDec <= 90) setDec(String(nextDec));
  }, []);

  async function load(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setWarning(""); setProfileError(""); setProfile(null); setObservation(null); setPreviewFailed(false);
    let searchedProduct: Observation | null = null;
    try {
      const params = new URLSearchParams({ ra, dec, radius: "0.1", release, limit: "40" });
      const response = await fetch(`${API_BASE}/api/observations?${params}`, { signal: AbortSignal.timeout(70000) });
      const data = await response.json() as ObservationResponse & { detail?: string };
      if (!response.ok) throw new Error(data.detail || "Archive search failed.");
      const selected = data.observations[0] ?? null;
      searchedProduct = selected;
      setObservation(selected);
      if (data.truncated) setWarning(data.message || "IRSA reached the result limit; this product list may be incomplete.");
      if (!selected) { setError("No SPHEREx products were returned for this region."); return; }
      if (release === "dr1_cube") {
        setLoadingProfile(true);
        const profileResponse = await fetch(`${API_BASE}/api/spectral/profile/${encodeURIComponent(selected.id)}?ra=${encodeURIComponent(ra)}&dec=${encodeURIComponent(dec)}`, { signal: AbortSignal.timeout(90000) });
        const profileData = await profileResponse.json() as SpectralProfile & { detail?: string };
        if (!profileResponse.ok) throw new Error(profileData.detail || "The All-Sky Cube profile could not be read.");
        setProfile(profileData);
      }
    } catch (reason) {
      setProfile(null);
      const message = reason instanceof Error ? reason.message : "The archive or spectral profile could not be reached.";
      if (release === "dr1_cube" && searchedProduct) setProfileError(message);
      else setError(message);
    } finally { setLoading(false); setLoadingProfile(false); }
  }

  const selected = useMemo(() => profile?.channels.find((item) => item.channel === channel) ?? null, [profile, channel]);
  const bandLinks = [
    ["B1", "0.75–1.09 μm"], ["B2", "1.10–1.62 μm"], ["B3", "1.63–2.41 μm"], ["B4", "2.42–3.82 μm"], ["B5", "3.83–4.41 μm"], ["B6", "4.42–5.00 μm"],
  ];

  return <div className="subpage spectral-page">
    <section className="subpage-hero"><div className="eyebrow"><span className="eyebrow-star">✳</span> SPECTRAL EXPLORER</div><div className="subpage-tag"><Waves size={13} /> 0.75–5.0 MICRONS</div><h1>102 windows<br />into <span className="gradient-text">the infrared.</span></h1><p>Read real DR1 All-Sky Cube pixel samples against IRSA’s 102-row wavelength table. Values remain surface brightness samples, with the input-pixel counts and quality flags alongside them.</p></section>

    <section className="channel-panel"><div className="channel-heading"><div><span className="section-kicker">IRSA DR1 ALL-SKY CUBE</span><h2>Measured channel profile</h2><p>{profile ? `Sampled at RA ${profile.target.ra_deg.toFixed(5)}°, Dec ${profile.target.dec_deg.toFixed(5)}° · ${profile.sample.pixel_scale_arcsec}″ pixels` : "Search a sky position in the archive to load its actual cube values."}</p></div><div className="channel-number">{String(channel).padStart(3, "0")}<small> / 102</small></div></div>
      <input aria-label="Select spectral channel" className="channel-slider" type="range" min="1" max="102" value={channel} disabled={!profile} onChange={(event) => setChannel(Number(event.target.value))} />
      <div className="channel-ticks"><span>01 · short-wave</span><span>17</span><span>34</span><span>51–52 · blank</span><span>68</span><span>85</span><span>102 · long-wave</span></div>
      <div className="channel-band-readout"><span>SELECTED CHANNEL</span><strong>{selected ? `${String(selected.channel).padStart(3, "0")} · ${selected.wavelength_um.toFixed(4)} μm · ${numberLabel(selected.surface_brightness_mjy_sr, 6)} MJy/sr` : `${String(channel).padStart(3, "0")} · Load an All-Sky Cube profile`}</strong></div>
      {loadingProfile && <div className="spectral-profile-loading"><LoaderCircle className="spin" size={15} /> Reading FITS headers and selected pixel values from IRSA…</div>}
      {profileError && <div className="query-message is-error" role="status"><span>!</span>{profileError}</div>}
      {profile && <><div className="spectral-chart-frame"><ProfileChart channels={profile.channels} selected={channel} /></div><div className="spectral-selected-meta"><div><span>ACTUAL CHANNEL CENTER</span><strong>{selected ? `${selected.wavelength_um.toFixed(4)} μm` : "—"}</strong><small>{selected ? `${selected.wavelength_min_um.toFixed(4)}–${selected.wavelength_max_um.toFixed(4)} μm edges · D${selected.detector} subchannel ${selected.subchannel}` : "No channel row"}</small></div><div><span>SAMPLED CUBE VALUE</span><strong>{selected?.surface_brightness_mjy_sr == null ? "No measurement" : `${selected.surface_brightness_mjy_sr.toExponential(4)} MJy/sr`}</strong><small>{selected?.blank_channel ? "Blank channel in DR1" : selected?.has_measurement ? `NHITS ${selected.contributing_input_pixels} · FLAGS ${selected.flags}` : "No contributing input pixel"}</small></div><div><span>COORDINATE SAMPLING</span><strong>Pixel {profile.sample.pixel_x}, {profile.sample.pixel_y}</strong><small>{numberLabel(profile.sample.target_to_pixel_center_arcsec, 2)}″ from requested position · {profile.measurement.uncertainty == null ? "no variance plane" : `± ${profile.measurement.uncertainty}`}</small></div></div><div className="spectral-profile-provenance"><span>{profile.source}</span><span>{profile.channel_count} channels · retrieved {new Date(profile.retrieved_at).toLocaleString()}</span><span>FITS tile {Math.round(profile.file_size_bytes / 1_000_000)} MB · selected ranges only</span><a href={profile.original_url} target="_blank" rel="noreferrer">Open original FITS <ExternalLink size={12} /></a><Link className="cosmic-research-link" href={`/cosmic-explorer?ra=${encodeURIComponent(String(profile.target.ra_deg))}&dec=${encodeURIComponent(String(profile.target.dec_deg))}&target=SPHEREx%20cube%20sample`}><Layers3 size={12} /> View sampled position in Cosmic Explorer <ArrowRight size={11} /></Link></div><div className="spectral-caveat"><Info size={14} /><span>{profile.measurement.limitations.join(" ")} This graph uses a linear display range; inspect the values, NHITS and FLAGS in the readout for each channel.</span></div></>}
      {!profile && !loadingProfile && <div className="spectral-caveat"><Info size={14} /><span>DR1 All-Sky Cube channels 51 and 52 are blank. ASCENTRA returns their actual channel table, flags, and input-pixel counts. These cube values are not source-integrated photometry, and this product has no per-pixel variance plane.</span></div>}
    </section>

    <div className="channel-card-grid"><article className="content-card channel-info-card"><div className="card-icon"><Layers3 size={16} /></div><span className="section-kicker" style={{ marginTop: 11 }}>SPECTRAL IMAGE PRODUCTS</span><h3>Inspect a separate observation</h3><p>DR1 and QR3 spectral-image MEFs have position-dependent wavelength. Their cutouts are useful for image inspection but do not produce a 102-plane source spectrum by themselves.</p></article><article className="content-card channel-info-card"><div className="card-icon"><Waves size={16} /></div><span className="section-kicker" style={{ marginTop: 11 }}>CALIBRATED POINT-SOURCE SPECTRA</span><h3>Use IRSA forced photometry</h3><p>The official tool applies the SPHEREx PSF, variance, local background, flags and pixel solid angle to return calibrated source flux.</p><a href="https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html" target="_blank" rel="noreferrer">Spectrophotometry documentation <ExternalLink size={12} /></a></article></div>

    <section className="subpage-section"><div className="subpage-section-heading"><div><h2>Inspect a region</h2><p>Search the actual IRSA archive, then sample the selected cube product at your coordinates.</p></div><a className="subpage-cta" href="https://irsa.ipac.caltech.edu/applications/SPHEREx/" target="_blank" rel="noreferrer">IRSA Data Explorer <ExternalLink size={12} /></a></div>
      <form className="object-search-card spectral-search" onSubmit={load}><label>RA · degrees<input required inputMode="decimal" value={ra} onChange={(event) => setRa(event.target.value)} /></label><label>Dec · degrees<input required inputMode="decimal" value={dec} onChange={(event) => setDec(event.target.value)} /></label><label>Data product<select value={release} onChange={(event) => setRelease(event.target.value)}><option value="dr1_cube">DR1 All-Sky Cube · 102 channels</option><option value="dr1">DR1 spectral images</option><option value="dr1_deep">DR1 Deep spectral images</option><option value="qr3">QR3 spectral images</option><option value="qr3_deep">QR3 Deep spectral images</option></select></label><button className="primary-button" disabled={loading}>{loading ? <LoaderCircle size={15} className="spin" /> : <Waves size={15} />}{loading ? "Reading archive" : "Load real data"}<ArrowRight size={13} /></button></form>
      {error && <div className="query-message is-error" role="status"><span>!</span>{error}</div>}
      {warning && <div className="query-message" role="status"><span>i</span>{warning}</div>}
      {observation && <div className="spectrum-product">{release === "dr1_cube" ? <div className="spectral-cube-tile"><Waves size={27} /><strong>102-channel FITS cube</strong><span>One HEALPix tile · sampled selectively on the backend</span></div> : <div className="spectrum-product-image">{previewFailed ? <div className="image-load-empty"><strong>Preview unavailable</strong><span>Open the archive FITS image instead.</span><a href={observation.original_url} target="_blank" rel="noreferrer">Open original data <ExternalLink size={12} /></a></div> : <img src={`${API_BASE}${observation.preview_url}?ra=${ra}&dec=${dec}`} alt="SPHEREx FITS-derived preview" onError={() => setPreviewFailed(true)} />}</div>}<div className="spectrum-product-meta"><span className="section-kicker">REAL IRSA PRODUCT · {observation.release}</span><strong>{observation.product_id}</strong><span className="product-wavelength"><Waves size={14} />{wavelengthLabel(observation.wavelength_min_um, observation.wavelength_max_um)}</span><p>{release === "dr1_cube" ? "The wavelength centers and edges are read from this product’s SPECTRAL_CHANNELS extension. The cube is not downloaded in full." : "Reported product coverage; a single Level 2 image has position-dependent wavelength."}</p><a href={observation.original_url} target="_blank" rel="noreferrer">Open original FITS <ExternalLink size={12} /></a></div></div>}
    </section>
    <section className="subpage-section"><div className="subpage-section-heading"><div><h2>Six detector bands</h2><p>Mission-reported coverage and resolving power.</p></div></div><div className="band-grid">{bandLinks.map(([band, range], index) => <div className="band-tile" key={band}><span>BAND {band.slice(1)}</span><strong>{range}</strong><i style={{ background: `linear-gradient(90deg,${["#7b7dec", "#758de9", "#65abdd", "#64c5be", "#c1bf76", "#d89286"][index]},transparent)` }} /></div>)}</div></section>
    <a className="inline-utility" href="https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html" target="_blank" rel="noreferrer"><span>For a science-quality source spectrum, use IRSA Spectrophotometry.</span><MoveRight size={14} /><ExternalLink size={12} /></a>
  </div>;
}
