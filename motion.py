"""Quality-aware, provenance-preserving SPHEREx motion measurements."""

from __future__ import annotations

import asyncio
import hashlib
import io
import math
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit

import httpx
import numpy as np
from astropy.io import fits
from astropy import units as u
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_scales
from fastapi import APIRouter, HTTPException
from photutils.aperture import CircularAperture
from photutils.detection import DAOStarFinder
from pydantic import BaseModel, Field
from scipy.optimize import linear_sum_assignment
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/api/motion", tags=["Motion Analytics"])

IRSA_HOST = "irsa.ipac.caltech.edu"
IRSA_PATH_PREFIX = "/ibe/data/spherex/"
MAX_FITS_BYTES = 35_000_000
MAX_IMAGE_PIXELS = 8_000_000
FIT_CACHE_MAX_BYTES = 128 * 1024 * 1024
FIT_CACHE_MAX_ENTRIES = 48
MAX_PARALLEL_CUTOUTS = 2
_fits_cache: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
_fits_cache_bytes = 0


class MotionEpoch(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    product_id: str = Field(min_length=1, max_length=200)
    original_url: str = Field(min_length=1, max_length=2048)
    collection: str = Field(min_length=1, max_length=100)
    release: str = Field(min_length=1, max_length=80)
    observation_start: str = Field(min_length=10, max_length=40)
    calibration_level: int | None = Field(None, ge=0, le=10)
    wavelength_min_um: float | None = Field(None, gt=0, le=5.2)
    wavelength_max_um: float | None = Field(None, gt=0, le=5.2)
    resolution_arcsec: float | None = Field(None, gt=0, le=300)


class MotionAnalysisRequest(BaseModel):
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    cutout_size_deg: float = Field(0.12, gt=0.005, le=1)
    match_radius_arcsec: float = Field(30, ge=1, le=600)
    threshold_sigma: float = Field(5, ge=3, le=12)
    distance_pc: float | None = Field(None, gt=0, le=1e9)
    epochs: list[MotionEpoch] = Field(min_length=2, max_length=6)


def _validate_irsa_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise HTTPException(400, "The selected product URL is invalid.") from exc
    if (
        parts.scheme != "https"
        or parts.hostname != IRSA_HOST
        or port not in (None, 443)
        or parts.username is not None
        or parts.password is not None
        or not parts.path.startswith(IRSA_PATH_PREFIX)
    ):
        raise HTTPException(400, "Motion analysis accepts only SPHEREx FITS products hosted by NASA/IPAC IRSA.")
    return url


def _cutout_url(epoch: MotionEpoch, request: MotionAnalysisRequest) -> str:
    original = _validate_irsa_url(epoch.original_url)
    parts = urlsplit(original)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["center"] = [f"{request.ra:.8f},{request.dec:.8f}"]
    query["size"] = [f"{request.cutout_size_deg:.5f}"]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), ""))


def _cache_get(key: str) -> bytes | None:
    item = _fits_cache.get(key)
    if item is None:
        return None
    expires, data = item
    if expires <= time.monotonic():
        _cache_delete(key)
        return None
    _fits_cache.move_to_end(key)
    return data


def _cache_delete(key: str) -> None:
    global _fits_cache_bytes
    item = _fits_cache.pop(key, None)
    if item:
        _fits_cache_bytes -= len(item[1])


def _cache_put(key: str, data: bytes) -> None:
    global _fits_cache_bytes
    if len(data) > FIT_CACHE_MAX_BYTES:
        return
    _cache_delete(key)
    while _fits_cache and (len(_fits_cache) >= FIT_CACHE_MAX_ENTRIES or _fits_cache_bytes + len(data) > FIT_CACHE_MAX_BYTES):
        oldest = next(iter(_fits_cache))
        _cache_delete(oldest)
    _fits_cache[key] = (time.monotonic() + 3600, data)
    _fits_cache_bytes += len(data)


async def _download_cutout(client: httpx.AsyncClient, url: str) -> bytes:
    current_url = url
    for _ in range(4):
        _validate_irsa_url(current_url)
        async with client.stream("GET", current_url, headers={"User-Agent": "ASCENTRA/1.0 (public astronomical research interface)"}) as response:
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise HTTPException(502, "IRSA returned a redirect without a destination.")
                current_url = _validate_irsa_url(urljoin(str(response.request.url), location))
                continue
            if response.status_code in {429, 502, 503, 504}:
                raise httpx.HTTPStatusError("Temporary IRSA cutout response", request=response.request, response=response)
            if response.status_code in {400, 422}:
                raise HTTPException(422, "IRSA could not make a cutout around this sky position for one selected observation.")
            response.raise_for_status()
            final_url = str(response.url)
            _validate_irsa_url(final_url.split("?", 1)[0])
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > MAX_FITS_BYTES:
                raise HTTPException(413, "An observation cutout is too large for motion analysis; reduce the sky region.")
            result = bytearray()
            async for chunk in response.aiter_bytes():
                result.extend(chunk)
                if len(result) > MAX_FITS_BYTES:
                    raise HTTPException(413, "An observation cutout exceeded the motion-analysis size limit.")
            if not result:
                raise HTTPException(502, "IRSA returned an empty FITS cutout.")
            return bytes(result)
    raise HTTPException(502, "IRSA redirected this cutout too many times.")


