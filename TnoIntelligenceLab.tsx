"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, Check, ChevronRight, Globe2,
  CircleHelp, Database, ExternalLink, Eye, Info, LoaderCircle, Orbit,
  RefreshCw, Satellite, ShieldCheck, Sparkles, Telescope, Waves,
} from "lucide-react";
import { API_BASE } from "@/lib/api";

type ElementValue = { value: number | null; uncertainty_1sigma: number | null; units: string | null; label: string };
type OrbitData = {
  designation: string; full_designation: string | null; object_class: string | null; spkid: string | null;
  orbit_solution_id: string | null; orbit_solution_date: string | null; orbit_epoch_jd_tdb: number | null;
  orbit_epoch: string | null; source: string | null; producer: string | null; observation_arc_days: number | null;
  first_observation_date: string | null; last_observation_date: string | null; observations_used: number | null;
  orbit_fit_rms_arcsec: number | null; condition_code: string | null;
  elements: Record<string, ElementValue>; absolute_magnitude_H: { value: number | null; uncertainty_1sigma: number | null; units: string; reference: string | null };
  covariance: { elements?: Array<{ name: string; value: string; sigma: string; units?: string | null }>; data?: string[][]; labels?: string[]; epoch?: string } | null;
  provenance: { source: string; retrieved_at: string; citation: string };
};
type Observation = {
  observed_at: string; ra_deg: number; dec_deg: number; sigma_ra_arcsec: number | null; sigma_dec_arcsec: number | null;
  magnitude: number | null; magnitude_sigma: number | null; filter: string | null; measurement_source: string | null;
  origin_code: string | null; observatory_code: string | null; provenance: { source: string; retrieved_at: string; kind: string };
  ephemeris: { ra_deg: number; dec_deg: number; source: string; center: string } | null; residual_arcsec: number | null;
};
type MotionSample = { observed_at: string; interval_minutes: number; angular_displacement_arcsec: number; angular_rate_arcsec_min: number; from: string; to: string };
type TessSectorMeasurement = { sector: number; magnitude: number; magnitude_sigma: number; detection_significance_sigma: number; epoch_label: string; provenance: { kind: string; source: string; retrieved_at: string } };
type ObservationData = {
  observations: Observation[]; motion_samples: MotionSample[]; count: number; benchmark_rate_arcsec_min: number;
  tess_sector_photometry: TessSectorMeasurement[]; tess_source_status: string; tess_source: string; tess_retrieved_at: string | null;
  validation: { status: string; matched: number; message: string | null; retrieved_at: string | null; source: string | null };
  source: string; retrieved_at: string; notice: string;
};
type EphemerisPoint = { observed_at: string; ra_deg: number; dec_deg: number; apparent_magnitude: number | null; heliocentric_distance_au: number | null; observer_distance_au: number | null; angular_rate_arcsec_hour: number | null };
type EphemerisData = { positions: EphemerisPoint[]; count: number; start_date: string; end_date: string; step_days: number; source: string; retrieved_at: string; classification: string };
type SpherexProduct = { id: string; product_id: string; release: string; observation_start: string | null; wavelength_min_um: number | null; wavelength_max_um: number | null; facility: string | null; instrument: string | null; preview_url: string; original_url: string };
type SpherexResults = { count: number; observations: SpherexProduct[]; message: string | null; truncated: boolean };

const API_TIMEOUT_MS = 45_000;
const FILTER_COLORS: Record<string, string> = { u: "#b998ff", g: "#7ac8ff", r: "#ff9e99", i: "#ffc67a", z: "#f6e08a", y: "#a5e7ce", VR: "#d2b6ff" };
const RESEARCH_LINKS = [
  ["Minor Planet Center circular", "https://minorplanetcenter.net/mpec/K26/K26U85.html"],
  ["Rubin discovery announcement", "https://rubinobservatory.org/news/rubin-first-dwarf-planet-candidate"],
  ["Published astrometry & analysis", "https://arxiv.org/abs/2610.38693"],
  ["Published TESS precovery analysis", "https://arxiv.org/abs/2610.40106"],
  ["JPL Small-Body Database", "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/"],
  ["JPL Horizons ephemeris", "https://ssd.jpl.nasa.gov/horizons/app.html#/"],
  ["Rubin image data access note", "https://prompt-products.lsst.io/products/2026-ED138/index.html"],
] as const;

