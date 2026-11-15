"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, CircleHelp, Clock3, ExternalLink, Globe2, LoaderCircle, MapPin, Minus, Pause, Play, Plus, Radio, RotateCcw, Search, Sparkles, Target, Telescope, Waves } from "lucide-react";
import { API_BASE, Observation, dateTimeLabel, previewUrl, wavelengthLabel } from "@/lib/api";

type Detection = { x: number; y: number; x_display: number; y_display: number; ra_deg: number; dec_deg: number; flux: number; flux_uncertainty: number; flux_unit: string; signal_to_noise: number; position_uncertainty_arcsec: number };
type EpochResult = { epoch_id: string; product_id: string; observation_start: string; release: string; collection: string; image_width: number; image_height: number; display_width: number; display_height: number; source_count: number; detections: Detection[]; quality: { valid_fraction: number; flags_applied: boolean; variance_applied: boolean; uncertainty_method: string }; wcs: { center_ra_deg: number; center_dec_deg: number; pixel_scale_arcsec: number[]; warnings?: string[] } };
type Position = { epoch_id: string; product_id: string; observation_start: string; ra_deg: number; dec_deg: number; observed_ra_deg: number; observed_dec_deg: number; east_offset_arcsec: number; north_offset_arcsec: number; position_uncertainty_arcsec: number; local_wavelength_um: number | null; local_bandwidth_um: number | null; signal_to_noise: number; flux: number; flux_uncertainty: number; flux_unit: string; x_display: number; y_display: number };
type Track = { source_id: string; reference_position: { ra_deg: number; dec_deg: number }; source_quality: { reference_snr: number; reference_flux: number; reference_flux_unit: string; reference_position_uncertainty_arcsec: number }; positions: Position[]; matched_epochs: number; angular_displacement_arcsec: number | null; angular_rate_arcsec_hour: number | null; proper_motion: { ra_cosdec_arcsec_per_year: number; dec_arcsec_per_year: number; total_arcsec_per_year: number; uncertainty_arcsec_per_year: number; significance_sigma: number | null; baseline_days: number; observations: number; classification: string } | null; spectral_compatibility: { compatible: boolean | null; overlap_fraction: number | null; common_wavelength_range_um: number[] | null; wavelengths_um?: number[]; status: string; rule?: string } | null; transverse_velocity_kms: number | null; classification: string };
type Analysis = { status: string; source: string; retrieved_at: string; classification: string; query: { ra: number; dec: number; cutout_size_deg: number }; epochs: EpochResult[]; tracks: Track[]; registration: Array<{ epoch_id: string; status: string; matched_sources: number; uncertainty_arcsec: number }>; motion_candidate_count: number; unavailable_epochs: Array<{ epoch_id: string; detail: string }>; methodology: string[]; compatibility: { collection: string; calibration_level: number; wavelength_min_um: number; wavelength_max_um: number } };
type Benchmark = { designation: string; count: number; observations: Array<{ observed_at: string; ra_deg: number; dec_deg: number; magnitude: number | null; observatory_code: string; filter: string; uncertainty_arcsec: number | null; ephemeris?: { ra_deg: number; dec_deg: number; source: string }; residual_arcsec?: number }>; motion_samples: Array<{ angular_rate_arcsec_min: number; angular_displacement_arcsec: number; interval_minutes: number; observed_at: string }>; benchmark_rate_arcsec_min: number; validation: { status: string; matched: number; message: string | null; retrieved_at: string | null }; source: string; retrieved_at: string; notice: string };

type Notice = { kind: "error" | "info"; text: string } | null;
type CatalogueCandidate = { ra_deg: number; dec_deg: number; separation_arcsec: number; designation?: string | null; source_id?: string | null; j_m?: number | null; h_m?: number | null; k_m?: number | null; w1mpro?: number | null; w1sigmpro?: number | null; w2mpro?: number | null; w2sigmpro?: number | null; phot_g_mean_mag?: number | null; parallax?: number | null; pmra?: number | null; pmdec?: number | null; ra_error?: number | null; dec_error?: number | null };
type CatalogueMatchResponse = { target: { ra_deg: number; dec_deg: number }; search_radius_arcsec: number; source: string; retrieved_at: string; classification: string; ranking_method: string; cached: boolean; catalogues: Array<{ catalogue: string; label: string; status: string; returned_rows?: number; truncated?: boolean; query_url?: string; message?: string; matches: CatalogueCandidate[] }>; limitations: string[] };

function messageFrom(value: unknown, fallback: string) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return fallback;
}

function compatible(items: Observation[]) {
  if (items.length < 2) return { ok: false, reasons: ["Choose at least two observations to compare."] };
  const reasons: string[] = [];
  if (new Set(items.map((item) => item.collection)).size !== 1) reasons.push("Observations must come from the same archive collection.");
  if (items.some((item) => item.calibration_level == null) || new Set(items.map((item) => item.calibration_level)).size !== 1) reasons.push("Matching calibration-level metadata is required.");
  if (items.some((item) => item.wavelength_min_um == null || item.wavelength_max_um == null)) reasons.push("Wavelength limits are missing for one or more observations.");
  else {
    const base = items[0];
    if (items.some((item) => {
      const low = Math.max(base.wavelength_min_um!, item.wavelength_min_um!);
      const high = Math.min(base.wavelength_max_um!, item.wavelength_max_um!);
      return high <= low || (high - low) / Math.min(base.wavelength_max_um! - base.wavelength_min_um!, item.wavelength_max_um! - item.wavelength_min_um!) < 0.95;
    })) reasons.push("At least 95% overlapping wavelength coverage is required.");
  }
  const times = items.map((item) => item.observation_start ? new Date(item.observation_start).getTime() : NaN);
  if (times.some((time) => !Number.isFinite(time)) || new Set(times).size !== items.length) reasons.push("Distinct observation timestamps are required.");
  return { ok: reasons.length === 0, reasons };
}

function shortNumber(value: number | null | undefined, digits = 3) { return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits }); }
function dateLabel(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); }