async def _get_cutout(client: httpx.AsyncClient, epoch: MotionEpoch, request: MotionAnalysisRequest) -> bytes:
    cutout_url = _cutout_url(epoch, request)
    key = hashlib.sha256(cutout_url.encode("utf-8")).hexdigest()
    cached = _cache_get(key)
    if cached is not None:
        return cached
    for attempt in range(3):
        try:
            result = await _download_cutout(client, cutout_url)
            _cache_put(key, result)
            return result
        except httpx.TimeoutException as exc:
            if attempt == 2:
                raise HTTPException(504, "IRSA did not return an observation cutout before the timeout.") from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in {429, 502, 503, 504} or attempt == 2:
                raise HTTPException(502, "IRSA could not return this observation cutout.") from exc
        await asyncio.sleep(0.6 * (attempt + 1))
    raise HTTPException(502, "IRSA could not return this observation cutout.")


def _as_plane(array: Any, label: str) -> np.ndarray:
    values = np.asarray(array)
    if values.ndim != 2:
        raise ValueError(f"The {label} extension is not a two-dimensional spectral-image cutout.")
    if values.size > MAX_IMAGE_PIXELS:
        raise ValueError("The selected FITS image exceeds the motion-analysis pixel limit.")
    return values


def _flux_scale_to_jy_per_pixel(bunit: str, pixel_area_sr: float) -> tuple[float, str]:
    unit = bunit.lower().replace(" ", "").replace("**", "^")
    if "mjy/sr" in unit or "mjy.sr" in unit or "mjy*sr-1" in unit:
        return 1e6 * pixel_area_sr, "Jy"
    if "jy/sr" in unit or "jy.sr" in unit or "jy*sr-1" in unit:
        return pixel_area_sr, "Jy"
    return 1.0, f"{bunit or 'data units'} × pixel"


def _spectral_values_at_pixel(spectral_wcs: WCS | None, x_pixel: float, y_pixel: float) -> tuple[float | None, float | None]:
    """Read the approximate per-pixel wavelength and bandwidth via SPHEREx WCS-WAVE."""
    try:
        if spectral_wcs is None:
            return None, None
        wavelength, bandwidth = spectral_wcs.pixel_to_world(x_pixel, y_pixel)
        wavelength_um = float(wavelength.to_value(u.um))
        bandwidth_um = float(bandwidth.to_value(u.um))
        if not (math.isfinite(wavelength_um) and math.isfinite(bandwidth_um) and wavelength_um > 0 and bandwidth_um > 0):
            return None, None
        return wavelength_um, bandwidth_um
    except (AttributeError, IndexError, TypeError, ValueError, OverflowError, u.UnitConversionError):
        return None, None


def _spatial_wcs_warnings(header: Any, ctype_values: list[str]) -> list[str]:
    has_sip_coefficients = any(key in header for key in ("A_ORDER", "B_ORDER", "AP_ORDER", "BP_ORDER"))
    has_sip_ctype = bool(ctype_values) and all("-SIP" in value.upper() for value in ctype_values)
    if has_sip_coefficients and not has_sip_ctype:
        return ["SIP distortion terms are present while CTYPE omits -SIP; Astropy applies the supplied terms, but these coordinates are not externally astrometrically validated."]
    return []


def _aperture_measurement(data: np.ndarray, error: np.ndarray, valid: np.ndarray, x: float, y: float, radius: float) -> tuple[float, float]:
    aperture = CircularAperture((x, y), r=radius)
    mask = aperture.to_mask(method="exact")
    weights = mask.to_image(data.shape)
    if weights is None:
        return 0.0, math.inf
    usable = valid & np.isfinite(data) & np.isfinite(error)
    total_weight = float(np.sum(weights))
    valid_weight = float(np.sum(np.where(usable, weights, 0.0)))
    if total_weight <= 0 or valid_weight / total_weight < 0.85:
        return 0.0, math.inf
    weights = np.where(usable, weights, 0.0)
    flux = float(np.sum(data * weights))
    uncertainty = float(np.sqrt(np.sum((error * weights) ** 2)))
    return flux, uncertainty