function apiUrl(path: string) { return `${API_BASE}${path}`; }
async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data as T;
}
function dateLabel(value: string | null | undefined) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}
function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().replace("T", " ").replace(".000Z", " UTC").replace(/\.\d{3}Z$/, " UTC")}`;
}
function fixed(value: number | null | undefined, digits = 3) { return value == null ? "—" : value.toFixed(digits); }
function valueOf(object: OrbitData | null, key: string) { return object?.elements[key]?.value ?? null; }
function julianDate(date: Date) { return date.getTime() / 86_400_000 + 2_440_587.5; }
function keplerPeriodDays(aAu: number) { return Math.pow(aAu, 1.5) * 365.2568983; }
function orbitPeriodDays(orbit: OrbitData | null, aAu: number) { const jplPeriod = valueOf(orbit, "per"); return jplPeriod != null && jplPeriod > 0 ? jplPeriod : keplerPeriodDays(aAu); }
function orbitPeriodYears(orbit: OrbitData | null) { const a = valueOf(orbit, "a"); return a == null ? null : orbitPeriodDays(orbit, a) / 365.25; }
function angularSeparationArcsec(ra1: number, dec1: number, ra2: number, dec2: number) {
  const rad = Math.PI / 180, d1 = dec1 * rad, d2 = dec2 * rad, dra = (ra2 - ra1) * rad, ddec = d2 - d1;
  const hav = Math.sin(ddec / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin(dra / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, hav)))) / rad * 3600;
}

function orbitalPosition(eccentricAnomaly: number, a: number, e: number, inclination: number, node: number, perihelion: number) {
  const nu = Math.sqrt(1 - e * e);
  const x = a * (Math.cos(eccentricAnomaly) - e);
  const y = a * nu * Math.sin(eccentricAnomaly);
  const i = inclination * Math.PI / 180, o = node * Math.PI / 180, w = perihelion * Math.PI / 180;
  return {
    x: (Math.cos(o) * Math.cos(w) - Math.sin(o) * Math.sin(w) * Math.cos(i)) * x + (-Math.cos(o) * Math.sin(w) - Math.sin(o) * Math.cos(w) * Math.cos(i)) * y,
    y: (Math.sin(o) * Math.cos(w) + Math.cos(o) * Math.sin(w) * Math.cos(i)) * x + (-Math.sin(o) * Math.sin(w) + Math.cos(o) * Math.cos(w) * Math.cos(i)) * y,
    z: Math.sin(w) * Math.sin(i) * x + Math.cos(w) * Math.sin(i) * y,
  };
}
function currentKeplerPoint(orbit: OrbitData | null, date: Date) {
  const a = valueOf(orbit, "a"), e = valueOf(orbit, "e");
  const epoch = orbit?.orbit_epoch_jd_tdb, M = valueOf(orbit, "ma"), inclination = valueOf(orbit, "i"), node = valueOf(orbit, "om"), peri = valueOf(orbit, "w");
  if ([a, e, epoch, M, inclination, node, peri].some((v) => v == null)) return null;
  const mean = ((M! * Math.PI / 180 + 2 * Math.PI * (julianDate(date) - epoch!) / orbitPeriodDays(orbit, a!)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  let eccentric = mean;
  for (let n = 0; n < 10; n++) eccentric -= (eccentric - e! * Math.sin(eccentric) - mean) / (1 - e! * Math.cos(eccentric));
  return orbitalPosition(eccentric, a!, e!, inclination!, node!, peri!);
}
function orbitPathPoints(orbit: OrbitData | null, yaw: number, pitch: number, zoom: number) {
  const a = valueOf(orbit, "a"), e = valueOf(orbit, "e"), inclination = valueOf(orbit, "i"), node = valueOf(orbit, "om"), peri = valueOf(orbit, "w");
  if ([a, e, inclination, node, peri].some((v) => v == null)) return { points: [], marker: null, project: (p: { x: number; y: number; z: number }) => ({ x: 400 + p.x, y: 270 + p.y }) };
  const project = (p: { x: number; y: number; z: number }) => {
    const xr = p.x * Math.cos(yaw) - p.y * Math.sin(yaw);
    const yr = p.x * Math.sin(yaw) + p.y * Math.cos(yaw);
    const yp = yr * Math.cos(pitch) - p.z * Math.sin(pitch);
    const factor = 4.35 * zoom;
    return { x: 400 + xr * factor, y: 270 - yp * factor };
  };
  const points = Array.from({ length: 361 }, (_, index) => {
    const E = index / 360 * Math.PI * 2;
    return project(orbitalPosition(E, a!, e!, inclination!, node!, peri!));
  });
  const marker = currentKeplerPoint(orbit, new Date());
  return { points, marker: marker ? project(marker) : null, project };
}
function pointsPath(points: Array<{ x: number; y: number }>) { return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" "); }

function OrbitScene({ orbit }: { orbit: OrbitData }) {
  const [yaw, setYaw] = useState(-0.32);
  const [pitch, setPitch] = useState(0.48);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const scene = useMemo(() => orbitPathPoints(orbit, yaw, pitch, zoom), [orbit, yaw, pitch, zoom]);
  const neptune = Array.from({ length: 181 }, (_, i) => scene.project({ x: 30.07 * Math.cos(i * Math.PI / 90), y: 30.07 * Math.sin(i * Math.PI / 90), z: 0 }));
  const pluto = Array.from({ length: 181 }, (_, i) => scene.project({ x: 39.48 * Math.cos(i * Math.PI / 90), y: 39.48 * Math.sin(i * Math.PI / 90), z: 0 }));
  const point = currentKeplerPoint(orbit, new Date());
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => { drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    setYaw((value) => value + dx * 0.008);
    setPitch((value) => Math.max(-1.25, Math.min(1.25, value + dy * 0.008)));
  };
  const positionDate = dateLabel(new Date().toISOString());
  return <div className="tno-orbit-scene">
    <div className="tno-scene-topline"><span><i /> ORBITAL GEOMETRY · JPL OSCULATING ELEMENTS</span><span>DRAG TO ROTATE</span></div>
    <svg viewBox="0 0 800 540" role="img" aria-label="Interactive three-dimensional projection of ED138's calculated orbit with schematic Neptune and Pluto reference orbits" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <defs><radialGradient id="orbitSun"><stop stopColor="#fff5cf" /><stop offset=".2" stopColor="#f7d795" /><stop offset="1" stopColor="#b978ff" stopOpacity="0" /></radialGradient><linearGradient id="edOrbitLine"><stop stopColor="#5de5f6" stopOpacity=".15" /><stop offset=".48" stopColor="#7acaf8" stopOpacity=".95" /><stop offset="1" stopColor="#be9cff" stopOpacity=".36" /></linearGradient><filter id="orbitGlow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <g className="tno-scene-grid"><path d="M78 270H722M400 42V498" /><circle cx="400" cy="270" r="116" /><circle cx="400" cy="270" r="172" /><circle cx="400" cy="270" r="229" /></g>
      <path d={pointsPath(neptune)} className="tno-reference-orbit neptune" />
      <path d={pointsPath(pluto)} className="tno-reference-orbit pluto" />
      {scene.points.length > 0 && <path d={pointsPath(scene.points)} className="tno-object-orbit" />}
      <circle cx="400" cy="270" r="19" fill="url(#orbitSun)" filter="url(#orbitGlow)" /><circle cx="400" cy="270" r="3.8" fill="#ffe4a7" />
      {(() => { const p = scene.project({ x: 30.07, y: 0, z: 0 }); return <g><circle cx={p.x} cy={p.y} r="4" className="tno-neptune-dot" /><text x={p.x + 8} y={p.y - 8} className="tno-planet-label">NEPTUNE · 30 AU</text></g>; })()}
      {(() => { const p = scene.project({ x: 39.48, y: 0, z: 0 }); return <g><circle cx={p.x} cy={p.y} r="3.5" className="tno-pluto-dot" /><text x={p.x + 7} y={p.y + 14} className="tno-planet-label">PLUTO · 39 AU</text></g>; })()}
      {scene.marker && <g filter="url(#orbitGlow)"><circle cx={scene.marker.x} cy={scene.marker.y} r="8" className="tno-ed138-halo" /><circle cx={scene.marker.x} cy={scene.marker.y} r="3.5" className="tno-ed138-dot" /><text x={scene.marker.x + 12} y={scene.marker.y - 11} className="tno-ed138-label">ED138 · KEPLER PROPAGATION</text></g>}
      {!scene.marker && point && <circle cx={scene.project(point).x} cy={scene.project(point).y} r="4" className="tno-ed138-dot" />}
    </svg>
    <div className="tno-scene-controls"><span>VIEW ROTATION</span><input aria-label="Rotate orbit view" type="range" min="-180" max="180" value={Math.round(yaw * 57.3)} onChange={(event) => setYaw(Number(event.target.value) / 57.3)} /><span>ZOOM</span><input aria-label="Zoom orbit view" type="range" min="0.65" max="1.5" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><button className="tno-reset-view" onClick={() => { setYaw(-0.32); setPitch(0.48); setZoom(1); }}>Reset</button></div>
    <div className="tno-scene-legend"><span><i className="ed138" /> ED138 two-body marker · {positionDate}</span><span><i className="neptune" /> Neptune reference orbit</span><span><i className="pluto" /> Pluto reference orbit</span></div>
  </div>;
}

function LineChart({ observations, mode }: { observations: Observation[]; mode: "position" | "residual" | "magnitude" }) {
  const filtered = observations.filter((item) => mode === "residual" ? item.residual_arcsec != null : mode === "magnitude" ? item.magnitude != null : true);
  if (filtered.length < 2) return <div className="tno-chart-empty">{mode === "residual" ? "Ephemeris comparison is unavailable for this load." : "No published values in this series."}</div>;
  const width = 820, height = 210, pad = { x: 42, right: 14, top: 15, bottom: 27 };
  const xValues = filtered.map((item) => new Date(item.observed_at).getTime());
  const xMin = Math.min(...xValues), xMax = Math.max(...xValues) || xMin + 1;
  const origin = filtered[0];
  const metric = filtered.map((item) => mode === "residual" ? item.residual_arcsec! : mode === "magnitude" ? item.magnitude! : angularSeparationArcsec(origin.ra_deg, origin.dec_deg, item.ra_deg, item.dec_deg));
  const rangeMin = Math.min(...metric), rangeMax = Math.max(...metric), span = rangeMax - rangeMin || 1;
  const y = (value: number) => mode === "magnitude"
    ? pad.top + (value - rangeMin) / span * (height - pad.top - pad.bottom)
    : height - pad.bottom - (value - rangeMin) / span * (height - pad.top - pad.bottom);
  const x = (timestamp: number) => pad.x + (timestamp - xMin) / (xMax - xMin) * (width - pad.x - pad.right);
  const line = filtered.map((item, index) => `${index ? "L" : "M"}${x(xValues[index]).toFixed(1)} ${y(metric[index]).toFixed(1)}`).join(" ");
  const benchmark = mode === "residual" ? 0 : null;
  return <div className="tno-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={mode === "magnitude" ? "Published magnitude measurements by observation date; colors identify filters" : mode === "residual" ? "Angular residuals between published positions and JPL Horizons predictions" : "Published right ascension track over observation time"}>
    {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1={pad.x} x2={width - pad.right} y1={pad.top + fraction * (height - pad.top - pad.bottom)} y2={pad.top + fraction * (height - pad.top - pad.bottom)} className="tno-chart-grid" /><text x={pad.x - 8} y={pad.top + fraction * (height - pad.top - pad.bottom) + 3} textAnchor="end" className="tno-chart-tick">{mode === "residual" ? `${(rangeMax - fraction * span).toFixed(2)}″` : mode === "magnitude" ? `${(rangeMin + fraction * span).toFixed(1)}` : `${(rangeMax - fraction * span).toFixed(2)}″`}</text></g>)}
    {benchmark != null && <line x1={pad.x} x2={width - pad.right} y1={y(benchmark)} y2={y(benchmark)} className="tno-zero-line" />}
    <path d={line} className={`tno-chart-line ${mode}`} />
    {filtered.map((item, index) => <g key={`${item.observed_at}-${index}`}>{mode === "magnitude" && item.magnitude_sigma != null && <line x1={x(xValues[index])} x2={x(xValues[index])} y1={y(item.magnitude! - item.magnitude_sigma)} y2={y(item.magnitude! + item.magnitude_sigma)} stroke={FILTER_COLORS[item.filter || ""] || "#91d9ee"} strokeWidth=".8" opacity=".8" />}<circle cx={x(xValues[index])} cy={y(metric[index])} r={mode === "magnitude" ? 3 : 2.3} className={mode === "magnitude" ? "tno-mag-dot" : "tno-observation-dot"} style={mode === "magnitude" ? { fill: FILTER_COLORS[item.filter || ""] || "#91d9ee" } : undefined}><title>{dateTimeLabel(item.observed_at)} · {mode === "magnitude" ? `${item.magnitude?.toFixed(3)} ± ${item.magnitude_sigma?.toFixed(3) ?? "n/a"} mag · ${item.filter || "filter not reported"}` : mode === "residual" ? `JPL residual ${item.residual_arcsec?.toFixed(4)} arcsec` : `Angular displacement ${metric[index].toFixed(2)} arcsec`}</title></circle></g>)}
    <text x={pad.x} y={height - 5} className="tno-chart-date">{dateLabel(new Date(xMin).toISOString())}</text><text x={width - pad.right} y={height - 5} textAnchor="end" className="tno-chart-date">{dateLabel(new Date(xMax).toISOString())}</text>
  </svg></div>;
}

function OrbitPredictionChart({ positions }: { positions: EphemerisPoint[] }) {
  if (positions.length < 2) return <div className="tno-chart-empty">Load a Horizons ephemeris to plot predicted apparent positions.</div>;
  const width = 820, height = 180, pad = 22;
  const ras = positions.map((p) => p.ra_deg), decs = positions.map((p) => p.dec_deg);
  const minRa = Math.min(...ras), maxRa = Math.max(...ras) || minRa + 1e-6, minDec = Math.min(...decs), maxDec = Math.max(...decs) || minDec + 1e-6;
  const pts = positions.map((p) => ({ x: pad + (p.ra_deg - minRa) / (maxRa - minRa) * (width - 2 * pad), y: height - pad - (p.dec_deg - minDec) / (maxDec - minDec) * (height - 2 * pad) }));
  return <div className="tno-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="JPL Horizons predicted apparent sky path"><path d={pointsPath(pts)} className="tno-prediction-line" />{pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" className="tno-prediction-dot"><title>{dateTimeLabel(positions[i].observed_at)} · RA {positions[i].ra_deg.toFixed(5)}° · Dec {positions[i].dec_deg.toFixed(5)}° · range {fixed(positions[i].observer_distance_au, 2)} AU</title></circle>)}</svg></div>;
}

function TessSectorChart({ measurements }: { measurements: TessSectorMeasurement[] }) {
  if (!measurements.length) return <div className="tno-chart-empty">Published TESS sector photometry is unavailable on this load.</div>;
  const width = 820, height = 200, left = 46, right = 18, top = 16, bottom = 34;
  const values = measurements.map((item) => item.magnitude);
  const min = Math.min(...measurements.map((item) => item.magnitude - item.magnitude_sigma)) - 0.06;
  const max = Math.max(...measurements.map((item) => item.magnitude + item.magnitude_sigma)) + 0.06;
  const x = (index: number) => left + index / Math.max(1, measurements.length - 1) * (width - left - right);
  const y = (value: number) => top + (value - min) / (max - min || 1) * (height - top - bottom);
  return <div className="tno-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Published TESS sector magnitudes with one-sigma photometric uncertainties">
    {[0, .5, 1].map((fraction) => { const value = min + fraction * (max - min); return <g key={fraction}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="tno-chart-grid" /><text x={left - 8} y={y(value) + 3} textAnchor="end" className="tno-chart-tick">{value.toFixed(2)}</text></g>; })}
    {values.length > 1 && <path d={values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ")} className="tno-tess-line" />}
    {measurements.map((item, index) => <g key={item.sector}><line x1={x(index)} x2={x(index)} y1={y(item.magnitude - item.magnitude_sigma)} y2={y(item.magnitude + item.magnitude_sigma)} className="tno-tess-error" /><circle cx={x(index)} cy={y(item.magnitude)} r="4" className="tno-tess-point"><title>{item.epoch_label}: {item.magnitude.toFixed(2)} ± {item.magnitude_sigma.toFixed(2)} mag · S/N {item.detection_significance_sigma.toFixed(1)}σ</title></circle><text x={x(index)} y={height - 12} textAnchor="middle" className="tno-chart-date">Sector {item.sector}</text></g>)}
    <text x={left} y={11} className="tno-chart-date">TESS T magnitude · lower is brighter</text>
  </svg></div>;
}

function StatCard({ label, value, detail, tone = "cyan" }: { label: string; value: string; detail?: string; tone?: string }) {
  return <article className={`tno-stat-card ${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

export function TnoIntelligenceLab() {
  const [orbit, setOrbit] = useState<OrbitData | null>(null);
  const [data, setData] = useState<ObservationData | null>(null);
  const [ephemeris, setEphemeris] = useState<EphemerisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("orbit");
  const [advanced, setAdvanced] = useState(false);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [ephemerisDays, setEphemerisDays] = useState(30);
  const [loadingEphemeris, setLoadingEphemeris] = useState(false);
  const [spherexResults, setSpherexResults] = useState<SpherexResults | null>(null);
  const [spherexError, setSpherexError] = useState<string | null>(null);
  const [loadingSpherex, setLoadingSpherex] = useState(false);
  const [selectedObservation, setSelectedObservation] = useState<number>(-1);

  const load = useCallback(async (refresh = false) => {
    setError(null);
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const suffix = refresh ? "?refresh=true" : "";
      const [orbitResponse, observationResponse] = await Promise.all([
        getJson<{ object: OrbitData }>(`/api/tno/ed138${suffix}`),
        getJson<ObservationData>(`/api/tno/ed138/observations${refresh ? "?refresh=true" : ""}`),
      ]);
      setOrbit(orbitResponse.object);
      setData(observationResponse);
      setSelectedObservation(observationResponse.observations.length - 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The research services could not be reached.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const observations = data?.observations ?? [];
  const selected = observations[selectedObservation] ?? observations[observations.length - 1] ?? null;
  const rateMedian = useMemo(() => {
    const rates = (data?.motion_samples ?? []).map((item) => item.angular_rate_arcsec_min).sort((a, b) => a - b);
    if (!rates.length) return null;
    const mid = Math.floor(rates.length / 2);
    return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  }, [data]);
  const nearestBenchmark = useMemo(() => {
    if (!data?.motion_samples.length) return null;
    return data.motion_samples.reduce((best, item) => Math.abs(item.angular_rate_arcsec_min - data.benchmark_rate_arcsec_min) < Math.abs(best.angular_rate_arcsec_min - data.benchmark_rate_arcsec_min) ? item : best);
  }, [data]);

  const computeEphemeris = async () => {
    setLoadingEphemeris(true);
    setError(null);
    try {
      const query = new URLSearchParams({ start_date: startDate, days: String(ephemerisDays), step_days: "1" });
      setEphemeris(await getJson<EphemerisData>(`/api/tno/ed138/ephemeris?${query}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Horizons could not compute those positions.");
    } finally { setLoadingEphemeris(false); }
  };

  const checkSpherex = async () => {
    if (!selected) return;
    setLoadingSpherex(true); setSpherexResults(null); setSpherexError(null);
    const day = selected.observed_at.slice(0, 10);
    const query = new URLSearchParams({ ra: String(selected.ra_deg), dec: String(selected.dec_deg), radius: "0.05", release: "dr1", start_date: day, end_date: day, limit: "25" });
    try {
      setSpherexResults(await getJson<SpherexResults>(`/api/observations?${query}`));
    } catch (cause) {
      setSpherexError(cause instanceof Error ? cause.message : "IRSA did not complete the coverage check.");
    } finally { setLoadingSpherex(false); }
  };

  const tabs = [
    ["orbit", "Orbital intelligence", Orbit], ["motion", "Motion & validation", Activity],
    ["photometry", "Photometry", Waves], ["infrared", "SPHEREx / infrared", Telescope], ["companions", "Companion search", Satellite],
  ] as const;

  if (loading && !orbit && !data) return <div className="tno-lab page-shell"><div className="tno-loading"><span className="tno-scanner" /><span className="section-kicker">CONNECTING TO JPL &amp; THE PUBLISHED ASTROMETRY</span><h1>Opening the TNO Intelligence Lab</h1><p>Fetching the current orbit solution and the published ED138 observation series.</p></div></div>;

  return <div className="tno-lab page-shell">
    <section className="tno-hero">
      <div className="tno-hero-copy"><div className="eyebrow"><span className="eyebrow-star">✳</span> ASCENTRA RESEARCH MODULE · TNO INTELLIGENCE LAB</div>
        <div className="tno-title-line"><div className="tno-title-orbit"><Orbit size={23} /></div><div><h1>Far beyond <span className="gradient-text">the familiar.</span></h1><p>Trace the measured path and JPL-predicted motion of trans-Neptunian object <strong>2026 ED138</strong>.</p></div></div>
        <div className="tno-hero-tags"><span><i className="live" /> LIVE JPL SBDB / HORIZONS</span><span><Database size={12} /> PUBLISHED RUBIN + DECAM ASTROMETRY</span><span><ShieldCheck size={12} /> MEASUREMENTS KEEP THEIR SOURCE</span></div>
      </div>
      <div className="tno-hero-actions"><button type="button" className="tno-mode-toggle" aria-pressed={advanced} onClick={() => setAdvanced((v) => !v)}><Sparkles size={13} /> {advanced ? "Advanced mode" : "Guided mode"}</button><button type="button" className="tno-refresh" onClick={() => void load(true)} disabled={refreshing}>{refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Refresh sources</button></div>
    </section>

    {error && <div className="tno-alert" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" onClick={() => void load(true)}>Retry</button></div>}

    <section className="tno-object-banner glass-panel">
      <div className="tno-object-name"><div className="tno-object-glyph">ED</div><div><span className="section-kicker">BENCHMARK OBJECT · PROVISIONAL DESIGNATION</span><h2>2026 ED138</h2><span className="tno-class-pill">Trans-Neptunian object <i /> dwarf-planet candidate</span></div></div>
      <div className="tno-object-stats">
        <div><span>SEMIMAJOR AXIS</span><strong>{fixed(valueOf(orbit, "a"), 2)} <small>AU</small></strong><em>JPL osculating orbit</em></div>
        <div><span>ECCENTRICITY</span><strong>{fixed(valueOf(orbit, "e"), 3)}</strong><em>moderately eccentric</em></div>
        <div><span>INCLINATION</span><strong>{fixed(valueOf(orbit, "i"), 2)}<small>°</small></strong><em>ecliptic reference plane</em></div>
        <div><span>ORBITAL PERIOD</span><strong>{orbitPeriodYears(orbit)?.toFixed(1) ?? "—"}<small>yr</small></strong><em>{valueOf(orbit, "per") == null ? "Kepler estimate from JPL a" : "JPL osculating period"}</em></div>
      </div>
      <div className="tno-object-foot"><span>JPL solution {orbit?.orbit_solution_id ?? "—"} · {orbit?.observations_used ?? "—"} measurements used · RMS {fixed(orbit?.orbit_fit_rms_arcsec, 3)}″</span><a href="https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=2026%20ED138&phys-par=true&cov=mat&full-prec=true" target="_blank" rel="noreferrer">Open live SBDB record <ExternalLink size={11} /></a></div>
    </section>

    <section className="tno-summary-grid">
      <StatCard label="PUBLISHED ASTROMETRY" value={data ? String(data.count) : "—"} detail={data ? `${dateLabel(observations[0]?.observed_at)} – ${dateLabel(observations[observations.length - 1]?.observed_at)}` : "Published series unavailable"} />
      <StatCard label="HORIZONS VALIDATION" value={data?.validation.status === "complete" ? `${data.validation.matched}/${observations.length}` : "PENDING"} detail={data?.validation.status === "complete" ? "Positions matched at observatory sites" : "Orbit data remain available"} tone="violet" />
      <StatCard label="APPARENT MOTION · MEDIAN" value={rateMedian == null ? "—" : `${rateMedian.toFixed(3)}″/min`} detail="Calculated from adjacent same-night measurements" tone="gold" />
      <StatCard label="SPHEREx SPECTRUM" value="Not yet measured" detail="No ED138 infrared fluxes are claimed here" tone="blue" />
    </section>

    <section className="tno-workbench glass-panel">
      <div className="tno-tabbar" role="tablist" aria-label="TNO research views">{tabs.map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}><Icon size={14} /><span>{label}</span></button>)}</div>

      {activeTab === "orbit" && <div className="tno-tab-content">
        <div className="tno-section-heading"><div><span className="section-kicker">LIVE ORBIT MODEL</span><h2>Follow the long ellipse</h2><p>JPL’s osculating elements set the geometry. Drag to change the viewing angle.</p></div><span className="tno-classification"><Orbit size={12} /> CALCULATED TWO-BODY DISPLAY PATH</span></div>
        {orbit ? <div className="tno-orbit-layout"><OrbitScene orbit={orbit} /><aside className="tno-orbit-aside"><div className="tno-aside-card"><span className="section-kicker">ORBIT SHAPE</span><div className="tno-orbit-metric"><span>Perihelion distance</span><strong>{fixed(valueOf(orbit, "q"), 2)} AU</strong></div><div className="tno-orbit-metric"><span>Aphelion distance</span><strong>{fixed(valueOf(orbit, "ad"), 2)} AU</strong></div><div className="tno-orbit-metric"><span>Inclination</span><strong>{fixed(valueOf(orbit, "i"), 2)}°</strong></div><div className="tno-orbit-metric"><span>Orbital period</span><strong>{orbitPeriodYears(orbit)?.toFixed(1) ?? "Not reported"} years</strong></div></div>
          <div className="tno-aside-card tno-epoch-box"><span className="section-kicker">ORBIT SOLUTION EPOCH</span><strong>{orbit.orbit_epoch ?? "Not reported"}</strong><p>Solution updated {dateLabel(orbit.orbit_solution_date)}. Formal element uncertainties are available from JPL.</p>{advanced && <div className="tno-covariance-label">JPL fit condition code: {orbit.condition_code ?? "not reported"} · {orbit.orbit_fit_rms_arcsec?.toFixed(4) ?? "—"}″ RMS</div>}</div>
          <div className="tno-source-stamp"><Database size={12} /><span>Source: JPL Small-Body Database API<br />Retrieved {dateTimeLabel(orbit.provenance.retrieved_at)}</span></div>
        </aside></div> : <div className="tno-chart-empty">JPL orbital elements could not be loaded.</div>}
        <div className="tno-model-note"><Info size={14} /><p><strong>How to read this view.</strong> ED138’s path is calculated from one epoch of JPL osculating elements using Kepler’s two-body equations. Neptune and Pluto circles show schematic semimajor-axis references, not their current positions. Use JPL Horizons below for observer-specific predicted sky coordinates.</p></div>
        <div className="tno-ephemeris-controls"><div><span className="section-kicker">APPARENT POSITION PREDICTION</span><strong>JPL Horizons · geocentric observer</strong></div><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Window<select value={ephemerisDays} onChange={(event) => setEphemerisDays(Number(event.target.value))}><option value={14}>14 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option></select></label><button type="button" className="tno-action-button" onClick={() => void computeEphemeris()} disabled={loadingEphemeris}>{loadingEphemeris ? <LoaderCircle size={14} className="spin" /> : <ArrowDownRight size={14} />} Compute positions</button></div>
        {ephemeris && <div className="tno-ephemeris-output"><div className="tno-ephemeris-meta"><span><i className="live" /> {ephemeris.count} predicted positions</span><span>{ephemeris.start_date} – {ephemeris.end_date} · daily</span><span>Observer range {fixed(ephemeris.positions[0]?.observer_distance_au, 2)} AU</span><a href={ephemeris.source} target="_blank" rel="noreferrer">JPL Horizons <ExternalLink size={11} /></a></div><OrbitPredictionChart positions={ephemeris.positions} /><div className="tno-position-table"><div className="tno-table-head"><span>UTC</span><span>RA · ICRF</span><span>Dec · ICRF</span><span>Sky rate</span><span>r / Δ · AU</span><span>Class</span></div>{ephemeris.positions.slice(0, 8).map((item) => <div className="tno-table-row" key={item.observed_at}><span>{dateTimeLabel(item.observed_at)}</span><span>{item.ra_deg.toFixed(6)}°</span><span>{item.dec_deg.toFixed(6)}°</span><span>{item.angular_rate_arcsec_hour?.toFixed(3) ?? "—"}″/h</span><span>{fixed(item.heliocentric_distance_au, 2)} / {fixed(item.observer_distance_au, 2)}</span><span className="tno-type-pill">prediction</span></div>)}</div></div>}
      </div>}

      {activeTab === "motion" && <div className="tno-tab-content">
        <div className="tno-section-heading"><div><span className="section-kicker">ASTROMETRY &amp; ORBIT CHECK</span><h2>Measure the apparent drift</h2><p>Published positions are checked against JPL Horizons at the recording observatory and UTC midpoint.</p></div><span className={`tno-validation-pill ${data?.validation.status === "complete" ? "ok" : "wait"}`}>{data?.validation.status === "complete" ? <Check size={12} /> : <CircleHelp size={12} />} {data?.validation.status === "complete" ? `${data.validation.matched} positions checked` : "Validation unavailable"}</span></div>
        <div className="tno-motion-cards"><div className="tno-motion-card"><span>REFERENCE BENCHMARK</span><strong>{data?.benchmark_rate_arcsec_min.toFixed(3) ?? "0.043"}″<small>/ min</small></strong><p>Provided benchmark value. Not treated as a constant property of ED138.</p></div><div className="tno-motion-card highlight"><span>MEASURED MEDIAN · SHORT-BASELINE PAIRS</span><strong>{rateMedian?.toFixed(3) ?? "—"}″<small>/ min</small></strong><p>{data?.motion_samples.length ?? 0} adjacent pairs with 0.5–60 minute spacing; rates vary with epoch and measurement noise.</p></div><div className="tno-motion-card"><span>CLOSEST PAIR TO BENCHMARK</span><strong>{nearestBenchmark?.angular_rate_arcsec_min.toFixed(3) ?? "—"}″<small>/ min</small></strong><p>{nearestBenchmark ? `${dateTimeLabel(nearestBenchmark.from)} → ${dateTimeLabel(nearestBenchmark.to)}` : "No suitable published pair"}</p></div></div>
        <div className="tno-chart-panel"><div className="tno-chart-heading"><div><strong>Angular displacement from the first published position</strong><span>Great-circle separation over time · direct catalogue measurements</span></div><span className="tno-chart-legend"><i className="measured" /> measured</span></div><LineChart observations={observations} mode="position" /></div>
        <div className="tno-chart-panel"><div className="tno-chart-heading"><div><strong>Observed minus Horizons</strong><span>Great-circle residual at each UTC observation midpoint</span></div>{data?.validation.status === "complete" && <span className="tno-chart-legend">median {fixed(median(observations.map((v) => v.residual_arcsec).filter((v): v is number => v != null)), 3)}″ · max {fixed(Math.max(...observations.map((v) => v.residual_arcsec ?? 0)), 3)}″</span>}</div><LineChart observations={observations} mode="residual" />{data?.validation.message && <p className="tno-chart-footnote">{data.validation.message}</p>}</div>
        <div className="tno-model-note"><Info size={14} /><p>The listed coordinate errors are the paper’s per-axis measurement uncertainties. Residuals are not a new orbit fit and do not include a propagated JPL covariance ellipse. Same-night successive detections are used only to estimate apparent angular rate, with spherical great-circle separation.</p></div>
      </div>}

      {activeTab === "photometry" && <div className="tno-tab-content">
        <div className="tno-section-heading"><div><span className="section-kicker">PUBLISHED OPTICAL MEASUREMENTS</span><h2>Brightness, with its filters attached</h2><p>Browse the paper’s measured apparent magnitudes. Filter changes are shown explicitly.</p></div><span className="tno-classification"><Waves size={12} /> FILTER-DEPENDENT PHOTOMETRY</span></div>
        <div className="tno-photometry-summary"><div><span>JPL absolute magnitude H</span><strong>{fixed(orbit?.absolute_magnitude_H.value, 3)} <small>± {fixed(orbit?.absolute_magnitude_H.uncertainty_1sigma, 3)} mag</small></strong><em>JPL catalogue value</em></div><div><span>Published Rubin H<sub>V</sub></span><strong>3.19 <small>± 0.04 mag</small></strong><em>Paper’s color-transformed estimate</em></div><div><span>Published diameter estimate</span><strong>612–1530 <small>km</small></strong><em>Assumed geometric albedo 0.25–0.04</em></div></div>
        <div className="tno-chart-panel"><div className="tno-chart-heading"><div><strong>Measured apparent magnitude vs. time</strong><span>Lower magnitude means brighter · color identifies the reported filter</span></div><div className="tno-filter-legend">{Object.entries(FILTER_COLORS).map(([filter, color]) => <span key={filter}><i style={{ background: color }} />{filter}</span>)}</div></div><LineChart observations={observations} mode="magnitude" /></div>
        <div className="tno-chart-panel"><div className="tno-chart-heading"><div><strong>TESS archival sector measurements</strong><span>Published sector T magnitudes · sector IDs shown because precise weighted mid-times are not provided here</span></div><span className="tno-chart-legend">{data?.tess_sector_photometry.length ?? 0} sectors · 1σ error bars</span></div><TessSectorChart measurements={data?.tess_sector_photometry ?? []} /><p className="tno-chart-footnote">Source: <a href={data?.tess_source || "https://arxiv.org/abs/2610.40106"} target="_blank" rel="noreferrer">published TESS precovery analysis <ExternalLink size={10} /></a>{data?.tess_retrieved_at ? ` · retrieved ${dateTimeLabel(data.tess_retrieved_at)}` : " · source unavailable on this load"}. TESS detections use sector-level shift-and-stack photometry; they are not individual-image timestamps.</p></div>
        <div className="tno-model-note"><Info size={14} /><p>Rubin/DECam points use different optical filter systems; TESS sector photometry is plotted separately in its broad T band. Neither plot is a calibrated rotational light curve. The published analysis finds the measurements consistent with near-constant brightness after expected distance/phase effects, and reports no measured rotation period. The 612–1530 km diameter range is an albedo-dependent estimate, not a direct size measurement.</p></div>
        <div className="tno-spectral-empty"><Waves size={22} /><div><span className="section-kicker">INFRARED SPECTRUM</span><strong>No SPHEREx flux spectrum is published for ED138</strong><p>No wavelength-by-wavelength flux points or uncertainties are available in this module. SPHEREx image coverage alone would not establish a spectrum or composition.</p></div><button type="button" className="tno-link-button" onClick={() => setActiveTab("infrared")}>Check SPHEREx coverage <ChevronRight size={13} /></button></div>
      </div>}

      {activeTab === "infrared" && <div className="tno-tab-content">
        <div className="tno-section-heading"><div><span className="section-kicker">NASA/IPAC IRSA · SPHEREx</span><h2>Search a measured sky position</h2><p>Check public DR1 image products at an actual ED138 observing epoch.</p></div><span className="tno-classification"><Database size={12} /> SIA2 ARCHIVE QUERY</span></div>
        <div className="tno-irsa-controls"><label>Published observation<select value={selectedObservation} onChange={(event) => setSelectedObservation(Number(event.target.value))}>{observations.map((item, index) => <option key={`${item.observed_at}-${index}`} value={index}>{dateTimeLabel(item.observed_at)} · {item.measurement_source} · {item.filter || "filter n/a"}</option>)}</select></label><div className="tno-coordinate-readout"><span>MEASURED POSITION</span><strong>{selected ? `${selected.ra_deg.toFixed(6)}°, ${selected.dec_deg.toFixed(6)}°` : "Load the published astrometry first"}</strong></div><button type="button" className="tno-action-button" onClick={() => void checkSpherex()} disabled={!selected || loadingSpherex}>{loadingSpherex ? <LoaderCircle size={14} className="spin" /> : <SearchIcon />} Check IRSA coverage</button>{selected && <Link className="cosmic-research-link" href={`/cosmic-explorer?ra=${encodeURIComponent(String(selected.ra_deg))}&dec=${encodeURIComponent(String(selected.dec_deg))}&target=2026%20ED138` }><Globe2 size={13} /> View this measured position in Cosmic Explorer <ArrowRight size={12} /></Link>}</div>
        <div className="tno-model-note"><Info size={14} /><p>The query checks the selected coordinate and date against SPHEREx image metadata. This is a fixed-position archive coverage search, not IRSA MOST’s moving-target track search or a forced-photometry extraction.</p></div>
        {loadingSpherex && <div className="tno-inline-loading"><LoaderCircle size={16} className="spin" /> Querying NASA/IPAC IRSA for the selected date…</div>}
        {spherexError && <div className="tno-alert compact" role="alert"><AlertTriangle size={15} /><span>{spherexError}</span></div>}
        {spherexResults && <div className="tno-coverage-result"><div className="tno-coverage-title"><div><span className="section-kicker">IRSA SIA2 RESULT</span><strong>{spherexResults.count ? `${spherexResults.count} matching image products` : "No matching SPHEREx images returned"}</strong></div><span className="tno-type-pill">NASA/IPAC IRSA · DR1</span></div>{spherexResults.message && <p className="tno-coverage-message">{spherexResults.message}</p>}{spherexResults.observations.map((product) => <article className="tno-spherex-product" key={product.id}><div className="tno-product-thumb"><Image src={`${API_BASE}${product.preview_url}?ra=${selected?.ra_deg}&dec=${selected?.dec_deg}`} alt={`SPHEREx display preview for ${product.product_id}`} width={145} height={100} unoptimized onError={(event) => { event.currentTarget.style.display = "none"; }} /><span>DISPLAY PREVIEW</span></div><div><span className="section-kicker">{product.release} · {product.instrument || "SPHEREx product"}</span><strong>{product.product_id}</strong><p>{dateTimeLabel(product.observation_start)} · {product.wavelength_min_um != null && product.wavelength_max_um != null ? `${product.wavelength_min_um.toFixed(3)}–${product.wavelength_max_um.toFixed(3)} μm` : "Wavelength metadata not reported"}</p><a href={product.original_url} target="_blank" rel="noreferrer">Open original FITS product <ExternalLink size={11} /></a></div></article>)}</div>}
        {!spherexResults && !loadingSpherex && !spherexError && <div className="tno-spectral-empty"><Telescope size={23} /><div><span className="section-kicker">SPECTRAL COVERAGE IS NOT ASSUMED</span><strong>Select an observation and query IRSA</strong><p>Products, if found, will be returned with archive dates and wavelength bounds. No flux points will be inferred from a cutout.</p></div></div>}
        <div className="tno-resolution-card"><div className="tno-resolution-icon"><Eye size={17} /></div><div><span className="section-kicker">SPHEREx ANGULAR SCALE</span><strong>≈ 6.1 arcsec pixels</strong><p>At ED138’s ~47 AU geocentric range, one SPHEREx pixel spans roughly {selected ? `${(6.129 / 206265 * (ephemeris?.positions[0]?.observer_distance_au ?? 47.9) * 149_597_870.7 / 1000).toFixed(0)} km` : "~200,000 km"} in the sky plane. Pixel scale is not the same as resolution; PSF blending makes close-companion separation harder.</p></div><a href="https://irsa.ipac.caltech.edu/applications/MOST/" target="_blank" rel="noreferrer">Open IRSA MOST <ExternalLink size={11} /></a></div>
      </div>}

      {activeTab === "companions" && <div className="tno-tab-content">
        <div className="tno-section-heading"><div><span className="section-kicker">POSSIBLE COMPANION SEARCH</span><h2>What the available data can resolve</h2><p>A nearby pixel source is not enough to establish a satellite.</p></div><span className="tno-candidate-status"><span /> NOT ASSESSED · NO CANDIDATE CLAIMED</span></div>
        <div className="tno-companion-layout"><div className="tno-companion-map"><div className="tno-companion-stars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="tno-companion-target"><span /><b>ED138</b></div><div className="tno-companion-beam" /><div className="tno-companion-scale">6.1″ SPHEREx pixel scale · illustration, not an observation</div></div><div className="tno-companion-copy"><span className="section-kicker">CURRENT EVIDENCE LIMIT</span><h3>Public metadata cannot support a moon search</h3><p>The published table provides ED138 positions and photometry, not the calibrated source images needed to detect and register nearby points across epochs. Rubin’s released original images and catalogs are limited to Rubin data-rights holders.</p><p>SPHEREx pixels are about 6.1 arcsec. At this distance, one pixel corresponds to around 200,000 km before accounting for the broader point-spread function. That is too coarse to test for close bound companions.</p><div className="tno-companion-state"><ShieldCheck size={15} /><div><strong>Classification: Not assessed</strong><span>No background source, possible companion, or satellite is asserted by ASCENTRA.</span></div></div><a href="https://prompt-products.lsst.io/products/2026-ED138/index.html" target="_blank" rel="noreferrer" className="tno-link-button">Rubin data access information <ExternalLink size={11} /></a></div></div>
        <div className="tno-companion-checklist"><div><span>01</span><strong>Calibrated multi-epoch images</strong><small>Required · not publicly downloadable here</small></div><div><span>02</span><strong>Background-star registration</strong><small>Not run on literature positions</small></div><div><span>03</span><strong>Repeated relative astrometry</strong><small>Required before a candidate label</small></div><div><span>04</span><strong>Independent confirmation</strong><small>Required before any satellite claim</small></div></div>
        <div className="tno-model-note"><Info size={14} /><p>The orbit and measured motion are not enough to locate a satellite. A defensible companion search needs accessible calibrated pixels, a PSF model, crowding assessment, repeated detections and relative astrometry with uncertainty.</p></div>
      </div>}
    </section>

    <section className="tno-measurement-browser glass-panel"><div className="tno-browser-header"><div><span className="section-kicker">ASTROMETRY LEDGER</span><h2>Published observations</h2><p>{data?.notice ?? "Measurements are retrieved from the peer-reviewed research preprint."}</p></div><div className="tno-validation-badge"><span className={data?.validation.status === "complete" ? "ok" : "wait"} />{data?.validation.status === "complete" ? "Horizons matched" : "Predictions not matched"}</div></div>
      {data && <div className="tno-table-scroll"><table className="tno-ledger"><thead><tr><th>OBSERVATION · UTC</th><th>RA · ICRF</th><th>DEC · ICRF</th><th>σ POS · arcsec</th><th>MAG · FILTER</th><th>ORIGIN</th><th>JPL RESIDUAL</th><th>SOURCE</th></tr></thead><tbody>{observations.slice(0, advanced ? observations.length : 12).map((item, index) => <tr key={`${item.observed_at}-${index}`}><td>{dateTimeLabel(item.observed_at)}</td><td>{item.ra_deg.toFixed(7)}°</td><td>{item.dec_deg.toFixed(7)}°</td><td>{item.sigma_ra_arcsec == null || item.sigma_dec_arcsec == null ? "Not reported" : `${item.sigma_ra_arcsec.toFixed(3)} / ${item.sigma_dec_arcsec.toFixed(3)}`}</td><td>{item.magnitude == null ? "—" : `${item.magnitude.toFixed(3)} ${item.filter || ""}`}</td><td><span className={`tno-origin origin-${item.origin_code?.toLowerCase()}`}>{item.measurement_source || "Unknown"}</span></td><td>{item.residual_arcsec == null ? "—" : `${item.residual_arcsec.toFixed(4)}″`}</td><td><a href={item.provenance.source} target="_blank" rel="noreferrer" aria-label="Open measurement source"><ExternalLink size={12} /></a></td></tr>)}</tbody></table></div>}
      {data && !advanced && observations.length > 12 && <button className="tno-show-more" type="button" onClick={() => setAdvanced(true)}>Show all {observations.length} measurements <ChevronRight size={12} /></button>}
      {advanced && orbit?.covariance && <details className="tno-covariance"><summary>Inspect JPL orbital element uncertainty &amp; covariance</summary><div className="tno-covariance-grid">{orbit.covariance.elements?.map((item) => <div key={item.name}><span>{item.name}</span><strong>{item.value} ± {item.sigma} {item.units || ""}</strong></div>)}</div><p>JPL covariance epoch: {orbit.covariance.epoch ?? "not reported"}. Covariance is shown as returned; no confidence region is invented in the visualization.</p></details>}
    </section>

    <section className="tno-provenance-grid"><article className="tno-provenance-card"><span className="section-kicker">THE RECORD</span><h3>Verified, measured, predicted</h3><p>Solid data badges mark published catalogue measurements. Teal labels mark JPL ephemeris predictions. The orbit drawing is a two-body visualization; candidate companion status remains unassessed.</p><div className="tno-key-list"><span><i className="direct" /> Direct published measurement</span><span><i className="prediction" /> JPL prediction</span><span><i className="calculated" /> Calculated visualization</span><span><i className="unavailable" /> No observation available</span></div></article><article className="tno-provenance-card"><span className="section-kicker">RESEARCH SOURCES</span><div className="tno-source-links">{RESEARCH_LINKS.map(([label, href]) => <a href={href} key={label} target="_blank" rel="noreferrer">{label}<ExternalLink size={11} /></a>)}</div></article></section>

    <div className="tno-bottom-notice"><AlertTriangle size={14} /><p><strong>Research boundary.</strong> ED138 is a dwarf-planet candidate, not a confirmed dwarf planet. The original Rubin image release is data-rights restricted; this module analyzes published astrometry and public JPL ephemerides. SPHEREx/IRSA image coverage checks are available, but no infrared spectrum, diameter measurement, moving-object detection pipeline, or satellite discovery is claimed.</p></div>
    <div className="tno-lab-footer"><span>ASCENTRA · TNO INTELLIGENCE LAB</span><Link href="/sources">Data sources &amp; methodology <ChevronRight size={12} /></Link></div>
  </div>;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function SearchIcon() { return <Activity size={14} />; }
