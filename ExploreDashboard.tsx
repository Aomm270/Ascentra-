"use client";

import { FormEvent, MouseEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowDownUp, ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Clock3, ExternalLink, Expand, Focus, Globe2, Layers3, LoaderCircle, MapPin, Minus, Pause, Play, Plus, ScanSearch, Search, SlidersHorizontal, Sparkles, Telescope, Waves } from "lucide-react";
import { API_BASE, comparablePair, dateLabel, dateTimeLabel, Observation, ObservationResponse, PreviewStretch, previewUrl, wavelengthLabel } from "@/lib/api";

type Mode = "explore" | "compare";
type ViewMode = "slider" | "side" | "difference";
type SearchCriteria = { ra: number; dec: number; radius: string; release: string; band: string; fromDate: string; toDate: string };
type PreviewMetadata = { preview_id: string; width: number; height: number; display_width: number; display_height: number; fits_shape: number[]; plane_count: number; selected_plane_indices: number[]; extensions: Array<{ name: string; type: string; shape: number[]; bunit: string | null }>; hdu: string; bunit: string | null; finite_pixel_count: number; invalid_pixel_count: number; data_min: number; data_max: number; background_median: number; background_mad: number; display_min: number; display_max: number; display_min_percentile: number; display_max_percentile: number; stretch: PreviewStretch; contrast: number; wcs: { available: boolean; ctype?: string[]; coordinate_frame?: string; center_ra_deg?: number; center_dec_deg?: number; pixel_scale_arcsec?: number[] } };
type WcsGrid = { width: number; height: number; paths: Array<{ axis: "ra" | "dec"; value_deg: number; points: number[][] }> };

const bandOptions = [
  { label: "All wavelengths", min: "", max: "" },
  { label: "Band 1 · 0.75–1.09 μm", min: "0.75", max: "1.09" },
  { label: "Band 2 · 1.10–1.62 μm", min: "1.10", max: "1.62" },
  { label: "Band 3 · 1.63–2.41 μm", min: "1.63", max: "2.41" },
  { label: "Band 4 · 2.42–3.82 μm", min: "2.42", max: "3.82" },
  { label: "Band 5 · 3.83–4.41 μm", min: "3.83", max: "4.41" },
  { label: "Band 6 · 4.42–5.00 μm", min: "4.42", max: "5.00" },
];

function formatCoord(value: number | null, suffix: string) {
  return value == null ? "—" : `${value.toFixed(5)}° ${suffix}`;
}