def _extract_sources(fits_bytes: bytes, epoch: MotionEpoch, threshold_sigma: float, target_ra_deg: float, target_dec_deg: float) -> dict[str, Any]:
    try:
        with fits.open(io.BytesIO(fits_bytes), memmap=False, ignore_missing_simple=True) as hdus:
            image_hdu = next((hdu for hdu in hdus if str(hdu.header.get("EXTNAME", "")).strip().upper() in {"IMAGE", "SCI", "SCIENCE"} and getattr(hdu, "data", None) is not None), None)
            if image_hdu is None:
                image_hdu = next((hdu for hdu in hdus if isinstance(hdu, (fits.PrimaryHDU, fits.ImageHDU, fits.CompImageHDU)) and getattr(hdu, "data", None) is not None), None)
            if image_hdu is None:
                raise ValueError("No scientific image extension was found in the FITS cutout.")
            raw = _as_plane(image_hdu.data, "IMAGE").astype(np.float64)
            hdu_names = {str(hdu.header.get("EXTNAME", "PRIMARY")).strip().upper(): hdu for hdu in hdus}
            wcs = WCS(image_hdu.header, relax=True).celestial
            if not wcs.has_celestial or wcs.pixel_n_dim != 2:
                raise ValueError("This observation has no usable two-dimensional celestial WCS.")
            ctype_values = [str(item) for item in wcs.wcs.ctype]
            header_ctype_values = [str(image_hdu.header.get(f"CTYPE{index}", "")) for index in (1, 2)]
            wcs_warnings = _spatial_wcs_warnings(image_hdu.header, header_ctype_values)
            scales = np.abs(np.asarray(proj_plane_pixel_scales(wcs), dtype=float) * 3600.0)
            if scales.shape != (2,) or not np.all(np.isfinite(scales)) or np.any(scales <= 0):
                raise ValueError("The FITS WCS does not provide a valid pixel scale.")

            variance_hdu = hdu_names.get("VARIANCE")
            variance = None
            if variance_hdu is not None and getattr(variance_hdu, "data", None) is not None:
                candidate = _as_plane(variance_hdu.data, "VARIANCE").astype(np.float64)
                if candidate.shape == raw.shape:
                    variance = candidate
            flags_hdu = hdu_names.get("FLAGS")
            flags = None
            if flags_hdu is not None and getattr(flags_hdu, "data", None) is not None:
                candidate = _as_plane(flags_hdu.data, "FLAGS")
                if candidate.shape == raw.shape:
                    flags = candidate
            zodi_hdu = hdu_names.get("ZODI")
            wave_hdu = hdu_names.get("WCS-WAVE")
            spectral_wcs = None
            if wave_hdu is not None and getattr(wave_hdu, "data", None) is not None:
                try:
                    spectral_wcs = WCS(header=image_hdu.header, fobj=hdus, key="W")
                    # SPHEREx's spectral coordinates depend on detector-filter
                    # position, not optical SIP distortion (IRSA tutorial §8b).
                    spectral_wcs.sip = None
                except Exception:
                    spectral_wcs = None
            zodi_subtracted = False
            signal = raw.copy()
            if zodi_hdu is not None and getattr(zodi_hdu, "data", None) is not None:
                candidate = _as_plane(zodi_hdu.data, "ZODI").astype(np.float64)
                if candidate.shape == raw.shape:
                    signal -= candidate
                    zodi_subtracted = True

            valid = np.isfinite(signal)
            if flags is not None:
                # The official IRSA source-discovery tutorial retains nominal flag
                # values 0, 2, and 2**21 (good-source-mask); other bit patterns are
                # treated as quality-affected. This avoids rejecting the whole image
                # when nominal SPHEREx pixels carry the 2**21 good-pixel flag.
                valid &= np.isin(np.asarray(flags), (0, 2, 2097152))
            if variance is not None:
                valid &= np.isfinite(variance) & (variance > 0)
            valid_count = int(np.count_nonzero(valid))
            if valid_count < 25:
                raise ValueError("Too few unflagged finite pixels remain for source detection.")

            background = float(np.median(signal[valid]))
            residual = signal - background
            mad = float(np.median(np.abs(residual[valid])))
            empirical_sigma = 1.4826 * mad
            variance_error = np.sqrt(variance) if variance is not None else None
            variance_median = float(np.median(variance_error[valid])) if variance_error is not None else 0.0
            noise = max(empirical_sigma if empirical_sigma > 0 else 0.0, variance_median)
            if not math.isfinite(noise) or noise <= 0:
                noise = float(np.std(residual[valid]))
            if not math.isfinite(noise) or noise <= 0:
                raise ValueError("The cutout has no measurable background noise for a defensible detection threshold.")

            if variance_error is None:
                error_map = np.full(raw.shape, noise, dtype=np.float64)
                uncertainty_method = "robust background RMS; VARIANCE extension unavailable"
            else:
                excess_background_variance = max(0.0, empirical_sigma**2 - variance_median**2)
                error_map = np.sqrt(np.where(np.isfinite(variance) & (variance > 0), variance, noise**2) + excess_background_variance)
                uncertainty_method = "FITS VARIANCE plus excess robust background RMS; flagged-pixel mask"
            pixel_scale = math.sqrt(float(scales[0] * scales[1]))
            fwhm_pixels = max(1.0, epoch.resolution_arcsec / pixel_scale) if epoch.resolution_arcsec else 2.2
            aperture_radius = max(1.8, 1.5 * fwhm_pixels)
            finder = DAOStarFinder(
                threshold=threshold_sigma * noise,
                fwhm=fwhm_pixels,
                exclude_border=True,
                sharpness_range=(0.05, 2.0),
                roundness_range=(-1.0, 1.0),
            )
            sources = finder(np.where(valid, residual, 0.0), mask=~valid)
            detections: list[dict[str, Any]] = []
            if sources is not None:
                centroid_x_key = "x_centroid" if "x_centroid" in sources.colnames else "xcentroid"
                centroid_y_key = "y_centroid" if "y_centroid" in sources.colnames else "ycentroid"
                for row in sources[:500]:
                    x, y = float(row[centroid_x_key]), float(row[centroid_y_key])
                    ra, dec = wcs.pixel_to_world_values(x, y)
                    if not (math.isfinite(float(ra)) and math.isfinite(float(dec))):
                        continue
                    aperture_flux, aperture_error = _aperture_measurement(residual, error_map, valid, x, y, aperture_radius)
                    if not math.isfinite(aperture_error) or aperture_error <= 0:
                        continue
                    snr = aperture_flux / aperture_error
                    if snr < threshold_sigma:
                        continue
                    systematic_floor = 0.5 * pixel_scale
                    centroid_sigma_px = max(0.08, fwhm_pixels / (2.354820045 * max(snr, 1.0)))
                    centroid_sigma_arcsec = centroid_sigma_px * pixel_scale
                    position_sigma_arcsec = math.hypot(centroid_sigma_arcsec, systematic_floor)
                    area_sr = float(scales[0] * scales[1]) * (math.pi / (180 * 3600)) ** 2
                    flux_factor, flux_unit = _flux_scale_to_jy_per_pixel(str(image_hdu.header.get("BUNIT", "")), area_sr)
                    local_wavelength, local_bandwidth = _spectral_values_at_pixel(spectral_wcs, x, y)
                    height, width = raw.shape
                    display_scale = min(1.0, 1024.0 / max(height, width))
                    detections.append({
                        "x": x,
                        "y": y,
                        "x_display": x * display_scale,
                        "y_display": y * display_scale,
                        "ra_deg": float(ra) % 360.0,
                        "dec_deg": float(dec),
                        "flux": aperture_flux * flux_factor,
                        "flux_uncertainty": aperture_error * abs(flux_factor),
                        "flux_unit": flux_unit,
                        "local_wavelength_um": local_wavelength,
                        "local_bandwidth_um": local_bandwidth,
                        "signal_to_noise": float(snr),
                        "centroid_uncertainty_arcsec": centroid_sigma_arcsec,
                        "position_uncertainty_arcsec": position_sigma_arcsec,
                        "sharpness": float(row["sharpness"]) if np.isfinite(row["sharpness"]) else None,
                        "roundness": float(row["roundness1"]) if np.isfinite(row["roundness1"]) else None,
                        "classification": "image source detection",
                    })
            detections.sort(key=lambda item: item["signal_to_noise"], reverse=True)
            image_header = image_hdu.header
            center_ra, center_dec = wcs.pixel_to_world_values((raw.shape[1] - 1) / 2, (raw.shape[0] - 1) / 2)
            target_x, target_y = wcs.world_to_pixel_values(target_ra_deg, target_dec_deg)
            target_wavelength, target_bandwidth = _spectral_values_at_pixel(spectral_wcs, target_x, target_y)
            extensions = [str(hdu.header.get("EXTNAME", "PRIMARY")).strip() or "PRIMARY" for hdu in hdus]
            wcs_wave_available = "WCS-WAVE" in hdu_names
            return {
                "epoch_id": epoch.id,
                "product_id": epoch.product_id,
                "observation_start": epoch.observation_start,
                "release": epoch.release,
                "collection": epoch.collection,
                "calibration_level": epoch.calibration_level,
                "wavelength_min_um": epoch.wavelength_min_um,
                "wavelength_max_um": epoch.wavelength_max_um,
                "image_width": int(raw.shape[1]),
                "image_height": int(raw.shape[0]),
                "display_width": int(round(raw.shape[1] * min(1.0, 1024.0 / max(raw.shape)))),
                "display_height": int(round(raw.shape[0] * min(1.0, 1024.0 / max(raw.shape)))),
                "bunit": str(image_header.get("BUNIT", "")) or None,
                "wcs": {"available": True, "ctype": ctype_values, "pixel_scale_arcsec": [float(item) for item in scales], "center_ra_deg": float(center_ra) % 360.0, "center_dec_deg": float(center_dec), "warnings": wcs_warnings},
                "resolution_arcsec": epoch.resolution_arcsec,
                "detection_fwhm_pixels": fwhm_pixels,
                "detection_fwhm_policy": "SIA reported angular resolution converted to pixels with a 1 px minimum; EPSF fitting is not performed",
                "quality": {
                    "total_pixels": int(raw.size),
                    "valid_pixels": valid_count,
                    "flagged_or_invalid_pixels": int(raw.size - valid_count),
                    "valid_fraction": valid_count / raw.size,
                    "flags_applied": flags is not None,
                    "variance_applied": variance is not None,
                    "zodi_subtracted_for_detection": zodi_subtracted,
                    "background_median": background,
                    "background_rms": noise,
                    "uncertainty_method": uncertainty_method,
                },
                "fits_extensions": extensions,
                "wcs_wave_available": wcs_wave_available,
                "spectral_at_query": {"wavelength_um": target_wavelength, "bandwidth_um": target_bandwidth, "source": "Astropy alternate WCS-WAVE; approximate visualization lookup" if target_wavelength is not None else "unavailable"},
                "source_count": len(detections),
                "detections": detections,
                "source": "NASA/IPAC IRSA SPHEREx FITS cutout",
                "classification": "direct observation pixels processed by Photutils",
            }
    except HTTPException:
        raise
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError("The FITS cutout could not be read or processed safely.") from exc


