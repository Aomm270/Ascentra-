export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type Observation = {
  id: string;
  product_id: string;
  collection: string;
  release: string;
  deep_field: boolean;
  ra: number | null;
  dec: number | null;
  start_mjd: number | null;
  end_mjd: number | null;
  observation_start: string | null;
  observation_end: string | null;
  wavelength_min_um: number | null;
  wavelength_max_um: number | null;
  exposure_seconds: number | null;
  calibration_level: number | null;
  resolution_arcsec: number | null;
  field_of_view_deg: number | null;
  data_type: string | null;
  data_format: string | null;
  target: string | null;
  facility: string | null;
  instrument: string | null;
  title: string | null;
  preview_url: string;
  original_url: string;
};

export type ObservationResponse = {
  count: number;
  observations: Observation[];
  source: string;
  query_status: string | null;
  truncated: boolean;
  cached: boolean;
  message: string | null;
};

export type PreviewStretch = "linear" | "log" | "sqrt" | "asinh";

export function previewUrl(observation: Observation, ra?: number, dec?: number, options: { stretch?: PreviewStretch; contrast?: number; plane?: number; lowPercentile?: number; highPercentile?: number } = {}) {
  const params = new URLSearchParams();
  if (ra !== undefined && dec !== undefined) {
    params.set("ra", String(ra));
    params.set("dec", String(dec));
  }
  if (options.stretch) params.set("stretch", options.stretch);
  if (options.contrast != null) params.set("contrast", String(options.contrast));
  if (options.plane != null) params.set("plane", String(options.plane));
  if (options.lowPercentile != null) params.set("low_percentile", String(options.lowPercentile));
  if (options.highPercentile != null) params.set("high_percentile", String(options.highPercentile));
  return `${API_BASE}${observation.preview_url}${params.size ? `?${params}` : ""}`;
}

export function dateLabel(date: string | null) {
  if (!date) return "Not reported";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

export function dateTimeLabel(date: string | null) {
  if (!date) return "Not reported";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : `${parsed.toISOString().replace("T", " ").replace("Z", "")} UTC`;
}

export function wavelengthLabel(min: number | null, max: number | null) {
  if (min == null || max == null) return "Wavelength not reported";
  return `${min.toFixed(3)}–${max.toFixed(3)} μm`;
}

export function comparablePair(items: Observation[]) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const sameRange = a.wavelength_min_um != null && a.wavelength_max_um != null && b.wavelength_min_um != null && b.wavelength_max_um != null && Math.abs(a.wavelength_min_um - b.wavelength_min_um) < 0.001 && Math.abs(a.wavelength_max_um - b.wavelength_max_um) < 0.001;
      const differentTimes = a.start_mjd != null && b.start_mjd != null && Math.abs(a.start_mjd - b.start_mjd) > 0.0001;
      if (a.collection === b.collection && a.calibration_level != null && a.calibration_level === b.calibration_level && sameRange && differentTimes) {
        return a.start_mjd! < b.start_mjd! ? [a, b] as const : [b, a] as const;
      }
    }
  }
  return null;
}