function formatRaHms(degrees: number) {
  const totalSeconds = ((degrees / 15 * 3600) % 86400 + 86400) % 86400;
  const hours = Math.floor(totalSeconds / 3600), minutes = Math.floor((totalSeconds % 3600) / 60), seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${seconds.toFixed(2).padStart(5, "0")}s`;
}

function formatDecDms(degrees: number) {
  const sign = degrees < 0 ? "−" : "+", absolute = Math.abs(degrees);
  const whole = Math.floor(absolute), minutesFloat = (absolute - whole) * 60, minutes = Math.floor(minutesFloat), seconds = (minutesFloat - minutes) * 60;
  return `${sign}${String(whole).padStart(2, "0")}° ${String(minutes).padStart(2, "0")}′ ${seconds.toFixed(1).padStart(4, "0")}″`;
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return <div className="meta-line"><span>{label}</span><strong>{value}</strong></div>;
}

export function ExploreDashboard({ mode = "explore" }: { mode?: Mode }) {
  const router = useRouter();
  const [ra, setRa] = useState("210.80225");
  const [dec, setDec] = useState("54.34894");
  const [name, setName] = useState("");
  const [radius, setRadius] = useState("0.1");
  const [release, setRelease] = useState("dr1");
  const [band, setBand] = useState("0");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [observations, setObservations] = useState<Observation[]>([]);
  const [queryMessage, setQueryMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(mode === "compare" ? "slider" : "slider");
  const [split, setSplit] = useState(50);
  const [compareInfo, setCompareInfo] = useState<{ ready: boolean; reasons: string[]; difference: string } | null>(null);
  const [comparisonPreviewFailed, setComparisonPreviewFailed] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [stretch, setStretch] = useState<PreviewStretch>("asinh");
  const [contrast, setContrast] = useState(1);
  const [plane, setPlane] = useState(0);
  const [lowPercentile, setLowPercentile] = useState(1);
  const [highPercentile, setHighPercentile] = useState(99.6);
  const [previewMetadata, setPreviewMetadata] = useState<PreviewMetadata | null>(null);
  const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [coordinateGrid, setCoordinateGrid] = useState<WcsGrid | null>(null);
  const [selectedPixel, setSelectedPixel] = useState<{ x: number; y: number } | null>(null);
  const [pixelCoordinate, setPixelCoordinate] = useState<{ ra_deg: number; dec_deg: number } | null>(null);
  const [messageKind, setMessageKind] = useState<"error" | "info">("info");
  const viewerRef = useRef<HTMLDivElement>(null);
  const panMovedRef = useRef(false);
  const autoSearchStartedRef = useRef(false);
  const autoSearchConsumedRef = useRef(false);
  const searchRequestRef = useRef<(criteria: SearchCriteria) => Promise<void>>(async () => undefined);
  const [pendingSearch, setPendingSearch] = useState<SearchCriteria | null>(null);
  const current = observations[selected] ?? null;
  const pair = useMemo(() => comparablePair(observations), [observations]);
  const earlierProductId = pair?.[0]?.id ?? null;
  const laterProductId = pair?.[1]?.id ?? null;
  const renderOptions = { stretch, contrast, plane, lowPercentile, highPercentile };
  const firstPreview = pair ? previewUrl(pair[0], Number(ra), Number(dec), renderOptions) : "";
  const secondPreview = pair ? previewUrl(pair[1], Number(ra), Number(dec), renderOptions) : "";
  const wcs = previewMetadata?.wcs;
  const cutoutFootprintArcmin = previewMetadata && wcs?.available && wcs.pixel_scale_arcsec
    ? [previewMetadata.width * wcs.pixel_scale_arcsec[0] / 60, previewMetadata.height * wcs.pixel_scale_arcsec[1] / 60]
    : null;
  const searchRa = ra.trim() ? Number(ra) : null;
  const searchDec = dec.trim() ? Number(dec) : null;
  const viewerCenterRa = pixelCoordinate?.ra_deg ?? (wcs?.available ? wcs.center_ra_deg : searchRa);
  const viewerCenterDec = pixelCoordinate?.dec_deg ?? (wcs?.available ? wcs.center_dec_deg : searchDec);
  const compareHref = useMemo(() => {
    if (!pair || searchRa == null || searchDec == null) return null;
    const params = new URLSearchParams({ ra: String(searchRa), dec: String(searchDec), radius, release, band, run: "1" });
    if (fromDate) params.set("start_date", fromDate);
    if (toDate) params.set("end_date", toDate);
    return `/compare?${params.toString()}`;
  }, [pair, searchRa, searchDec, radius, release, band, fromDate, toDate]);

  useEffect(() => {
    if (!playing || observations.length < 2) return;
    const timer = window.setInterval(() => setSelected((index) => (index + 1) % observations.length), 2200);
    return () => window.clearInterval(timer);
  }, [playing, observations.length]);

  useEffect(() => {
    setPreviewFailed(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setSelectedPixel(null);
    setPixelCoordinate(null);
    setPlane(0);
  }, [current?.id]);

  useEffect(() => {
    setCompareInfo(null);
    if (!pair) return;
    const body = {
      earlier_url: pair[0].original_url,
      later_url: pair[1].original_url,
      earlier_collection: pair[0].collection,
      later_collection: pair[1].collection,
      earlier_band: wavelengthLabel(pair[0].wavelength_min_um, pair[0].wavelength_max_um),
      later_band: wavelengthLabel(pair[1].wavelength_min_um, pair[1].wavelength_max_um),
      earlier_calibration: pair[0].calibration_level,
      later_calibration: pair[1].calibration_level,
      earlier_mjd: pair[0].start_mjd,
      later_mjd: pair[1].start_mjd,
    };
    fetch(`${API_BASE}/api/comparison-readiness`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
      .then(async (response) => {
        const result = await response.json();
        if (response.ok) setCompareInfo({ ready: result.metadata_compatible, reasons: result.reasons ?? [], difference: result.difference_map_reason });
      })
      .catch(() => setCompareInfo({ ready: false, reasons: ["The comparison compatibility check could not reach ASCENTRA’s API."], difference: "No registered, calibrated difference product has been generated for this pair." }));
  }, [pair]);

  useEffect(() => {
    setComparisonPreviewFailed(null);
  }, [earlierProductId, laterProductId, ra, dec]);

  const search = useCallback(async (event?: FormEvent, criteria?: SearchCriteria) => {
    event?.preventDefault();
    setLoading(true);
    setPlaying(false);
    setQueryMessage(null);
    setMessageKind("info");
    setHasSearched(true);
    try {
      let parsedRa = Number.NaN;
      let parsedDec = Number.NaN;
      const typed = criteria ? "" : name.trim();
      if (typed) {
        const coordinatePair = typed.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (coordinatePair) {
          parsedRa = Number(coordinatePair[1]);
          parsedDec = Number(coordinatePair[2]);
          setRa(String(parsedRa));
          setDec(String(parsedDec));
        } else {
          const resolvedResponse = await fetch(`${API_BASE}/api/resolve?name=${encodeURIComponent(typed)}`, { signal: AbortSignal.timeout(15000) });
          const resolved = await resolvedResponse.json();
          if (!resolvedResponse.ok) throw new Error(resolved.detail || "That name could not be resolved.");
          parsedRa = resolved.ra;
          parsedDec = resolved.dec;
          setRa(String(parsedRa));
          setDec(String(parsedDec));
        }
      } else {
        const queryRa = criteria?.ra ?? (ra.trim() ? Number(ra) : Number.NaN);
        const queryDec = criteria?.dec ?? (dec.trim() ? Number(dec) : Number.NaN);
        if (!Number.isFinite(queryRa) || !Number.isFinite(queryDec)) {
          throw new Error("Enter an object name or both RA and Dec coordinates.");
        }
        parsedRa = queryRa;
        parsedDec = queryDec;
      }
      if (!Number.isFinite(parsedRa) || parsedRa < 0 || parsedRa >= 360 || !Number.isFinite(parsedDec) || parsedDec < -90 || parsedDec > 90) {
        throw new Error("Enter RA from 0° to under 360° and Dec from −90° to +90°.");
      }
      const queryBand = bandOptions[Number(criteria?.band ?? band)] ?? bandOptions[0];
      const queryRadius = criteria?.radius ?? radius;
      const queryRelease = criteria?.release ?? release;
      const queryFromDate = criteria?.fromDate ?? fromDate;
      const queryToDate = criteria?.toDate ?? toDate;
      const params = new URLSearchParams({ ra: String(parsedRa), dec: String(parsedDec), radius: queryRadius, release: queryRelease, limit: "80" });
      if (queryBand.min && queryBand.max) {
        params.set("wavelength_min_um", queryBand.min);
        params.set("wavelength_max_um", queryBand.max);
      }
      if (queryFromDate) params.set("start_date", queryFromDate);
      if (queryToDate) params.set("end_date", queryToDate);
      const response = await fetch(`${API_BASE}/api/observations?${params}`, { signal: AbortSignal.timeout(70000) });
      const payload = await response.json() as ObservationResponse & { detail?: string };
      if (!response.ok) throw new Error(payload.detail || "The archive search could not be completed.");
      setObservations(payload.observations);
      setSelected(0);
      setPreviewFailed(false);
      if (!payload.count) setQueryMessage(payload.message || "No observations were returned for this selection.");
      else setQueryMessage(payload.truncated
        ? `${payload.count} products returned; IRSA reached the result limit. Narrow the sky region or filters for a complete result set.`
        : `${payload.count} image product${payload.count === 1 ? "" : "s"} returned by IRSA · ${payload.cached ? "recently cached" : "live archive query"}.`);
    } catch (error) {
      setObservations([]);
      setQueryMessage(error instanceof Error ? error.message : "The archive search failed. Check the API connection and try again.");
      setMessageKind("error");
    } finally {
      setLoading(false);
    }
  }, [name, ra, dec, band, radius, release, fromDate, toDate]);

  useEffect(() => { searchRequestRef.current = (criteria) => search(undefined, criteria); }, [search]);

  useEffect(() => {
    if (mode !== "compare" || autoSearchStartedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("run") !== "1") return;
    const criteria: SearchCriteria = {
      ra: Number(params.get("ra")),
      dec: Number(params.get("dec")),
      radius: params.get("radius") ?? "0.1",
      release: params.get("release") ?? "dr1",
      band: params.get("band") ?? "0",
      fromDate: params.get("start_date") ?? "",
      toDate: params.get("end_date") ?? "",
    };
    if (!Number.isFinite(criteria.ra) || !Number.isFinite(criteria.dec) || !["dr1", "dr1_deep", "dr1_cube", "qr3", "qr3_deep"].includes(criteria.release) || !/^\d$/.test(criteria.band) || Number(criteria.band) > 6) {
      setQueryMessage("The saved search context is incomplete. Review the coordinates and run the archive search again.");
      setMessageKind("error");
      return;
    }
    autoSearchStartedRef.current = true;
    setRa(String(criteria.ra));
    setDec(String(criteria.dec));
    setRadius(criteria.radius);
    setRelease(criteria.release);
    setBand(criteria.band);
    setFromDate(criteria.fromDate);
    setToDate(criteria.toDate);
    setPendingSearch(criteria);
  }, [mode]);

  useEffect(() => {
    if (!pendingSearch || autoSearchConsumedRef.current) return;
    autoSearchConsumedRef.current = true;
    void searchRequestRef.current(pendingSearch);
  }, [pendingSearch]);

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    panMovedRef.current = false;
    if (event.target instanceof HTMLElement && event.target.closest("input, button, a")) return;
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragOrigin({ x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y });
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    if (!dragOrigin) return;
    if (Math.abs(event.clientX - dragOrigin.x) + Math.abs(event.clientY - dragOrigin.y) > 4) panMovedRef.current = true;
    setOffset({ x: dragOrigin.offsetX + event.clientX - dragOrigin.x, y: dragOrigin.offsetY + event.clientY - dragOrigin.y });
  }

  const currentPreview = current ? previewUrl(current, Number(ra), Number(dec), renderOptions) : "";
  const previewTransform = { transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: "center center" };
  const failedCompareProduct = pair?.find((item) => item.id === comparisonPreviewFailed);

  useEffect(() => {
    if (!current || mode === "compare" || !currentPreview) { setDisplayImageUrl(null); setPreviewMetadata(null); return; }
    if (current.data_type?.toLowerCase() === "cube") {
      setDisplayImageUrl(null); setPreviewMetadata(null); setPreviewFailed(false); setPreviewLoading(false); setPreviewError(null); setCoordinateGrid(null);
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setDisplayImageUrl(null);
    setPreviewMetadata(null);
    setCoordinateGrid(null);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewFailed(false);
    fetch(currentPreview, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.detail || `Image preview unavailable (${response.status})`);
        }
        const encoded = response.headers.get("X-ASCENTRA-Preview-Metadata");
        if (encoded) {
          const bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
          setPreviewMetadata(JSON.parse(new TextDecoder().decode(bytes)) as PreviewMetadata);
        }
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setDisplayImageUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPreviewFailed(true);
          setPreviewError(error instanceof Error ? error.message : "Image preview unavailable.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [current, currentPreview, mode]);

  useEffect(() => {
    if (!showGrid || !previewMetadata?.preview_id || !previewMetadata.wcs.available) { setCoordinateGrid(null); return; }
    const controller = new AbortController();
    fetch(`${API_BASE}/api/preview-grid/${previewMetadata.preview_id}`, { signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || "Coordinate grid unavailable"); return payload as WcsGrid; })
      .then(setCoordinateGrid)
      .catch(() => setCoordinateGrid(null));
    return () => controller.abort();
  }, [showGrid, previewMetadata?.preview_id, previewMetadata?.wcs.available]);

  async function inspectPixel(event: MouseEvent<HTMLImageElement>) {
    if (panMovedRef.current) return;
    if (!previewMetadata?.wcs.available || !previewMetadata.preview_id) return;
    const image = event.currentTarget;
    const rect = image.getBoundingClientRect();
    const aspect = previewMetadata.display_width / previewMetadata.display_height;
    const drawWidth = Math.min(rect.width, rect.height * aspect);
    const drawHeight = Math.min(rect.height, rect.width / aspect);
    const left = rect.left + (rect.width - drawWidth) / 2;
    const top = rect.top + (rect.height - drawHeight) / 2;
    const x = (event.clientX - left) / drawWidth * previewMetadata.display_width;
    const y = (event.clientY - top) / drawHeight * previewMetadata.display_height;
    if (x < 0 || y < 0 || x >= previewMetadata.display_width || y >= previewMetadata.display_height) return;
    setSelectedPixel({ x, y });
    try {
      const response = await fetch(`${API_BASE}/api/preview-world/${previewMetadata.preview_id}?x=${x}&y=${y}`, { signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Coordinate conversion unavailable");
      setPixelCoordinate({ ra_deg: result.ra_deg, dec_deg: result.dec_deg });
    } catch { setPixelCoordinate(null); }
  }

  return (
    <div className="page-shell">
      <section className="page-intro">
        <div className="eyebrow"><span className="eyebrow-star">✳</span> THE SPHEREx ARCHIVE, IN MOTION</div>
        <div className="intro-row">
          <div><h1>{mode === "compare" ? <>Compare the <span className="gradient-text">changing sky.</span></> : <>A sky that <span className="gradient-text">remembers.</span></>}</h1>
            <p>{mode === "compare" ? "Find distinct SPHEREx visits, check their reported wavelength and calibration metadata, then compare only what the archive supports." : "Travel through real SPHEREx observations, one region and one moment at a time."}</p></div>
          <div className="intro-actions"><span className="mission-chip"><span /> 102 NOMINAL CHANNELS</span><span className="live-caption"><Activity size={12} /> LIVE ARCHIVE ACCESS</span></div>
        </div>
      </section>

      <section className={`workspace ${mode === "compare" ? "workspace-compare" : ""}`}>
        <aside className="control-panel glass-panel">
          <div className="panel-heading"><span className="panel-icon"><SlidersHorizontal size={15} /></span><div><span className="section-kicker">OBSERVATORY</span><h2>Observation controls</h2></div><button className="help-dot" aria-label="About these controls" title="Search the public IRSA archive using ICRS coordinates."><CircleHelp size={14} /></button></div>
          <form onSubmit={search}>
            <label className="field-label" htmlFor="target-name">Celestial object <span>optional</span></label>
            <div className="search-field"><Search size={15} /><input id="target-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name or RA, Dec" /><button type="button" onClick={() => setName("")} aria-label="Clear object search">×</button></div>
            <div className="coordinate-label"><span className="field-label">Sky coordinates</span><span className="coordinate-system">ICRS · J2000</span></div>
            <div className="coordinate-grid"><label className="input-wrap"><span>RA <small>°</small></span><input inputMode="decimal" value={ra} onChange={(event) => setRa(event.target.value)} aria-label="Right ascension in degrees" /></label><label className="input-wrap"><span>Dec <small>°</small></span><input inputMode="decimal" value={dec} onChange={(event) => setDec(event.target.value)} aria-label="Declination in degrees" /></label></div>
            <div className="form-two"><label><span className="field-label">Search radius</span><span className="select-wrap"><select value={radius} onChange={(event) => setRadius(event.target.value)}><option value="0.025">1.5 arcmin</option><option value="0.1">6 arcmin</option><option value="0.25">15 arcmin</option><option value="0.5">30 arcmin</option><option value="1">1°</option></select><ChevronDown size={13} /></span></label>
              <label><span className="field-label">Data release</span><span className="select-wrap"><select value={release} onChange={(event) => setRelease(event.target.value)}><option value="dr1">DR1 · reprocessed</option><option value="dr1_deep">DR1 · deep</option><option value="dr1_cube">DR1 · all-sky cube</option><option value="qr3">QR3</option><option value="qr3_deep">QR3 · deep</option></select><ChevronDown size={13} /></span></label></div>
            <label><span className="field-label">Wavelength band</span><span className="select-wrap"><select value={band} onChange={(event) => setBand(event.target.value)}>{bandOptions.map((option, index) => <option value={index} key={option.label}>{option.label}</option>)}</select><ChevronDown size={13} /></span></label>
            <div className="form-two date-fields"><label><span className="field-label">From date</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label><span className="field-label">To date</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div>
            <button className="primary-button explore-button" type="submit" disabled={loading}>{loading ? <LoaderCircle size={16} className="spin" /> : <ScanSearch size={16} />}{loading ? "Searching IRSA" : mode === "compare" ? "Find observations" : "Explore this region"}<ArrowRight size={15} /></button>
          </form>
          <div className="mission-card"><div className="mission-card-orbit"><span /><i /><b /></div><div><span className="section-kicker">THE SPHEREx MISSION</span><p>Six detectors, 102 nominal wavelength channels. Each image carries its own measured footprint and spectral coverage.</p><Link href="/about">Meet the mission <ArrowRight size={12} /></Link></div></div>
          <div className="controls-footnote"><span className="footnote-led" /> No account required <span className="footnote-divider">·</span> Public archive data</div>
        </aside>

        <section className="viewer-column">
          <div className="viewer-topline"><div><span className="section-kicker">{mode === "compare" ? "EPOCH COMPARISON" : "LIVE SKY VIEWER"}</span><span className="viewer-coords"><MapPin size={12} /> {viewerCenterRa != null && viewerCenterDec != null ? `${pixelCoordinate ? "PIXEL" : wcs?.available ? "CUTOUT WCS" : "SEARCH CENTER"} · RA ${viewerCenterRa.toFixed(5)}° (${formatRaHms(viewerCenterRa)}) · Dec ${viewerCenterDec.toFixed(5)}° (${formatDecDms(viewerCenterDec)})` : "WCS coordinates unavailable"}</span></div><div className="viewer-badges">{current ? <span className="data-badge"><span /> {current.data_type?.toLowerCase() === "cube" ? "ARCHIVE CUBE" : "ARCHIVE IMAGE"}</span> : <span className="illustration-badge">ILLUSTRATIVE FIELD</span>}<button className="icon-button" aria-label="Reset view" title="Reset view" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); setSelectedPixel(null); setPixelCoordinate(null); }}><Focus size={15} /></button><button className="icon-button" aria-label="Open fullscreen" title="Fullscreen" onClick={() => viewerRef.current?.requestFullscreen?.()}><Expand size={15} /></button></div></div>
          <div className={`sky-viewer ${mode === "compare" ? "compare-viewer" : ""}`} ref={viewerRef} onPointerDown={beginPan} onPointerMove={pan} onPointerUp={() => { setDragOrigin(null); if (panMovedRef.current) window.setTimeout(() => { panMovedRef.current = false; }, 80); }} onPointerCancel={() => setDragOrigin(null)} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(1, Math.min(3, value * (event.deltaY < 0 ? 1.12 : 0.89)))); }}>
            {current?.data_type?.toLowerCase() === "cube" ? <div className="cube-observation-prompt"><Waves size={28} /><span className="section-kicker">DR1 ALL-SKY SPECTRAL CUBE</span><strong>Explore its 102 channel slots</strong><p>This FITS product spans a full 1.8-degree tile. Use the spectral profile view to sample your target coordinate without downloading the entire cube.</p><Link href={`/spectral?ra=${encodeURIComponent(ra)}&dec=${encodeURIComponent(dec)}`}>Open Spectral Explorer <ArrowRight size={13} /></Link></div>
              : mode === "compare" && pair && viewMode === "side" ? <div className="side-compare"><div className="comparison-image"><img src={firstPreview} alt="Earlier SPHEREx image product" onError={() => setComparisonPreviewFailed(pair[0].id)} style={previewTransform} /><span>EARLIER · {dateTimeLabel(pair[0].observation_start)}</span></div><div className="comparison-image"><img src={secondPreview} alt="Later SPHEREx image product" onError={() => setComparisonPreviewFailed(pair[1].id)} style={previewTransform} /><span>LATER · {dateTimeLabel(pair[1].observation_start)}</span></div></div>
              : mode === "compare" && pair && viewMode === "slider" ? <div className="slider-compare"><img className="compare-base" src={firstPreview} alt="Earlier SPHEREx observation" onError={() => setComparisonPreviewFailed(pair[0].id)} style={previewTransform} /><div className="compare-top" style={{ clipPath: `inset(0 0 0 ${split}%)` }}><img src={secondPreview} alt="Later SPHEREx observation" onError={() => setComparisonPreviewFailed(pair[1].id)} style={previewTransform} /></div><div className="compare-divider" style={{ left: `${split}%` }}><span><ArrowDownUp size={13} /></span></div><div className="compare-stamp earlier-stamp" title={dateTimeLabel(pair[0].observation_start)}>{dateTimeLabel(pair[0].observation_start)}</div><div className="compare-stamp later-stamp" title={dateTimeLabel(pair[1].observation_start)}>{dateTimeLabel(pair[1].observation_start)}</div><input className="split-range" aria-label="Comparison divider position" type="range" min="4" max="96" value={split} onChange={(event) => setSplit(Number(event.target.value))} /></div>
              : current && !previewFailed ? displayImageUrl ? <img key={`${current.id}-${stretch}-${contrast}-${plane}`} className="sky-image" src={displayImageUrl} alt={`SPHEREx image ${current.product_id}; click to read WCS coordinates`} onClick={(event) => void inspectPixel(event)} style={previewTransform} /> : <div className="preview-loading" role="status"><LoaderCircle size={21} className="spin" /><span>{previewLoading ? "Rendering FITS cutout…" : "Preparing image…"}</span></div>
                : <div className="sky-illustration" aria-label="Illustrative star field, no observed image loaded"><div className="illustration-nebula nebula-one" /><div className="illustration-nebula nebula-two" /><div className="constellation constellation-a"><i /><i /><i /><i /><svg viewBox="0 0 210 160"><path d="M14 119 58 61 117 77 174 24 194 103" /></svg></div><div className="constellation constellation-b"><i /><i /><i /><i /><svg viewBox="0 0 130 130"><path d="M13 24 82 16 112 78 42 111 13 24" /></svg></div><div className="illustration-center"><span className="view-orbit orbit-a" /><span className="view-orbit orbit-b" /><span className="view-core" /><span className="crosshair" /></div><div className="illustration-label"><span className="illustration-symbol">✧</span><span>{previewFailed ? "PREVIEW UNAVAILABLE" : "ILLUSTRATIVE SKY FIELD"}</span><small>{previewFailed ? "The source FITS is still available below." : "No observation loaded · select a region to begin"}</small></div></div>}
            {current && displayImageUrl && previewMetadata && ((showGrid && coordinateGrid) || selectedPixel) && <svg className="wcs-grid-overlay" viewBox={`0 0 ${previewMetadata.display_width} ${previewMetadata.display_height}`} preserveAspectRatio="xMidYMid meet" style={previewTransform} aria-label="Celestial coordinate grid and selected pixel">{showGrid && coordinateGrid?.paths.map((path, index) => <g key={`${path.axis}-${index}`}><polyline points={path.points.map((point) => point.join(",")).join(" ")} /><text x={path.points[0][0] + 2} y={path.points[0][1] - 2}>{path.axis === "ra" ? "RA" : "Dec"} {path.value_deg.toFixed(3)}°</text></g>)}{selectedPixel && <g className="wcs-selected-pixel"><circle cx={selectedPixel.x} cy={selectedPixel.y} r="6" /><path d={`M${selectedPixel.x - 11} ${selectedPixel.y}h22M${selectedPixel.x} ${selectedPixel.y - 11}v22`} /></g>}</svg>}
            <div className="viewer-corner top-left">α <span>{wcs?.available && wcs.center_ra_deg != null ? wcs.center_ra_deg.toFixed(3) : "—"}</span></div><div className="viewer-corner top-right">δ <span>{wcs?.available && wcs.center_dec_deg != null ? wcs.center_dec_deg.toFixed(3) : "—"}</span></div><div className="viewer-corner bottom-left"><span className="scale-mark" /> {cutoutFootprintArcmin ? `${cutoutFootprintArcmin[0].toFixed(1)}′ × ${cutoutFootprintArcmin[1].toFixed(1)}′ CUTOUT` : current?.data_type?.toLowerCase() === "cube" ? "1.8-degree HEALPix tile" : "CUTOUT FOV UNKNOWN"}</div><div className="viewer-corner bottom-right">{current?.data_type?.toLowerCase() === "cube" ? "102-channel cube; spectral view" : current ? `FITS · ${stretch.toUpperCase()} DISPLAY` : "VISUALIZATION · NOT OBSERVATIONAL DATA"}</div>
            {mode === "compare" && viewMode === "difference" && <div className="difference-curtain"><div className="difference-card"><div className="difference-icon"><Layers3 size={20} /></div><span className="section-kicker">DIFFERENCE MAP NOT GENERATED</span><p>{compareInfo?.difference || "A difference product is only shown after image registration, variance handling and PSF matching."}</p><div className="difference-legend"><span>− residual</span><i /><span>+ residual</span></div></div></div>}
            {previewFailed && current && <div className="preview-fallback"><span>{previewError || "Preview unavailable for this product."}</span><a href={current.original_url} target="_blank" rel="noreferrer">Open original FITS <ExternalLink size={12} /></a></div>}
            {failedCompareProduct && <div className="preview-fallback"><span>The requested sky center is not available in this cutout or the IRSA preview failed.</span><a href={failedCompareProduct.original_url} target="_blank" rel="noreferrer">Open original FITS <ExternalLink size={12} /></a></div>}
            {!current && !previewFailed && <div className="illustration-watermark"><span>ARTIST’S RENDERING</span><i /> NOT SPHEREx DATA</div>}
          </div>
          <div className="viewer-toolbar"><div className="viewer-tools"><button className="tool-button" onClick={() => setZoom((value) => Math.min(value + 0.25, 3))} aria-label="Zoom in"><Plus size={15} /></button><span className="zoom-value">{Math.round(zoom * 100)}%</span><button className="tool-button" onClick={() => setZoom((value) => Math.max(value - 0.25, 1))} aria-label="Zoom out"><Minus size={15} /></button><span className="tool-separator" /><button className="tool-button" onClick={() => current && setSelected((selected + observations.length - 1) % observations.length)} aria-label="Previous observation" disabled={!observations.length}><ArrowLeft size={15} /></button><button className={`tool-button ${playing ? "tool-active" : ""}`} onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause observations" : "Play observations"} disabled={observations.length < 2}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button className="tool-button" onClick={() => observations.length && setSelected((selected + 1) % observations.length)} aria-label="Next observation" disabled={!observations.length}><ArrowRight size={15} /></button></div>
          <div className="viewer-tools-right">{mode === "compare" ? <div className="mode-switcher"><button className={viewMode === "slider" ? "selected" : ""} onClick={() => setViewMode("slider")}>Slider</button><button className={viewMode === "side" ? "selected" : ""} onClick={() => setViewMode("side")}>Side by side</button><button className={viewMode === "difference" ? "selected" : ""} onClick={() => setViewMode("difference")}>Difference</button></div> : <button className={`compare-action ${compareHref ? "" : "disabled"}`} onClick={() => compareHref && router.push(compareHref)} disabled={!compareHref}><ArrowDownUp size={13} /> Compare epochs</button>}</div></div>
          <div className="image-render-controls" style={{ display: current?.data_type?.toLowerCase() === "cube" ? "none" : undefined }}><label>Display stretch<select value={stretch} onChange={(event) => setStretch(event.target.value as PreviewStretch)}><option value="linear">Linear</option><option value="log">Logarithmic</option><option value="sqrt">Square root</option><option value="asinh">Asinh</option></select></label><label className="contrast-control">Contrast <strong>{contrast.toFixed(1)}×</strong><input type="range" min="0.5" max="2.5" step="0.1" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} /></label><label className="percentile-control">Black point <strong>p{lowPercentile.toFixed(1)}</strong><input type="range" min="0" max="10" step="0.5" value={lowPercentile} onChange={(event) => setLowPercentile(Number(event.target.value))} /></label><label className="percentile-control">White point <strong>p{highPercentile.toFixed(1)}</strong><input type="range" min="90" max="100" step="0.5" value={highPercentile} onChange={(event) => setHighPercentile(Number(event.target.value))} /></label>{previewMetadata && previewMetadata.plane_count > 1 && <label>FITS plane<select value={plane} onChange={(event) => setPlane(Number(event.target.value))}>{Array.from({ length: previewMetadata.plane_count }, (_, index) => <option value={index} key={index}>Plane {index + 1}</option>)}</select></label>}<button className={`grid-toggle ${showGrid ? "selected" : ""}`} type="button" onClick={() => setShowGrid((value) => !value)} disabled={!previewMetadata?.wcs.available || mode === "compare"} title={previewMetadata?.wcs.available ? "Toggle the FITS WCS coordinate grid" : "This image has no usable celestial WCS"}><MapPin size={12} /> Sky grid</button><span className="display-only-label">Display mapping only · FITS pixel values unchanged</span></div>
          {mode === "compare" && <div className={`compatibility-note ${compareInfo?.ready ? "compatible" : ""}`}><span className="compat-dot" />{compareInfo?.ready ? "Product wavelength, calibration and observation times match. This is a visual comparison only; no change measurement has been computed." : compareInfo ? compareInfo.reasons.join(" ") : pair ? "Checking channel, calibration and observation-time compatibility…" : "No verified same-channel repeat visits were found in this result set."}</div>}
          <div className="timeline-panel"><div className="timeline-header"><div><Clock3 size={14} /><span className="section-kicker">OBSERVATION TIMELINE</span></div><span>{observations.length ? `${selected + 1} / ${observations.length} PRODUCTS` : "AWAITING ARCHIVE RESULTS"}</span></div>
            {observations.length ? <><input className="timeline-range" aria-label="Choose observation" type="range" min={0} max={Math.max(0, observations.length - 1)} value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setPlaying(false); }} /><div className="timeline-dates"><span>{dateLabel(observations[0]?.observation_start)}</span><span>{dateLabel(observations[observations.length - 1]?.observation_start)}</span></div><div className="timeline-observation-label"><i /> <span>{current?.product_id}</span><span>{current?.release} · {current ? wavelengthLabel(current.wavelength_min_um, current.wavelength_max_um) : ""}</span></div></> : <div className="timeline-empty"><span className="timeline-line" /> Query a sky region to reveal available SPHEREx visits.</div>}
          </div>
          {queryMessage && <div className={`query-message ${messageKind === "error" ? "is-error" : ""}`} role="status"><span>{messageKind === "error" ? "!" : <Check size={12} />}</span>{queryMessage}{messageKind === "error" && <button onClick={() => setQueryMessage(null)} aria-label="Dismiss message">×</button>}</div>}
          {hasSearched && observations.length > 0 && <div className="result-strip"><span><span className="result-led" /> {observations.length} RESULTS FROM IRSA</span><button onClick={() => setShowDetails((value) => !value)}>{showDetails ? "Hide products" : "Browse products"} <ChevronDown size={13} className={showDetails ? "rotate" : ""} /></button></div>}
          {showDetails && <div className="product-list">{observations.map((item, index) => <button key={item.id} className={`product-row ${selected === index ? "selected" : ""}`} onClick={() => { setSelected(index); setPreviewFailed(false); }}><span className="product-index">{String(index + 1).padStart(2, "0")}</span><span className="product-main"><strong>{item.product_id}</strong><small>{dateLabel(item.observation_start)} · {wavelengthLabel(item.wavelength_min_um, item.wavelength_max_um)}</small></span><ExternalLink size={13} onClick={(event) => { event.stopPropagation(); window.open(item.original_url, "_blank", "noopener,noreferrer"); }} /></button>)}</div>}
        </section>

        <aside className="insights-panel glass-panel">
          <div className="panel-heading"><span className="panel-icon violet"><Sparkles size={15} /></span><div><span className="section-kicker">FIELD NOTES</span><h2>Object insights</h2></div><span className="insights-count">{current ? "01" : "—"}</span></div>
          {current ? <>
            <div className="object-identity"><div className="object-glyph">✧</div><div><span className="section-kicker">ARCHIVE PRODUCT</span><h3>{current.target || current.product_id}</h3><p>{current.product_id}</p></div></div>
            <div className="metadata-block"><span className="section-kicker">ARCHIVE REFERENCE &amp; TIME</span><MetaLine label="Archive reference RA" value={formatCoord(current.ra, "RA")} /><MetaLine label="Archive reference Dec" value={formatCoord(current.dec, "Dec")} />{previewMetadata?.wcs.available && <><MetaLine label="Cutout WCS center RA" value={formatCoord(previewMetadata.wcs.center_ra_deg ?? null, "RA")} /><MetaLine label="Cutout WCS center Dec" value={formatCoord(previewMetadata.wcs.center_dec_deg ?? null, "Dec")} /></>}{current.field_of_view_deg != null && <MetaLine label="Archive footprint size" value={`${current.field_of_view_deg.toFixed(3)}° · archive metadata`} />}<MetaLine label="Observation start (UTC)" value={dateTimeLabel(current.observation_start)} /><MetaLine label="Exposure" value={current.exposure_seconds != null ? `${current.exposure_seconds.toFixed(1)} s` : "Not reported"} /></div>
            {previewMetadata && <div className="metadata-block"><span className="section-kicker">FITS DISPLAY &amp; GEOMETRY</span><MetaLine label="Image dimensions" value={`${previewMetadata.width} × ${previewMetadata.height} px`} /><MetaLine label="FITS array shape" value={previewMetadata.fits_shape.join(" × ")} /><MetaLine label="Science extension" value={`${previewMetadata.hdu}${previewMetadata.selected_plane_indices.length ? ` · plane ${previewMetadata.selected_plane_indices.map((index) => index + 1).join(", ")}` : ""}`} /><MetaLine label="Pixel units" value={previewMetadata.bunit || "Not reported"} /><MetaLine label="Pixel scale" value={previewMetadata.wcs.pixel_scale_arcsec ? `${previewMetadata.wcs.pixel_scale_arcsec.map((value) => value.toFixed(3)).join(" × ")}″ / px` : "Not reported"} /><MetaLine label="Finite / invalid pixels" value={`${previewMetadata.finite_pixel_count.toLocaleString()} / ${previewMetadata.invalid_pixel_count.toLocaleString()}`} /><MetaLine label="Background median ± MAD" value={`${previewMetadata.background_median.toPrecision(4)} ± ${previewMetadata.background_mad.toPrecision(4)} ${previewMetadata.bunit || "data units"}`} /><MetaLine label={`Display cut · p${previewMetadata.display_min_percentile}–p${previewMetadata.display_max_percentile}`} value={`${previewMetadata.display_min.toPrecision(4)}–${previewMetadata.display_max.toPrecision(4)} ${previewMetadata.bunit || "data units"}`} /><details className="fits-extension-details"><summary>FITS extensions ({previewMetadata.extensions.length})</summary>{previewMetadata.extensions.map((extension, index) => <MetaLine key={`${extension.name}-${index}`} label={`${extension.name} · ${extension.type}`} value={`${extension.shape.join(" × ") || "No image array"}${extension.bunit ? ` · ${extension.bunit}` : ""}`} />)}</details><div className="display-caveat">{previewMetadata.wcs.available ? `WCS ${previewMetadata.wcs.ctype?.join(" / ")} · ${previewMetadata.wcs.coordinate_frame || "celestial"}` : "No usable celestial WCS in this FITS cutout."} Display stretch is visual only; use the original FITS for scientific values.</div></div>}
            <div className="metadata-block"><span className="section-kicker">SPECTRAL COVERAGE</span><div className="wavelength-reading"><Waves size={14} /><strong>{wavelengthLabel(current.wavelength_min_um, current.wavelength_max_um)}</strong></div><div className="spectrum-mini" aria-label="Reported wavelength coverage"><span className="spectrum-fill" style={{ left: `${Math.max(0, ((current.wavelength_min_um ?? 0.75) - 0.75) / 4.25 * 100)}%`, width: `${Math.max(4, (((current.wavelength_max_um ?? 1.1) - (current.wavelength_min_um ?? 0.75)) / 4.25) * 100)}%` }} /></div><div className="spectrum-bounds"><span>0.75 μm</span><span>5.00 μm</span></div><MetaLine label="Data release" value={`${current.release}${current.deep_field ? " · Deep" : ""}`} /><MetaLine label="Calibration level" value={current.calibration_level ? `Level ${current.calibration_level}` : "Not reported"} /></div>
            <div className="measurement-note"><div className="note-title"><span className="measured-key" /> REPORTED BY IRSA</div><p>Coordinates, exposure and wavelength coverage are archive metadata. No brightness or source classification is returned by this image search.</p></div>
            <a className="original-data-button" href={current.original_url} target="_blank" rel="noreferrer"><span><Telescope size={14} /> Open original data</span><ExternalLink size={13} /></a>
            <Link className="text-action" href={viewerCenterRa != null && viewerCenterDec != null ? `/investigate?ra=${encodeURIComponent(String(viewerCenterRa))}&dec=${encodeURIComponent(String(viewerCenterDec))}&target=${encodeURIComponent(current.target || current.product_id)}` : "/investigate"}>Investigate this field <ArrowRight size={13} /></Link>
            {viewerCenterRa != null && viewerCenterDec != null && <Link className="text-action cosmic-field-handoff" href={`/cosmic-explorer?ra=${encodeURIComponent(String(viewerCenterRa))}&dec=${encodeURIComponent(String(viewerCenterDec))}&target=${encodeURIComponent(current.target || current.product_id)}`}><Globe2 size={13} /> View in Cosmic Explorer <ArrowRight size={13} /></Link>}
          </> : <div className="insights-empty"><div className="empty-target"><span /><i /></div><h3>Your next discovery starts here.</h3><p>Choose a region to see coordinates, observation dates, actual wavelength coverage and original archive products.</p><div className="empty-checklist"><span><Check size={12} /> Measured metadata</span><span><Check size={12} /> Data provenance</span><span><Check size={12} /> Original FITS access</span></div></div>}
          <div className="insights-bottom"><span><span className="confidence-dot" /> MEASURED METADATA</span><button title="Only archive-returned values appear as measurements."><CircleHelp size={13} /></button></div>
        </aside>
      </section>
      <div className="beginner-hint"><span><Sparkles size={13} /></span><p><strong>New to infrared astronomy?</strong> Start with a familiar object name. ASCENTRA will find its coordinates, search the archive and explain what is available.</p><Link href="/about">How this works <ArrowRight size={12} /></Link></div>
    </div>
  );
}