def _tangent_offsets(ra_deg: np.ndarray, dec_deg: np.ndarray, center_ra_deg: float, center_dec_deg: float) -> tuple[np.ndarray, np.ndarray]:
    delta_ra = (ra_deg - center_ra_deg + 180.0) % 360.0 - 180.0
    east = delta_ra * math.cos(math.radians(center_dec_deg)) * 3600.0
    north = (dec_deg - center_dec_deg) * 3600.0
    return east, north


def _angular_separation_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    ra1r, dec1r, ra2r, dec2r = map(math.radians, (ra1, dec1, ra2, dec2))
    dra, ddec = ra2r - ra1r, dec2r - dec1r
    haversine = math.sin(ddec / 2.0) ** 2 + math.cos(dec1r) * math.cos(dec2r) * math.sin(dra / 2.0) ** 2
    return math.degrees(2.0 * math.asin(math.sqrt(min(1.0, max(0.0, haversine))))) * 3600.0


def _estimate_registration(reference: dict[str, Any], epoch: dict[str, Any], search_radius_arcsec: float) -> dict[str, Any]:
    reference_detections = reference["detections"]
    detections = epoch["detections"]
    if len(reference_detections) < 3 or len(detections) < 3:
        return {"east_offset_arcsec": 0.0, "north_offset_arcsec": 0.0, "uncertainty_arcsec": 0.0, "matched_sources": 0, "status": "not estimated: fewer than three sources"}
    ref_ra = np.array([item["ra_deg"] for item in reference_detections], dtype=float)
    ref_dec = np.array([item["dec_deg"] for item in reference_detections], dtype=float)
    obs_ra = np.array([item["ra_deg"] for item in detections], dtype=float)
    obs_dec = np.array([item["dec_deg"] for item in detections], dtype=float)
    try:
        from astropy.coordinates import SkyCoord
        import astropy.units as u
        ref_coord = SkyCoord(ref_ra * u.deg, ref_dec * u.deg, frame="icrs")
        obs_coord = SkyCoord(obs_ra * u.deg, obs_dec * u.deg, frame="icrs")
        obs_index, separation, _ = ref_coord.match_to_catalog_sky(obs_coord)
        ref_index, _, _ = obs_coord.match_to_catalog_sky(ref_coord)
    except Exception:
        return {"east_offset_arcsec": 0.0, "north_offset_arcsec": 0.0, "uncertainty_arcsec": 0.0, "matched_sources": 0, "status": "not estimated: WCS catalogue matching failed"}
    max_registration = max(search_radius_arcsec, float(np.nanmedian(reference["wcs"]["pixel_scale_arcsec"])) * 2.0)
    pairs = [(index, int(other)) for index, other in enumerate(obs_index) if ref_index[int(other)] == index and separation[index].arcsec <= max_registration]
    if len(pairs) < 3:
        return {"east_offset_arcsec": 0.0, "north_offset_arcsec": 0.0, "uncertainty_arcsec": 0.0, "matched_sources": len(pairs), "status": "not estimated: fewer than three mutual background matches"}
    ref_indices = np.array([pair[0] for pair in pairs], dtype=int)
    obs_indices = np.array([pair[1] for pair in pairs], dtype=int)
    center_ra, center_dec = reference["wcs"].get("center_ra_deg"), reference["wcs"].get("center_dec_deg")
    if center_ra is None or center_dec is None:
        center_ra = float(np.median(ref_ra))
        center_dec = float(np.median(ref_dec))
    ref_east, ref_north = _tangent_offsets(ref_ra, ref_dec, center_ra, center_dec)
    obs_east, obs_north = _tangent_offsets(obs_ra, obs_dec, center_ra, center_dec)
    dx = obs_east[obs_indices] - ref_east[ref_indices]
    dy = obs_north[obs_indices] - ref_north[ref_indices]
    offset_x, offset_y = float(np.median(dx)), float(np.median(dy))
    residual = np.hypot(dx - offset_x, dy - offset_y)
    residual_median = float(np.median(residual))
    robust_sigma = 1.4826 * float(np.median(np.abs(residual - residual_median)))
    clip = max(1.0, 3.0 * robust_sigma)
    inliers = residual <= residual_median + clip
    if np.count_nonzero(inliers) >= 3:
        offset_x = float(np.median(dx[inliers]))
        offset_y = float(np.median(dy[inliers]))
        residual = np.hypot(dx[inliers] - offset_x, dy[inliers] - offset_y)
    uncertainty = max(0.1, 1.4826 * float(np.median(np.abs(residual - np.median(residual)))) / math.sqrt(max(1, len(residual))))
    return {
        "east_offset_arcsec": offset_x,
        "north_offset_arcsec": offset_y,
        "uncertainty_arcsec": uncertainty,
        "matched_sources": int(len(residual)),
        "status": "robust translation from mutual WCS matches; not a full image registration",
    }