function downloadFile(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MotionChart({ track, svgRef }: { track: Track; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [series, setSeries] = useState<"offset" | "separation" | "flux">("offset");
  useEffect(() => {
    if (series === "flux" && track.spectral_compatibility?.compatible !== true) setSeries("offset");
  }, [series, track.spectral_compatibility?.compatible]);
  const positions = track.positions;
  const width = 760, height = 238, left = 49, right = 14, top = 17, bottom = 28;
  const times = positions.map((item) => new Date(item.observation_start).getTime());
  const minT = Math.min(...times), maxT = Math.max(...times);
  const tRange = Math.max(maxT - minT, 1);
  const sortedFlux = [...positions.map((point) => point.flux)].sort((a, b) => a - b);
  const medianFlux = (sortedFlux.length % 2 ? sortedFlux[Math.floor(sortedFlux.length / 2)] : (sortedFlux[sortedFlux.length / 2 - 1] + sortedFlux[sortedFlux.length / 2]) / 2) || 1;
  const fluxRelative = positions.map((point) => ((point.flux - medianFlux) / Math.abs(medianFlux)) * 100);
  const separation = positions.map((point) => Math.hypot(point.east_offset_arcsec - positions[0].east_offset_arcsec, point.north_offset_arcsec - positions[0].north_offset_arcsec));
  const values = series === "offset" ? null : series === "separation" ? separation : fluxRelative;
  const offsetMax = Math.max(1, ...positions.flatMap((item) => [Math.abs(item.east_offset_arcsec) + item.position_uncertainty_arcsec, Math.abs(item.north_offset_arcsec) + item.position_uncertainty_arcsec])) * 1.18;
  const relativeFluxErrors = positions.map((point) => Math.abs(point.flux_uncertainty / Math.abs(medianFlux) * 100));
  const plottedErrors = positions.map((point, index) => series === "flux" ? relativeFluxErrors[index] : point.position_uncertainty_arcsec);
  const dataMin = values ? series === "separation" ? 0 : Math.min(0, ...values.map((value, index) => value - (plottedErrors[index] ?? 0))) : -offsetMax;
  const dataMax = values ? Math.max(1, ...values.map((value, index) => value + (plottedErrors[index] ?? 0))) : offsetMax;
  const range = Math.max(1e-8, dataMax - dataMin);
  const axisMin = values ? series === "separation" ? 0 : dataMin - range * 0.1 : dataMin;
  const axisMax = values ? dataMax + range * 0.1 : dataMax;
  const x = (time: number) => left + ((time - minT) / tRange) * (width - left - right);
  const y = (value: number) => top + (axisMax - value) / (axisMax - axisMin) * (height - top - bottom - 15);
  const split = (lineValues: number[]) => lineValues.map((value, index) => `${x(times[index])},${y(value)}`).join(" ");
  const exportPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const data = new XMLSerializer().serializeToString(copy);
    const image = new Image();
    const imageUrl = URL.createObjectURL(new Blob([data], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = width * 2; canvas.height = height * 2;
      const context = canvas.getContext("2d"); if (!context) return;
      context.scale(2, 2); context.fillStyle = "#080e18"; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => { if (blob) downloadFile(`${track.source_id}-motion.png`, blob, "image/png"); });
      URL.revokeObjectURL(imageUrl);
    };
    image.src = imageUrl;
  };

  return <div className="motion-chart-wrap">
    <div className="motion-chart-top"><div><span className="motion-micro-label">CALCULATED TRACK · {track.matched_epochs} EPOCHS</span><h3>{series === "offset" ? "Position offset over time" : series === "separation" ? "Angular displacement over time" : "Relative aperture flux over time"}</h3></div><div className="motion-chart-controls"><div className="motion-chart-tabs" role="tablist" aria-label="Motion chart view">{([["offset", "RA / Dec"], ["separation", "Displacement"], ["flux", "Aperture flux"]] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={series === key} className={series === key ? "active" : ""} disabled={key === "flux" && track.spectral_compatibility?.compatible !== true} title={key === "flux" && track.spectral_compatibility?.compatible !== true ? "Flux comparison needs overlapping per-pixel LVF passbands across the matched epochs." : undefined} onClick={() => setSeries(key)}>{label}</button>)}</div><button className="motion-quiet-button" onClick={exportPng}><ArrowDownToLine size={13} /> Export PNG</button></div></div>
    <svg className="motion-track-chart" ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series} measurements for ${track.source_id} across observation dates`}>
      <rect x="0" y="0" width={width} height={height} rx="6" fill="#080e18" />
      {[0, 1, 2, 3, 4].map((i) => { const value = axisMax - (axisMax - axisMin) * i / 4; const yy = y(value); return <g key={i}><line x1={left} y1={yy} x2={width - right} y2={yy} stroke="rgba(136,164,204,.12)" /><text x={left - 8} y={yy + 3} textAnchor="end" className="motion-chart-tick">{shortNumber(value, 1)}{series === "flux" ? "%" : "″"}</text></g>; })}
      {axisMin <= 0 && axisMax >= 0 && <line x1={left} y1={y(0)} x2={width - right} y2={y(0)} stroke="rgba(147,172,203,.24)" />}
      {positions.length > 1 && (series === "offset" ? <><polyline points={split(positions.map((point) => point.east_offset_arcsec))} fill="none" stroke="#71d9ed" strokeWidth="2" /><polyline points={split(positions.map((point) => point.north_offset_arcsec))} fill="none" stroke="#b99aef" strokeWidth="2" /></> : <polyline points={split(values ?? [])} fill="none" stroke={series === "flux" ? "#cfb0ef" : "#71d9ed"} strokeWidth="2" />)}
      {positions.map((point, index) => {
        const plotted = series === "offset" ? [point.east_offset_arcsec, point.north_offset_arcsec] : [values?.[index] ?? 0];
        const colors = series === "offset" ? ["#71d9ed", "#b99aef"] : [series === "flux" ? "#cfb0ef" : "#71d9ed"];
        const error = plottedErrors[index] ?? 0;
        return <g key={`${point.epoch_id}-${index}`}>
          {plotted.map((value, row) => <g key={row}><line x1={x(times[index])} x2={x(times[index])} y1={y(value - error)} y2={y(value + error)} stroke={colors[row]} strokeOpacity=".7" /><circle cx={x(times[index])} cy={y(value)} r={row === 0 ? 4 : 3} fill={colors[row]} stroke="#e7f8ff" strokeWidth=".8" /></g>)}
          <text x={x(times[index])} y={height - 8} textAnchor="middle" className="motion-chart-tick">{new Date(point.observation_start).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</text>
        </g>;
      })}
      <text x="6" y="14" className="motion-chart-label">{series === "offset" ? "EAST / NORTH · ARCSEC" : series === "separation" ? "FROM FIRST EPOCH · ARCSEC" : "Δ APERTURE FLUX FROM MEDIAN · %"}</text>
    </svg>
    <div className="motion-chart-legend">{series === "offset" ? <><span><i className="east-dot" /> East (μRA cos Dec)</span><span><i className="north-dot" /> North (Dec)</span></> : <span><i className={series === "flux" ? "north-dot" : "east-dot"} />{series === "separation" ? "Great-circle displacement from first epoch" : `Aperture flux (${positions[0]?.flux_unit ?? "data units"})`}</span>}<small>{series === "offset" ? "Registered WCS positions · uncertainty bars include centroid and registration terms" : series === "separation" ? "Derived from measured epoch coordinates · no interpolated positions" : "Photometric apertures only · calibration and PSF effects have not been modeled as variability"}</small></div>
  </div>;
}

export function MotionAnalytics() {
  const [ra, setRa] = useState("210.80225");
  const [dec, setDec] = useState("54.34894");
  const [name, setName] = useState("");
  const [radius, setRadius] = useState("0.1");
  const [release, setRelease] = useState("dr1");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [matchRadius, setMatchRadius] = useState("30");
  const [thresholdSigma, setThresholdSigma] = useState("5");
  const [observations, setObservations] = useState<Observation[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [epochIndex, setEpochIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [loadingBenchmark, setLoadingBenchmark] = useState(false);
  const [catalogueMatches, setCatalogueMatches] = useState<CatalogueMatchResponse | null>(null);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState("");
  const [catalogueRadius, setCatalogueRadius] = useState("5");
  const [distance, setDistance] = useState("");
  const [tab, setTab] = useState<"observations" | "ed138">("observations");
  const [previewError, setPreviewError] = useState(false);
  const chartRef = useRef<SVGSVGElement>(null);
  const panStart = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number } | null>(null);
  const picked = useMemo(() => selectedIds.map((id) => observations.find((item) => item.id === id)).filter((item): item is Observation => Boolean(item)), [observations, selectedIds]);
  const readiness = compatible(picked);
  const activeTrack = analysis?.tracks.find((track) => track.source_id === activeTrackId) ?? analysis?.tracks[0] ?? null;
  const currentEpoch = analysis?.epochs[epochIndex] ?? null;
  const firstSelected = analysis?.epochs[0] ?? null;
  const lastSelected = analysis?.epochs[analysis.epochs.length - 1] ?? null;
  const currentObservation = observations.find((item) => item.id === currentEpoch?.epoch_id) ?? picked.find((item) => item.id === currentEpoch?.epoch_id) ?? null;
  const earlierObservation = observations.find((item) => item.id === firstSelected?.epoch_id) ?? picked.find((item) => item.id === firstSelected?.epoch_id) ?? null;
  const laterObservation = observations.find((item) => item.id === lastSelected?.epoch_id) ?? picked.find((item) => item.id === lastSelected?.epoch_id) ?? null;

  useEffect(() => {
    if (!isPlaying || !analysis || analysis.epochs.length < 2) return;
    const timer = window.setInterval(() => setEpochIndex((index) => (index + 1) % analysis.epochs.length), 1700);
    return () => window.clearInterval(timer);
  }, [isPlaying, analysis]);

  useEffect(() => { setPreviewError(false); }, [currentEpoch?.epoch_id, comparing]);
  useEffect(() => { setCatalogueMatches(null); setCatalogueError(""); }, [activeTrack?.source_id]);

  async function searchObservations(event?: FormEvent, override?: { ra: number; dec: number }) {
    event?.preventDefault(); setNotice(null); setAnalysis(null); setSelectedIds([]); setLoadingSearch(true); setIsPlaying(false);
    try {
      let queryRa = override?.ra ?? Number(ra), queryDec = override?.dec ?? Number(dec);
      if (name.trim() && !override) {
        const resolved = await fetch(`${API_BASE}/api/resolve?name=${encodeURIComponent(name.trim())}`, { signal: AbortSignal.timeout(15000) });
        const payload = await resolved.json(); if (!resolved.ok) throw new Error(messageFrom(payload.detail, "The object name could not be resolved."));
        queryRa = Number(payload.ra); queryDec = Number(payload.dec); setRa(String(queryRa)); setDec(String(queryDec));
      }
      if (!Number.isFinite(queryRa) || queryRa < 0 || queryRa >= 360 || !Number.isFinite(queryDec) || queryDec < -90 || queryDec > 90) throw new Error("Enter valid ICRS coordinates before searching.");
      const params = new URLSearchParams({ ra: String(queryRa), dec: String(queryDec), radius: String(Number(radius)), release, limit: "100" });
      if (fromDate) params.set("start_date", fromDate);
      if (toDate) params.set("end_date", toDate);
      const response = await fetch(`${API_BASE}/api/observations?${params}`, { signal: AbortSignal.timeout(70000) });
      const payload = await response.json(); if (!response.ok) throw new Error(messageFrom(payload.detail, "IRSA could not return observations for this region."));
      setObservations(payload.observations ?? []);
      if (!payload.observations?.length) setNotice({ kind: "info", text: payload.message || "No SPHEREx spectral-image products cover this region and filter." });
      else setNotice({ kind: "info", text: `${payload.observations.length} archive product${payload.observations.length === 1 ? "" : "s"} returned from NASA/IPAC IRSA. Choose compatible epochs to run source analysis.` });
    } catch (error) { setObservations([]); setNotice({ kind: "error", text: error instanceof Error ? error.message : "The archive request failed. Try again shortly." }); }
    finally { setLoadingSearch(false); }
  }

  function toggleObservation(observation: Observation) {
    setSelectedIds((ids) => {
      const has = ids.includes(observation.id);
      if (has) return ids.filter((id) => id !== observation.id);
      if (ids.length >= 6) { setNotice({ kind: "info", text: "The motion analysis accepts up to six epochs at a time." }); return ids; }
      return [...ids, observation.id];
    });
  }

  async function runAnalysis() {
    if (!readiness.ok) return;
    setLoadingAnalysis(true); setNotice(null); setIsPlaying(false); setCatalogueMatches(null); setCatalogueError("");
    try {
      const response = await fetch(`${API_BASE}/api/motion/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(180000), body: JSON.stringify({
        ra: Number(ra), dec: Number(dec), cutout_size_deg: Math.min(0.4, Math.max(0.04, Number(radius) * 1.2)), match_radius_arcsec: Number(matchRadius), threshold_sigma: Number(thresholdSigma),
        distance_pc: distance && Number(distance) > 0 ? Number(distance) : null,
        epochs: picked.map((item) => ({ id: item.id, product_id: item.product_id, original_url: item.original_url, collection: item.collection, release: item.release, observation_start: item.observation_start, calibration_level: item.calibration_level, wavelength_min_um: item.wavelength_min_um, wavelength_max_um: item.wavelength_max_um, resolution_arcsec: item.resolution_arcsec })),
      }) });
      const payload = await response.json(); if (!response.ok) throw new Error(messageFrom(payload.detail, "Source detection could not complete for the selected FITS products."));
      setAnalysis(payload); setEpochIndex(0); setActiveTrackId(payload.tracks?.[0]?.source_id ?? null);
      setNotice({ kind: payload.status === "partial" ? "info" : "info", text: `${payload.tracks?.length ?? 0} positional track${payload.tracks?.length === 1 ? "" : "s"} calculated from ${payload.epochs?.length ?? 0} compatible FITS epoch${payload.epochs?.length === 1 ? "" : "s"}. Tracks are local detections, not catalog identifications.` });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "The selected FITS observations could not be processed." }); }
    finally { setLoadingAnalysis(false); }
  }

  async function findCatalogueMatches() {
    if (!activeTrack) return;
    setCatalogueLoading(true); setCatalogueError(""); setCatalogueMatches(null);
    try {
      const params = new URLSearchParams({ ra: String(activeTrack.reference_position.ra_deg), dec: String(activeTrack.reference_position.dec_deg), radius_arcsec: catalogueRadius });
      const response = await fetch(`${API_BASE}/api/catalog/matches?${params}`, { signal: AbortSignal.timeout(45000) });
      const payload = await response.json() as CatalogueMatchResponse & { detail?: string };
      if (!response.ok) throw new Error(messageFrom(payload.detail, "IRSA catalogue matching is temporarily unavailable."));
      setCatalogueMatches(payload);
    } catch (error) {
      setCatalogueError(error instanceof Error ? error.message : "The catalogue query could not be completed.");
    } finally { setCatalogueLoading(false); }
  }

  async function loadBenchmark() {
    setLoadingBenchmark(true); setNotice(null);
    try {
      const response = await fetch(`${API_BASE}/api/tno/ed138/observations?validate_ephemeris=true`, { signal: AbortSignal.timeout(90000) });
      const payload = await response.json(); if (!response.ok) throw new Error(messageFrom(payload.detail, "Published benchmark astrometry is currently unavailable."));
      setBenchmark(payload); setTab("ed138");
      setNotice({ kind: "info", text: `${payload.count} published astrometry measurements loaded. This is external benchmark data, not a SPHEREx detection.` });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "The ED138 benchmark could not be loaded." }); }
    finally { setLoadingBenchmark(false); }
  }

  function searchBenchmarkField() {
    const row = benchmark?.observations[0]; if (!row) return;
    setRa(String(row.ra_deg)); setDec(String(row.dec_deg)); setName(""); setRelease("dr1"); setTab("observations"); setNotice({ kind: "info", text: "Searching SPHEREx DR1 at the first published ED138 position. Archive coverage is not assumed." });
    void searchObservations(undefined, { ra: row.ra_deg, dec: row.dec_deg });
  }

  function exportCsv() {
    if (!activeTrack || !analysis) return;
    const rows: string[][] = [["source_id", "classification", "observation_utc", "product_id", "observed_ra_deg", "observed_dec_deg", "registered_ra_deg", "registered_dec_deg", "east_offset_arcsec", "north_offset_arcsec", "position_uncertainty_arcsec", "local_wavelength_um", "local_bandwidth_um", "local_passband_compatibility", "flux", "flux_uncertainty", "flux_unit", "signal_to_noise", "angular_rate_arcsec_hour", "total_motion_arcsec_per_year", "motion_uncertainty_arcsec_per_year", "transverse_velocity_km_s", "source"]];
    const exportedVelocity = activeTrack.transverse_velocity_kms ?? (activeTrack.proper_motion && Number(distance) > 0 ? 4.74047 * activeTrack.proper_motion.total_arcsec_per_year * Number(distance) : "");
    for (const p of activeTrack.positions) rows.push([activeTrack.source_id, activeTrack.classification, p.observation_start, p.product_id, String(p.observed_ra_deg), String(p.observed_dec_deg), String(p.ra_deg), String(p.dec_deg), String(p.east_offset_arcsec), String(p.north_offset_arcsec), String(p.position_uncertainty_arcsec), String(p.local_wavelength_um ?? ""), String(p.local_bandwidth_um ?? ""), activeTrack.spectral_compatibility?.status ?? "unavailable", String(p.flux), String(p.flux_uncertainty), p.flux_unit, String(p.signal_to_noise), String(activeTrack.angular_rate_arcsec_hour ?? ""), String(activeTrack.proper_motion?.total_arcsec_per_year ?? ""), String(activeTrack.proper_motion?.uncertainty_arcsec_per_year ?? ""), String(exportedVelocity), "NASA/IPAC IRSA SPHEREx FITS cutout; calculated by ASCENTRA"]);
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    downloadFile(`${activeTrack.source_id}-motion.csv`, csv, "text/csv;charset=utf-8");
  }

  const imageRa = analysis?.query.ra ?? Number(ra), imageDec = analysis?.query.dec ?? Number(dec);
  const currentImage = currentObservation ? previewUrl(currentObservation, imageRa, imageDec, { stretch: "asinh", contrast: 1 }) : "";
  const earlierImage = earlierObservation ? previewUrl(earlierObservation, imageRa, imageDec, { stretch: "asinh", contrast: 1 }) : "";
  const laterImage = laterObservation ? previewUrl(laterObservation, imageRa, imageDec, { stretch: "asinh", contrast: 1 }) : "";
  const currentSize = currentEpoch ? `${currentEpoch.display_width} / ${currentEpoch.display_height}` : "4 / 3";
  const benchmarkRate = benchmark?.benchmark_rate_arcsec_min ?? 0.043;
  const trajectoryScale = activeTrack ? 39 / Math.max(2, ...activeTrack.positions.flatMap((point) => [Math.abs(point.east_offset_arcsec), Math.abs(point.north_offset_arcsec)])) : 6.5;
  const trajectoryPoint = (point: Position) => `${130 + point.east_offset_arcsec * trajectoryScale},${64 - point.north_offset_arcsec * trajectoryScale}`;
  const calculatedVelocity = activeTrack?.transverse_velocity_kms ?? (activeTrack?.proper_motion && Number(distance) > 0 ? 4.74047 * activeTrack.proper_motion.total_arcsec_per_year * Number(distance) : null);

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button, input, a")) return;
    panStart.current = { pointerX: event.clientX, pointerY: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panStart.current) return;
    setPan({ x: panStart.current.panX + event.clientX - panStart.current.pointerX, y: panStart.current.panY + event.clientY - panStart.current.pointerY });
  }
  function stopPan(event: ReactPointerEvent<HTMLDivElement>) {
    panStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function zoomWithWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!analysis) return;
    event.preventDefault();
    setZoom((value) => Math.min(5, Math.max(1, value * Math.exp(-event.deltaY * 0.001))));
  }
  function resetImageView() { setZoom(1); setPan({ x: 0, y: 0 }); }

  return <div className="motion-lab">
    <section className="motion-hero">
      <div><div className="eyebrow"><span className="eyebrow-star">✳</span> ASCENTRA · OBSERVATORY TOOLS</div><div className="motion-title-line"><span className="motion-orbit-mark"><Telescope size={19} /></span><div><h1>Motion <span className="gradient-text">Analytics</span></h1><p>Measure how sources shift across genuine SPHEREx epochs, with every step tied to the archive record.</p></div></div></div>
      <div className="motion-hero-status"><span className="motion-live-dot" /> NASA/IPAC IRSA · LIVE QUERY <Link href="/tno-lab">Open TNO Lab <ArrowRight size={12} /></Link></div>
    </section>

    <div className="motion-workspace">
      <aside className="motion-panel motion-search-panel">
        <div className="motion-panel-heading"><span className="motion-panel-icon"><Search size={15} /></span><div><span className="motion-micro-label">ARCHIVE QUERY</span><h2>Choose a sky region</h2></div></div>
        <div className="motion-tabs" role="tablist" aria-label="Motion dataset selector">
          <button role="tab" aria-selected={tab === "observations"} className={tab === "observations" ? "selected" : ""} onClick={() => setTab("observations")}>SPHEREx</button>
          <button role="tab" aria-selected={tab === "ed138"} className={tab === "ed138" ? "selected" : ""} onClick={() => setTab("ed138")}>ED138 benchmark</button>
        </div>
        {tab === "observations" ? <>
          <form onSubmit={searchObservations} className="motion-search-form">
            <label className="motion-field-label" htmlFor="motion-name">Object name <small>OPTIONAL</small></label>
            <div className="motion-input motion-name-input"><input id="motion-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. M31, Vega" /><CircleHelp size={13} aria-hidden="true" /></div>
            <label className="motion-field-label">ICRS coordinates <small>DEGREES</small></label>
            <div className="motion-coordinate-row"><label><span>RA</span><input aria-label="Right ascension degrees" type="number" min="0" max="359.999999" step="any" value={ra} onChange={(event) => setRa(event.target.value)} /></label><label><span>Dec</span><input aria-label="Declination degrees" type="number" min="-90" max="90" step="any" value={dec} onChange={(event) => setDec(event.target.value)} /></label></div>
            <div className="motion-coordinate-note"><MapPin size={11} /> ICRS · J2000-compatible archive coordinates</div>
          <div className="motion-form-pair"><label><span>Search radius</span><select value={radius} onChange={(event) => setRadius(event.target.value)}><option value="0.05">0.05°</option><option value="0.1">0.10°</option><option value="0.2">0.20°</option><option value="0.5">0.50°</option><option value="1">1.00°</option></select></label><label><span>Collection</span><select value={release} onChange={(event) => setRelease(event.target.value)}><option value="dr1">DR1</option><option value="dr1_deep">DR1 Deep</option><option value="qr3">QR3</option><option value="qr3_deep">QR3 Deep</option></select></label></div>
            <div className="motion-form-pair"><label><span>Match radius</span><select value={matchRadius} onChange={(event) => setMatchRadius(event.target.value)}><option value="10">10″</option><option value="30">30″</option><option value="60">60″</option><option value="120">120″</option></select></label><label><span>Detection threshold</span><select value={thresholdSigma} onChange={(event) => setThresholdSigma(event.target.value)}><option value="3">3σ · exploratory</option><option value="5">5σ · default</option><option value="7">7σ · conservative</option></select></label></div>
            <div className="motion-form-pair motion-date-pair"><label><span>From date</span><input aria-label="Observation from date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label><span>To date</span><input aria-label="Observation to date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div>
            <button className="motion-primary-button" type="submit" disabled={loadingSearch}>{loadingSearch ? <LoaderCircle size={14} className="spin" /> : <Radio size={14} />}{loadingSearch ? "Querying archive…" : "Search IRSA observations"}</button>
          </form>
          <div className="motion-section-divider"><span>RETURNED PRODUCTS</span><span>{observations.length}</span></div>
          {observations.length ? <div className="motion-observation-list">{observations.map((item) => {
            const selected = selectedIds.includes(item.id);
            return <div className={`motion-observation-item ${selected ? "selected" : ""}`} key={item.id}>
              <input type="checkbox" checked={selected} onChange={() => toggleObservation(item)} aria-label={`Select ${item.product_id} from ${dateLabel(item.observation_start || "")}`} />
              <span className="motion-obs-copy"><strong>{item.product_id || item.id}</strong><small>{dateLabel(item.observation_start || "")}</small><small>{wavelengthLabel(item.wavelength_min_um, item.wavelength_max_um)} · cal {item.calibration_level ?? "—"}</small></span>
              <a href={item.original_url} target="_blank" rel="noreferrer" aria-label={`Open original IRSA product ${item.product_id}`} onClick={(event) => event.stopPropagation()}><ExternalLink size={12} /></a>
            </div>;
          })}</div> : <div className="motion-empty-list"><Waves size={17} /><span>Search the archive to list image products for this region.</span></div>}
          {picked.length > 0 && <div className={`motion-readiness ${readiness.ok ? "ready" : ""}`}><span className="motion-readiness-led" /><div><strong>{readiness.ok ? `${picked.length} epochs pass the metadata check` : "Compatibility check"}</strong><small>{readiness.ok ? "Local LVF passbands are checked per source after FITS retrieval." : readiness.reasons[0]}</small></div></div>}
          <button className="motion-run-button" onClick={runAnalysis} disabled={!readiness.ok || loadingAnalysis}>{loadingAnalysis ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{loadingAnalysis ? "Processing FITS cutouts…" : "Detect & track sources"}</button>
          <p className="motion-side-footnote">Regional FITS cutouts are retrieved from IRSA on demand. Select 2–6 epochs. Different releases, calibration levels, channels or timestamps cannot be mixed.</p>
        </> : <div className="motion-benchmark-panel">
          <div className="motion-benchmark-mark"><Target size={17} /></div><span className="motion-micro-label">FEATURED BENCHMARK</span><h3>2026 ED138</h3><p>Published astrometry and independent JPL Horizons positions from ASCENTRA’s existing TNO investigation service.</p>
          <button className="motion-primary-button" onClick={loadBenchmark} disabled={loadingBenchmark}>{loadingBenchmark ? <LoaderCircle size={14} className="spin" /> : <Activity size={14} />}{loadingBenchmark ? "Loading published data…" : benchmark ? "Refresh benchmark data" : "Load published benchmark"}</button>
          {benchmark && <><div className="motion-benchmark-rate"><small>ILLUSTRATIVE REFERENCE RATE</small><strong>{benchmarkRate}″ / minute</strong><span>{(benchmarkRate * 60).toFixed(2)}″ / hour · {(benchmarkRate * 1440).toFixed(2)}″ / day · {(benchmarkRate * 1440 / 60).toFixed(3)}′ / day</span></div><div className="motion-benchmark-meta"><span>Published rows<strong>{benchmark.count}</strong></span><span>Horizons validation<strong>{benchmark.validation.status === "complete" ? `${benchmark.validation.matched} matched` : benchmark.validation.status}</strong></span><span>Retrieved<strong>{dateLabel(benchmark.retrieved_at)}</strong></span></div><button className="motion-secondary-button" onClick={searchBenchmarkField} disabled={!benchmark.observations.length}><Search size={12} /> Search IRSA at a published position</button><p className="motion-disclaimer">The 0.043″/min value is only an illustrative benchmark. It is not treated as ED138’s constant or current rate. Rubin image access may be restricted.</p></>}
          <Link className="motion-secondary-link" href="/tno-lab">Explore full ED138 orbit &amp; ephemeris <ArrowRight size={12} /></Link>
        </div>}
      </aside>

      <section className="motion-panel motion-viewer-panel">
        <div className="motion-viewer-heading"><div><span className="motion-micro-label">SKY POSITION · {currentEpoch ? "FITS ANALYSIS" : "READY TO EXPLORE"}</span><h2>{activeTrack ? activeTrack.source_id : "Select an observation track"}</h2></div><div className="motion-viewer-actions"><button className={`motion-view-button ${comparing ? "active" : ""}`} onClick={() => setComparing((value) => !value)} disabled={!analysis || analysis.epochs.length < 2} title="Compare earliest and latest selected epochs">Compare epochs</button><button className="motion-view-button" onClick={() => { setEpochIndex(0); setIsPlaying(false); }} disabled={!analysis}><RotateCcw size={12} /> Reset</button></div></div>
        <div className="motion-image-stage" style={{ aspectRatio: comparing && firstSelected && lastSelected ? `${Math.max(firstSelected.display_width, lastSelected.display_width)} / ${Math.max(firstSelected.display_height, lastSelected.display_height)}` : currentSize }} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan} onWheel={zoomWithWheel}>
          {analysis && currentEpoch && currentObservation && !previewError ? <>
            <div className="motion-image-content" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? "grab" : "crosshair" }}>
              <NextImage className="motion-sky-image" src={comparing && earlierObservation ? earlierImage : currentImage} alt={`SPHEREx ${comparing ? "earlier epoch" : "observation"} around RA ${ra} degrees, Dec ${dec} degrees`} fill unoptimized sizes="(max-width: 850px) 100vw, 60vw" onError={() => setPreviewError(true)} />
              {comparing && laterObservation && <NextImage className="motion-sky-image motion-comparison-image" src={laterImage} alt="Later SPHEREx observation in epoch comparison" fill unoptimized sizes="(max-width: 850px) 100vw, 60vw" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} onError={() => setPreviewError(true)} />}
              {!comparing && currentEpoch.display_width > 0 && <svg className="motion-source-overlay" viewBox={`0 0 ${currentEpoch.display_width} ${currentEpoch.display_height}`} preserveAspectRatio="xMidYMid meet" aria-label="Detected source locations">
                {currentEpoch.detections.map((detection, index) => <g key={`${currentEpoch.epoch_id}-det-${index}`}><circle cx={detection.x_display} cy={detection.y_display} r={activeTrack?.positions.some((point) => point.epoch_id === currentEpoch.epoch_id && Math.abs(point.x_display - detection.x_display) < 0.01 && Math.abs(point.y_display - detection.y_display) < 0.01) ? 8 : 4} className={activeTrack?.positions.some((point) => point.epoch_id === currentEpoch.epoch_id && Math.abs(point.x_display - detection.x_display) < 0.01 && Math.abs(point.y_display - detection.y_display) < 0.01) ? "motion-marker selected" : "motion-marker"} /></g>)}
              </svg>}
              {comparing && <div className="motion-compare-rule" style={{ left: `${split}%` }} />}
            </div>
            {comparing && <><span className="motion-compare-label earlier">EARLIER · {firstSelected ? dateLabel(firstSelected.observation_start) : "—"}</span><span className="motion-compare-label later">LATER · {lastSelected ? dateLabel(lastSelected.observation_start) : "—"}</span></>}
            <div className="motion-image-coords"><MapPin size={10} /> {currentEpoch.wcs.center_ra_deg.toFixed(5)}°, {currentEpoch.wcs.center_dec_deg.toFixed(5)}° <span>·</span> {currentEpoch.image_width} × {currentEpoch.image_height} px</div>
            <span className="motion-image-badge">NASA/IPAC IRSA · {currentEpoch.release.toUpperCase()}</span>
            <div className="motion-image-zoom-controls" onPointerDown={(event) => event.stopPropagation()}><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value / 1.25))}><Minus size={12} /></button><span>{zoom.toFixed(1)}×</span><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(5, value * 1.25))}><Plus size={12} /></button><button aria-label="Reset image zoom and pan" onClick={resetImageView}><RotateCcw size={11} /></button></div>
          </> : <div className="motion-viewer-empty"><div className="motion-scanner"><span /></div><strong>{analysis ? "Preview unavailable" : "Begin with an archive query"}</strong><p>{analysis ? "The FITS analysis completed, but the image preview could not be loaded. Open the original data product from the observation list." : "Search a sky position, select compatible observation dates, and run source detection to open the viewer."}</p>{previewError && currentObservation && <a href={currentObservation.original_url} target="_blank" rel="noreferrer">Open original FITS <ExternalLink size={11} /></a>}</div>}
        </div>
        {comparing && analysis && <div className="motion-split-control"><span>EARLIER</span><input aria-label="Epoch comparison divider" type="range" min="5" max="95" value={split} onChange={(event) => setSplit(Number(event.target.value))} /><span>LATER</span></div>}
        <div className="motion-timeline">
          <div className="motion-timeline-head"><span><Clock3 size={12} /> OBSERVATION TIMELINE</span><div className="motion-play-controls"><button aria-label="Previous observation" disabled={!analysis} onClick={() => setEpochIndex((index) => Math.max(0, index - 1))}><ArrowLeft size={13} /></button><button aria-label={isPlaying ? "Pause playback" : "Play observations"} disabled={!analysis || analysis.epochs.length < 2} onClick={() => setIsPlaying((value) => !value)}>{isPlaying ? <Pause size={12} /> : <Play size={12} />}</button><button aria-label="Next observation" disabled={!analysis} onClick={() => setEpochIndex((index) => Math.min((analysis?.epochs.length ?? 1) - 1, index + 1))}><ArrowRight size={13} /></button></div></div>
          {analysis ? <><input className="motion-epoch-range" aria-label="Select observation epoch" type="range" min="0" max={Math.max(0, analysis.epochs.length - 1)} value={epochIndex} onChange={(event) => setEpochIndex(Number(event.target.value))} /><div className="motion-epoch-dates"><span>{dateLabel(analysis.epochs[0].observation_start)}</span><strong>{currentEpoch ? dateTimeLabel(currentEpoch.observation_start) : "—"} · {currentEpoch?.product_id}</strong><span>{dateLabel(analysis.epochs[analysis.epochs.length - 1].observation_start)}</span></div></> : <div className="motion-timeline-placeholder">Available epochs appear here after source analysis.</div>}
        </div>
        {analysis && <div className="motion-image-provenance"><span><i /> DIRECT FITS OBSERVATION</span><span>{currentEpoch?.source_count ?? 0} image sources detected</span><span>Flags {currentEpoch?.quality.flags_applied ? "masked" : "unavailable"}</span><span>Variance {currentEpoch?.quality.variance_applied ? "used" : "unavailable"}</span>{currentEpoch?.wcs.warnings?.map((warning) => <span className="motion-wcs-warning" key={warning} role="note">WCS caution: {warning}</span>)}</div>}
      </section>

      <aside className="motion-panel motion-insight-panel">
        <div className="motion-panel-heading"><span className="motion-panel-icon violet"><Activity size={15} /></span><div><span className="motion-micro-label">MEASUREMENT LEDGER</span><h2>Track insights</h2></div></div>
        {notice && <div className={`motion-notice ${notice.kind}`} role="status">{notice.text}</div>}
        {analysis && activeTrack ? <>
          <div className="motion-track-select">{analysis.tracks.slice(0, 24).map((track) => <button key={track.source_id} className={track.source_id === activeTrack.source_id ? "active" : ""} onClick={() => setActiveTrackId(track.source_id)} title={`${track.matched_epochs} matched epochs`}>{track.source_id}</button>)}</div>
          <div className="motion-classification"><span className={activeTrack.classification === "motion candidate" ? "candidate" : "measured"} />{activeTrack.classification}</div>
          <div className="motion-measurement-grid">
            <div><span>RA · ICRS</span><strong>{activeTrack.reference_position.ra_deg.toFixed(6)}°</strong></div><div><span>Dec · ICRS</span><strong>{activeTrack.reference_position.dec_deg.toFixed(6)}°</strong></div>
            <div><span>Angular displacement</span><strong>{activeTrack.angular_displacement_arcsec == null ? "—" : `${shortNumber(activeTrack.angular_displacement_arcsec)}″`}</strong><small>{activeTrack.angular_displacement_arcsec == null ? "Two epochs needed" : `${shortNumber(activeTrack.angular_displacement_arcsec / 60, 4)}′ · ${shortNumber(activeTrack.angular_displacement_arcsec / 3600, 6)}°`}</small></div>
            <div><span>Endpoint rate</span><strong>{activeTrack.angular_rate_arcsec_hour == null ? "—" : `${shortNumber(activeTrack.angular_rate_arcsec_hour, 5)}″ / h`}</strong><small>{activeTrack.angular_rate_arcsec_hour == null ? "Two distinct timestamps needed" : `${shortNumber(activeTrack.angular_rate_arcsec_hour * 24, 3)}″ / day · great-circle endpoint rate`}</small></div>
            <div><span>Apparent angular motion</span><strong>{activeTrack.proper_motion ? `${shortNumber(activeTrack.proper_motion.total_arcsec_per_year, 2)}″ / yr` : "Unavailable"}</strong><small>{activeTrack.proper_motion ? `± ${shortNumber(activeTrack.proper_motion.uncertainty_arcsec_per_year, 2)}″/yr · ${activeTrack.proper_motion.baseline_days.toFixed(1)} d` : activeTrack.classification.replace(/^unavailable:\s*/i, "")}</small></div>
            <div><span>East · North</span><strong>{activeTrack.proper_motion ? `${shortNumber(activeTrack.proper_motion.ra_cosdec_arcsec_per_year, 2)} · ${shortNumber(activeTrack.proper_motion.dec_arcsec_per_year, 2)}″/yr` : "—"}</strong><small>East term is μRA cos(Dec)</small></div>
            <div><span>Transverse velocity</span><strong>{calculatedVelocity == null ? "Unavailable" : `${shortNumber(calculatedVelocity, 4)} km/s`}</strong><small>{calculatedVelocity == null ? "Requires distance in parsecs" : "Calculated from supplied distance"}</small></div>
            <div><span>Source detection</span><strong>S/N {shortNumber(activeTrack.source_quality.reference_snr, 1)}</strong><small>{activeTrack.matched_epochs} matched of {analysis.epochs.length} epochs · σpos {shortNumber(activeTrack.source_quality.reference_position_uncertainty_arcsec, 2)}″</small></div>
            <div><span>Approx. local LVF passbands</span><strong>{activeTrack.spectral_compatibility?.compatible === true ? `${activeTrack.spectral_compatibility.common_wavelength_range_um?.map((value) => value.toFixed(4)).join("–")} μm · compatible` : "Not comparable"}</strong><small>{activeTrack.positions.map((point) => point.local_wavelength_um == null ? "—" : `${point.local_wavelength_um.toFixed(4)} μm`).join(" · ")} · {activeTrack.spectral_compatibility?.status ?? "not enough matched positions"}; visualization-level lookup, not science-grade spectral calibration</small></div>
          </div>
          <section className="motion-catalog-panel" aria-label="Public catalogue positional cross-match">
            <div className="motion-catalog-head"><div><span className="motion-micro-label">PUBLIC CATALOGUE LOOKUP</span><strong>Possible positional counterparts</strong></div><a href="https://irsa.ipac.caltech.edu/docs/howto/gator_prog_interface.html" target="_blank" rel="noreferrer" aria-label="IRSA Gator documentation"><ExternalLink size={12} /></a></div>
            <p>Query 2MASS, AllWISE and Gaia DR3 near this measured track position. Candidates are ranked by angular separation only; this is not an identification probability.</p>
            <div className="motion-catalog-controls"><label>Match radius · arcsec<input type="number" min="0.2" max="60" step="0.2" value={catalogueRadius} onChange={(event) => setCatalogueRadius(event.target.value)} /></label><button onClick={findCatalogueMatches} disabled={catalogueLoading}>{catalogueLoading ? <LoaderCircle size={12} className="spin" /> : <Search size={12} />}{catalogueLoading ? "Querying IRSA" : catalogueMatches ? "Refresh matches" : "Find matches"}</button></div>
            {catalogueError && <div className="motion-catalog-error" role="status">{catalogueError}</div>}
            {catalogueMatches && <><div className="motion-catalog-provenance">{catalogueMatches.source} · {new Date(catalogueMatches.retrieved_at).toLocaleString()} · radius {catalogueMatches.search_radius_arcsec}″</div><div className="motion-catalog-results">{catalogueMatches.catalogues.map((catalogue) => <article key={catalogue.catalogue} className="motion-catalog-result"><div className="motion-catalog-result-head"><strong>{catalogue.label}</strong><span>{catalogue.matches.length ? `${catalogue.matches.length} shown of ${catalogue.returned_rows ?? catalogue.matches.length} returned${catalogue.truncated ? " · capped" : ""}` : catalogue.status}</span></div>{catalogue.matches.length ? catalogue.matches.map((candidate, index) => <div className="motion-catalog-candidate" key={`${catalogue.catalogue}-${candidate.source_id ?? candidate.designation ?? index}`}><div><strong>{candidate.designation ?? candidate.source_id ?? `Candidate ${index + 1}`}</strong><small>{shortNumber(candidate.separation_arcsec, 3)}″ · {candidate.ra_deg.toFixed(6)}°, {candidate.dec_deg.toFixed(6)}°</small></div><small>{[
              candidate.j_m == null ? null : `J ${shortNumber(candidate.j_m, 2)}`,
              candidate.h_m == null ? null : `H ${shortNumber(candidate.h_m, 2)}`,
              candidate.k_m == null ? null : `Ks ${shortNumber(candidate.k_m, 2)}`,
              candidate.w1mpro == null ? null : `W1 ${shortNumber(candidate.w1mpro, 2)}`,
              candidate.w2mpro == null ? null : `W2 ${shortNumber(candidate.w2mpro, 2)}`,
              candidate.phot_g_mean_mag == null ? null : `G ${shortNumber(candidate.phot_g_mean_mag, 2)}`,
              candidate.parallax == null ? null : `Parallax ${shortNumber(candidate.parallax, 2)} mas`,
              candidate.pmra == null || candidate.pmdec == null ? null : `μ ${shortNumber(candidate.pmra, 1)}, ${shortNumber(candidate.pmdec, 1)} mas/yr`,
            ].filter(Boolean).join(" · ") || "No selected brightness or motion fields reported"}</small></div>) : <small className="motion-catalog-empty">{catalogue.message || (catalogue.status === "no match within radius" ? "No source from this catalogue falls inside the selected radius." : "No catalogue results available.")}</small>}{catalogue.query_url && <a className="motion-catalog-open" href={catalogue.query_url} target="_blank" rel="noreferrer">Open {catalogue.label} query <ExternalLink size={10} /></a>}</article>)}</div><small className="motion-catalog-limit">Catalogue photometry is from separate surveys, filters and epochs. No brightness, spectrum, or proper-motion evidence is combined into a match score. Review the records before assigning an identity.</small></>}
          </section>
          <Link className="motion-spectrum-link" href={`/spectral?ra=${encodeURIComponent(String(activeTrack.reference_position.ra_deg))}&dec=${encodeURIComponent(String(activeTrack.reference_position.dec_deg))}`}><Waves size={12} /> Sample this detected position in the DR1 All-Sky Cube <ArrowRight size={11} /></Link>
          <Link className="motion-spectrum-link" href={`/cosmic-explorer?ra=${encodeURIComponent(String(activeTrack.reference_position.ra_deg))}&dec=${encodeURIComponent(String(activeTrack.reference_position.dec_deg))}&target=${encodeURIComponent(activeTrack.source_id)}`}><Globe2 size={12} /> View this measured track in Cosmic Explorer <ArrowRight size={11} /></Link>
          <label className="motion-distance-field"><span>Optional distance for V<sub>t</sub></span><div><input type="number" min="0.000001" step="any" placeholder="Parsecs" value={distance} onChange={(event) => setDistance(event.target.value)} /><small>μ in ″/yr × d in pc</small></div></label>
          <div className="motion-ledger-actions"><button onClick={exportCsv}><ArrowDownToLine size={12} /> Export CSV</button><Link href="/sources">Method &amp; provenance <ArrowRight size={11} /></Link></div>
          {analysis.unavailable_epochs.length > 0 && <div className="motion-unavailable"><strong>Some cutouts were unavailable</strong>{analysis.unavailable_epochs.map((item) => <small key={item.epoch_id}>{item.epoch_id}: {item.detail}</small>)}</div>}
        </> : <div className="motion-insight-empty"><Sparkles size={17} /><strong>Measurements stay empty until calculated</strong><p>No source identities or motion results are prefilled. Select real observations and run a FITS analysis to create a provenance-linked track.</p></div>}
        {analysis && <details className="motion-methodology"><summary>Analysis and uncertainty policy</summary><ul>{analysis.methodology.map((line) => <li key={line}>{line}</li>)}</ul><p>IRSA cutout request: {analysis.compatibility.collection} · calibration {analysis.compatibility.calibration_level} · {analysis.compatibility.wavelength_min_um.toFixed(3)}–{analysis.compatibility.wavelength_max_um.toFixed(3)} μm</p></details>}
      </aside>
    </div>

    {analysis && activeTrack && <section className="motion-chart-panel motion-panel"><MotionChart track={activeTrack} svgRef={chartRef} /><div className="motion-trajectory-row"><div><span className="motion-micro-label">MEASURED SKY-PLANE PATH</span><h3>East / north trajectory</h3><p>Only measured epoch positions are connected. The connecting line is a visual guide, not an observation.</p></div><svg className="motion-trajectory" viewBox="0 0 260 128" role="img" aria-label={`East north trajectory for ${activeTrack.source_id}`}>
        <line x1="18" y1="64" x2="244" y2="64" stroke="rgba(136,164,204,.18)" /><line x1="130" y1="12" x2="130" y2="113" stroke="rgba(136,164,204,.18)" /><text x="229" y="59" className="motion-chart-tick">E</text><text x="134" y="15" className="motion-chart-tick">N</text>
        {activeTrack.positions.length > 1 && <polyline points={activeTrack.positions.map(trajectoryPoint).join(" ")} fill="none" stroke="#8ed8e9" strokeWidth="1.5" />}
        {activeTrack.positions.map((point, index) => <g key={`${point.epoch_id}-trajectory`}><circle cx={130 + point.east_offset_arcsec * trajectoryScale} cy={64 - point.north_offset_arcsec * trajectoryScale} r="4" fill={index === 0 ? "#d7b47a" : "#79dbed"} stroke="#eafaff" strokeWidth="1" /><title>{dateLabel(point.observation_start)} · {shortNumber(point.east_offset_arcsec)}″ E, {shortNumber(point.north_offset_arcsec)}″ N</title></g>)}
      </svg></div><div className="motion-validation-foot"><span><i /> CALCULATED FROM DIRECT OBSERVATIONS</span><span>IRSA · {analysis.retrieved_at}</span><span>Candidate tracks are not independent object identifications.</span></div></section>}

    {benchmark && tab === "ed138" && <section className="motion-benchmark-results motion-panel"><div className="motion-chart-top"><div><span className="motion-micro-label">PUBLISHED ASTROMETRY · EPHEMERIS CROSS-CHECK</span><h2>2026 ED138 benchmark ledger</h2><p>{benchmark.notice}</p></div><a href={benchmark.source} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Published source</a></div><div className="motion-benchmark-table-wrap"><table className="motion-benchmark-table"><thead><tr><th>UTC observation</th><th>Observatory</th><th>Filter</th><th>RA / Dec</th><th>Magnitude</th><th>JPL residual</th></tr></thead><tbody>{benchmark.observations.slice(0, 12).map((row, index) => <tr key={`${row.observed_at}-${index}`}><td>{dateTimeLabel(row.observed_at)}</td><td>{row.observatory_code}</td><td>{row.filter}</td><td>{row.ra_deg.toFixed(6)}° / {row.dec_deg.toFixed(6)}°</td><td>{shortNumber(row.magnitude, 2)}</td><td>{row.residual_arcsec == null ? "Unavailable" : `${shortNumber(row.residual_arcsec, 2)}″`}</td></tr>)}</tbody></table></div><div className="motion-validation-foot"><span>Published observations · {benchmark.count} rows</span><span>JPL Horizons validation · {benchmark.validation.status}</span><span>Retrieved {dateTimeLabel(benchmark.retrieved_at)}</span><Link href="/tno-lab">Open orbital investigation <ArrowRight size={11} /></Link></div></section>}

    <section className="motion-science-note"><div className="motion-note-icon"><CircleHelp size={15} /></div><div><strong>Scientific scope</strong><p>Current tracks use photometric peaks detected in the selected SPHEREx spectral-image FITS cutouts, registered with robust translation from mutual WCS background matches. The system reports an apparent-motion candidate only when a ≥3σ fit is constrained by at least three epochs spanning one day. It does not claim source identity, Solar System orbit, or discovery. Difference images are withheld until variance propagation and PSF matching are available.</p></div><Link href="/sources">Data notes <ArrowRight size={11} /></Link></section>
  </div>;
}