def _local_channel_compatibility(points: list[dict[str, Any]]) -> dict[str, Any]:
    if len(points) < 2:
        return {"compatible": None, "overlap_fraction": None, "common_wavelength_range_um": None, "status": "at least two matched positions are needed to compare local wavelengths"}
    bands = []
    for point in points:
        wavelength, bandwidth = point.get("local_wavelength_um"), point.get("local_bandwidth_um")
        if wavelength is None or bandwidth is None or not math.isfinite(float(wavelength)) or not math.isfinite(float(bandwidth)) or float(bandwidth) <= 0:
            return {"compatible": False, "overlap_fraction": None, "common_wavelength_range_um": None, "status": "approximate local WCS-WAVE wavelength or bandwidth is unavailable for one or more matched source positions"}
        bands.append((float(wavelength) - float(bandwidth) / 2, float(wavelength) + float(bandwidth) / 2))
    common_low, common_high = max(item[0] for item in bands), min(item[1] for item in bands)
    narrowest_band = min(high - low for low, high in bands)
    overlap_fraction = max(0.0, common_high - common_low) / narrowest_band
    return {
        "compatible": overlap_fraction >= 0.95,
        "overlap_fraction": overlap_fraction,
        "common_wavelength_range_um": [common_low, common_high] if common_high > common_low else None,
        "wavelengths_um": [point["local_wavelength_um"] for point in points],
        "status": "approximate WCS-WAVE local bands overlap by at least 95%" if overlap_fraction >= 0.95 else "approximate WCS-WAVE local bands differ by more than the 5% tolerance; apparent-motion fit withheld",
        "rule": "Astropy alternate spectral WCS at each matched centroid; approximate WCS-WAVE central wavelength ± half-bandwidth; at least 95% overlap of the narrowest passband",
    }


def _fit_motion(track: dict[str, Any], distance_pc: float | None, spectral_compatibility: dict[str, Any] | None = None) -> dict[str, Any]:
    points = track["positions"]
    result: dict[str, Any] = {
        "angular_displacement_arcsec": None,
        "angular_rate_arcsec_hour": None,
        "proper_motion": None,
        "transverse_velocity_kms": None,
        "classification": "unavailable: insufficient matched epochs",
    }
    if len(points) >= 2:
        first, last = points[0], points[-1]
        first_time = datetime.fromisoformat(first["observation_start"].replace("Z", "+00:00"))
        last_time = datetime.fromisoformat(last["observation_start"].replace("Z", "+00:00"))
        hours = (last_time - first_time).total_seconds() / 3600.0
        displacement = _angular_separation_arcsec(first["ra_deg"], first["dec_deg"], last["ra_deg"], last["dec_deg"])
        result["angular_displacement_arcsec"] = displacement
        result["angular_rate_arcsec_hour"] = displacement / hours if hours > 0 else None
    if spectral_compatibility is not None and spectral_compatibility.get("compatible") is not True:
        result["classification"] = f"unavailable: {spectral_compatibility.get('status', 'local spectral compatibility could not be verified')}"
        return result
    if len(points) < 3:
        return result
    times = np.array([datetime.fromisoformat(point["observation_start"].replace("Z", "+00:00")).timestamp() / 86400.0 for point in points])
    baseline_days = float(times.max() - times.min())
    if baseline_days < 1.0:
        result["classification"] = "unavailable: baseline shorter than one day"
        return result
    center_ra = float(points[0]["ra_deg"])
    center_dec = float(points[0]["dec_deg"])
    ras = np.array([point["ra_deg"] for point in points], dtype=float)
    decs = np.array([point["dec_deg"] for point in points], dtype=float)
    east, north = _tangent_offsets(ras, decs, center_ra, center_dec)
    t = (times - times.mean()) / 365.25
    sigma = np.array([max(float(point["position_uncertainty_arcsec"]), 0.1) for point in points], dtype=float)
    design = np.column_stack((np.ones_like(t), t))
    weights = 1.0 / np.square(sigma)
    normal = design.T @ (weights[:, None] * design)
    if np.linalg.cond(normal) > 1e12:
        result["classification"] = "unavailable: observation times do not constrain a linear rate"
        return result
    covariance = np.linalg.inv(normal)
    beta_east = covariance @ (design.T @ (weights * east))
    beta_north = covariance @ (design.T @ (weights * north))
    residual_east = east - design @ beta_east
    residual_north = north - design @ beta_north
    dof = max(1, len(points) - 2)
    scale_east = max(1.0, float(np.sum(weights * residual_east**2) / dof))
    scale_north = max(1.0, float(np.sum(weights * residual_north**2) / dof))
    sigma_east = float(math.sqrt(covariance[1, 1] * scale_east))
    sigma_north = float(math.sqrt(covariance[1, 1] * scale_north))
    mu_east, mu_north = float(beta_east[1]), float(beta_north[1])
    mu_total = math.hypot(mu_east, mu_north)
    mu_sigma = math.hypot(sigma_east, sigma_north)
    significance = mu_total / mu_sigma if mu_sigma > 0 else None
    result["proper_motion"] = {
        "ra_cosdec_arcsec_per_year": mu_east,
        "dec_arcsec_per_year": mu_north,
        "total_arcsec_per_year": mu_total,
        "uncertainty_arcsec_per_year": mu_sigma,
        "ra_uncertainty_arcsec_per_year": sigma_east,
        "dec_uncertainty_arcsec_per_year": sigma_north,
        "significance_sigma": significance,
        "baseline_days": baseline_days,
        "observations": len(points),
        "fit": "uncertainty-weighted linear regression in the local east/north tangent plane",
        "classification": "calculated apparent angular motion; not a stellar proper-motion classification",
    }
    if distance_pc is not None:
        result["transverse_velocity_kms"] = 4.74047 * mu_total * distance_pc
    result["classification"] = "motion candidate" if significance is not None and significance >= 3 else "consistent with no significant motion at current precision"
    return result


def _match_and_fit(epochs: list[dict[str, Any]], request: MotionAnalysisRequest) -> dict[str, Any]:
    if not epochs or not epochs[0]["detections"]:
        return {"tracks": [], "registration": [], "unmatched_by_epoch": [item["source_count"] for item in epochs]}
    reference = epochs[0]
    ref_detections = reference["detections"]
    ref_ra = float(np.median([item["ra_deg"] for item in ref_detections]))
    ref_dec = float(np.median([item["dec_deg"] for item in ref_detections]))
    ref_east, ref_north = _tangent_offsets(
        np.array([item["ra_deg"] for item in ref_detections]),
        np.array([item["dec_deg"] for item in ref_detections]),
        ref_ra,
        ref_dec,
    )
    tracks = [{"source_id": f"SRC-{index + 1:04d}", "reference_detection": detection, "positions": [{
        "epoch_id": reference["epoch_id"], "product_id": reference["product_id"], "observation_start": reference["observation_start"],
        "ra_deg": detection["ra_deg"], "dec_deg": detection["dec_deg"], "observed_ra_deg": detection["ra_deg"], "observed_dec_deg": detection["dec_deg"], "east_offset_arcsec": float(ref_east[index]),
        "north_offset_arcsec": float(ref_north[index]), "position_uncertainty_arcsec": detection["position_uncertainty_arcsec"],
        "local_wavelength_um": detection["local_wavelength_um"], "local_bandwidth_um": detection["local_bandwidth_um"],
        "signal_to_noise": detection["signal_to_noise"], "flux": detection["flux"], "flux_uncertainty": detection["flux_uncertainty"], "flux_unit": detection["flux_unit"],
        "x": detection["x"], "y": detection["y"], "x_display": detection["x_display"], "y_display": detection["y_display"],
    }]} for index, detection in enumerate(ref_detections)]
    registrations = [{"epoch_id": reference["epoch_id"], "east_offset_arcsec": 0.0, "north_offset_arcsec": 0.0, "uncertainty_arcsec": 0.0, "matched_sources": len(ref_detections), "status": "reference WCS frame"}]
    unmatched = [0]
    for epoch in epochs[1:]:
        registration = _estimate_registration(reference, epoch, request.match_radius_arcsec)
        registrations.append({"epoch_id": epoch["epoch_id"], **registration})
        detections = epoch["detections"]
        unmatched.append(len(detections))
        if not detections or not tracks:
            continue
        detection_ra = np.array([item["ra_deg"] for item in detections], dtype=float)
        detection_dec = np.array([item["dec_deg"] for item in detections], dtype=float)
        east, north = _tangent_offsets(detection_ra, detection_dec, ref_ra, ref_dec)
        east -= registration["east_offset_arcsec"]
        north -= registration["north_offset_arcsec"]
        cos_dec = max(1e-8, abs(math.cos(math.radians(ref_dec))))
        registered_ra = (ref_ra + east / (3600.0 * cos_dec)) % 360.0
        registered_dec = np.clip(ref_dec + north / 3600.0, -90.0, 90.0)
        track_east = np.array([float(ref_east[index]) for index in range(len(tracks))])
        track_north = np.array([float(ref_north[index]) for index in range(len(tracks))])
        cost = np.hypot(track_east[:, None] - east[None, :], track_north[:, None] - north[None, :])
        row_indices, column_indices = linear_sum_assignment(cost)
        used = 0
        for track_index, detection_index in zip(row_indices, column_indices):
            if cost[track_index, detection_index] > request.match_radius_arcsec:
                continue
            detection = detections[int(detection_index)]
            position_uncertainty = math.hypot(float(detection["position_uncertainty_arcsec"]), float(registration["uncertainty_arcsec"]))
            tracks[int(track_index)]["positions"].append({
                "epoch_id": epoch["epoch_id"], "product_id": epoch["product_id"], "observation_start": epoch["observation_start"],
                "ra_deg": float(registered_ra[detection_index]), "dec_deg": float(registered_dec[detection_index]),
                "observed_ra_deg": float(detection["ra_deg"]), "observed_dec_deg": float(detection["dec_deg"]),
                "east_offset_arcsec": float(east[detection_index]), "north_offset_arcsec": float(north[detection_index]),
                "local_wavelength_um": detection["local_wavelength_um"], "local_bandwidth_um": detection["local_bandwidth_um"],
                "position_uncertainty_arcsec": position_uncertainty, "signal_to_noise": detection["signal_to_noise"],
                "flux": detection["flux"], "flux_uncertainty": detection["flux_uncertainty"], "flux_unit": detection["flux_unit"],
                "x": detection["x"], "y": detection["y"], "x_display": detection["x_display"], "y_display": detection["y_display"],
            })
            used += 1
        unmatched[-1] = len(detections) - used
    output_tracks = []
    for track in tracks:
        positions = sorted(track["positions"], key=lambda item: item["observation_start"])
        spectral_compatibility = _local_channel_compatibility(positions) if len(positions) >= 2 else None
        measurement = _fit_motion({"positions": positions}, request.distance_pc, spectral_compatibility)
        ref = track["reference_detection"]
        output_tracks.append({
            "source_id": track["source_id"],
            "reference_position": {"ra_deg": ref["ra_deg"], "dec_deg": ref["dec_deg"], "x_display": ref["x_display"], "y_display": ref["y_display"]},
            "source_quality": {"reference_snr": ref["signal_to_noise"], "reference_flux": ref["flux"], "reference_flux_unit": ref["flux_unit"], "reference_position_uncertainty_arcsec": ref["position_uncertainty_arcsec"]},
            "positions": positions,
            "matched_epochs": len(positions),
            "spectral_compatibility": spectral_compatibility,
            **measurement,
        })
    output_tracks.sort(key=lambda item: (item.get("proper_motion") or {}).get("significance_sigma") or 0, reverse=True)
    return {"tracks": output_tracks, "registration": registrations, "unmatched_by_epoch": unmatched}


def _compatibility_reasons(epochs: list[MotionEpoch]) -> list[str]:
    reasons: list[str] = []
    if len({item.collection for item in epochs}) != 1:
        reasons.append("Selected observations come from different SIA2 collections or data releases.")
    calibration = {item.calibration_level for item in epochs}
    if None in calibration or len(calibration) != 1:
        reasons.append("The selected observations do not have the same reported calibration level.")
    wave_ranges = [(item.wavelength_min_um, item.wavelength_max_um) for item in epochs]
    if any(low is None or high is None for low, high in wave_ranges):
        reasons.append("A wavelength range is missing from one or more observations.")
    else:
        base_low, base_high = wave_ranges[0]
        base_width = base_high - base_low
        for low, high in wave_ranges[1:]:
            overlap = max(0.0, min(base_high, high) - max(base_low, low))
            if base_width <= 0 or high <= low or overlap / min(base_width, high - low) < 0.95:
                reasons.append("Selected observations do not have at least 95% overlapping reported wavelength coverage.")
                break
    times = []
    for item in epochs:
        try:
            parsed = datetime.fromisoformat(item.observation_start.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            times.append(parsed.astimezone(timezone.utc))
        except ValueError:
            reasons.append(f"Observation {item.product_id} has an unreadable UTC timestamp.")
    if len(times) == len(epochs) and len({item.isoformat() for item in times}) < 2:
        reasons.append("The selected products do not have distinct observation timestamps.")
    return reasons


@router.post("/analyze")
async def analyze_motion(request: MotionAnalysisRequest):
    if len({item.id for item in request.epochs}) != len(request.epochs):
        raise HTTPException(422, "Select each observation only once.")
    reasons = _compatibility_reasons(request.epochs)
    if reasons:
        raise HTTPException(409, {"message": "These observations are not compatible for motion analysis.", "reasons": reasons})
    for epoch in request.epochs:
        _validate_irsa_url(epoch.original_url)

    async with httpx.AsyncClient(timeout=35.0, follow_redirects=False) as client:
        semaphore = asyncio.Semaphore(MAX_PARALLEL_CUTOUTS)

        async def retrieve_cutout(epoch: MotionEpoch) -> bytes:
            async with semaphore:
                return await _get_cutout(client, epoch, request)

        downloaded = await asyncio.gather(*[retrieve_cutout(item) for item in request.epochs], return_exceptions=True)
    successful: list[tuple[MotionEpoch, bytes]] = []
    errors: list[dict[str, str]] = []
    for epoch, result in zip(request.epochs, downloaded):
        if isinstance(result, BaseException):
            detail = result.detail if isinstance(result, HTTPException) else "IRSA cutout could not be retrieved for this observation."
            errors.append({"epoch_id": epoch.id, "product_id": epoch.product_id, "detail": detail})
        else:
            successful.append((epoch, result))
    if len(successful) < 2:
        raise HTTPException(422, {"message": "At least two compatible FITS cutouts are required to calculate motion.", "unavailable_epochs": errors})

    processed = await asyncio.gather(*[
        run_in_threadpool(_extract_sources, fits_bytes, epoch, request.threshold_sigma, request.ra, request.dec)
        for epoch, fits_bytes in successful
    ], return_exceptions=True)
    epochs: list[dict[str, Any]] = []
    for (epoch, _), result in zip(successful, processed):
        if isinstance(result, BaseException):
            detail = str(result) if isinstance(result, ValueError) else "FITS source detection could not process this cutout."
            errors.append({"epoch_id": epoch.id, "product_id": epoch.product_id, "detail": detail})
        else:
            result["original_url"] = epoch.original_url
            epochs.append(result)
    if len(epochs) < 2:
        raise HTTPException(422, {"message": "Fewer than two selected FITS cutouts passed WCS and quality checks.", "unavailable_epochs": errors})

    epochs.sort(key=lambda item: item["observation_start"])
    matching = await run_in_threadpool(_match_and_fit, epochs, request)
    motion_candidates = [item for item in matching["tracks"] if item["classification"] == "motion candidate"]
    return {
        "query": {"ra": request.ra, "dec": request.dec, "cutout_size_deg": request.cutout_size_deg, "match_radius_arcsec": request.match_radius_arcsec, "threshold_sigma": request.threshold_sigma},
        "status": "complete" if not errors else "partial",
        "source": "NASA/IPAC IRSA SPHEREx spectral-image FITS cutouts",
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "classification": "direct observations processed; positions and motion are calculated measurements, not archive catalogue source identifications",
        "compatibility": {"compatible": True, "level": "product metadata", "collection": epochs[0]["collection"], "calibration_level": epochs[0]["calibration_level"], "wavelength_min_um": epochs[0]["wavelength_min_um"], "wavelength_max_um": epochs[0]["wavelength_max_um"], "rule": "same SIA2 collection, matching calibration level, distinct UTC times, at least 95% overlap in reported product wavelength ranges; per-source LVF passband overlap is checked separately for each track"},
        "epochs": epochs,
        "registration": matching["registration"],
        "tracks": matching["tracks"],
        "motion_candidate_count": len(motion_candidates),
        "unmatched_detections_by_epoch": matching["unmatched_by_epoch"],
        "unavailable_epochs": errors,
        "distance_pc": request.distance_pc,
        "velocity_status": "transverse velocities are calculated only when a positive distance in parsecs is provided" if request.distance_pc is None else "calculated from measured angular motion and user-supplied distance; radial velocity unavailable",
        "methodology": [
            "Photutils DAOStarFinder detects peaks above the configured global threshold; the documented nominal FLAGS values 0, 2, and 2^21 are retained and other flag values are masked.",
            "VARIANCE supplies per-pixel flux uncertainty when present. The ZODI model is subtracted for detection only when the matching HDU exists.",
            "Astropy WCS converts centroids to sky coordinates. Epochs are aligned only by a robust median translation from mutual background-source matches.",
            "Astropy's alternate SPHEREx spectral WCS (WCS-WAVE) is sampled at the search coordinate and every detected source with spectral SIP disabled. This approximate lookup supports visualization-level passband screening only; calibration-grade spectral work requires CWAVE/CBAND products. Apparent-motion fits are conservatively withheld unless each track has at least 95% overlap among the approximate local wavelength/bandwidth intervals.",
            "Source tracks use one-to-one minimum-cost matches in the local tangent plane. Uncertainty includes centroiding and a conservative half-pixel floor; it is not a full astrometric calibration.",
            "Proper motion is reported only for at least three matched epochs spanning at least one day and is labelled apparent angular motion, not stellar proper motion.",
            "Unmatched single-epoch detections are not labelled as discoveries or moving objects.",
        ],
    }
