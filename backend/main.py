from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import math
import os
import re
import time
import xml.etree.ElementTree as ET
from collections import OrderedDict, defaultdict, deque
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlsplit, urlunsplit

import httpx
import numpy as np
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_scales
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from backend.tno import router as tno_router
from backend.motion import router as motion_router
from backend.catalog import router as catalog_router
from backend.spectral import register_cube_product, router as spectral_router

IRSA_SIA_URL = os.getenv("IRSA_SIA_URL", "https://irsa.ipac.caltech.edu/SIA")
IRSA_TIMEOUT_SECONDS = float(os.getenv("IRSA_TIMEOUT_SECONDS", "30"))
IRSA_MAX_RECORDS = int(os.getenv("IRSA_MAX_RECORDS", "100"))
PREVIEW_MAX_BYTES = int(os.getenv("PREVIEW_MAX_BYTES", "35000000"))
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "40"))
IRSA_HOSTS = {"irsa.ipac.caltech.edu"}
MAX_CACHE_ENTRIES = 256
MAX_CACHE_BYTES = 128 * 1024 * 1024
MAX_PREVIEW_PIXELS = 8_000_000
COLLECTIONS = {
    "dr1": "spherex_dr1",
    "dr1_deep": "spherex_dr1_deep",
    "dr1_cube": "spherex_dr1_cube",
    "qr3": "spherex_qr3",
    "qr3_deep": "spherex_qr3_deep",
}

app = FastAPI(
    title="ASCENTRA API",
    description="A public exploration interface for real SPHEREx observations in the NASA/IPAC IRSA archive.",
    version="1.0.0",
)
origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    expose_headers=["X-ASCENTRA-Preview-Metadata"],
)
app.include_router(tno_router)
app.include_router(motion_router)
app.include_router(catalog_router)
app.include_router(spectral_router)

_requests: dict[str, deque[float]] = defaultdict(deque)
_cache: OrderedDict[str, tuple[float, Any, int]] = OrderedDict()
_cache_bytes = 0
_url_by_id: dict[str, str] = {}
_image_centers: dict[str, tuple[float | None, float | None]] = {}
_preview_metadata: dict[str, tuple[float, dict[str, Any]]] = {}
_preview_wcs_headers: dict[str, tuple[float, str]] = {}
logger = logging.getLogger("ascentra.api")


@app.middleware("http")
async def light_rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        peer = request.client.host if request.client else "unknown"
        now = time.monotonic()
        bucket = _requests[peer]
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_PER_MINUTE:
            return Response(
                content='{"detail":"Request limit reached. Please wait a minute and try again."}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": "60"},
            )
        bucket.append(now)
    return await call_next(request)


class CompareRequest(BaseModel):
    earlier_url: str = Field(min_length=1, max_length=2048)
    later_url: str = Field(min_length=1, max_length=2048)
    earlier_collection: str = Field(min_length=1, max_length=80)
    later_collection: str = Field(min_length=1, max_length=80)
    earlier_band: str | None = Field(None, max_length=100)
    later_band: str | None = Field(None, max_length=100)
    earlier_calibration: int | None = Field(None, ge=0, le=10)
    later_calibration: int | None = Field(None, ge=0, le=10)
    earlier_mjd: float | None = Field(None, allow_inf_nan=False)
    later_mjd: float | None = Field(None, allow_inf_nan=False)


def _cache_get(key: str):
    global _cache_bytes
    record = _cache.get(key)
    if record and record[0] > time.monotonic():
        _cache.move_to_end(key)
        return record[1]
    if record:
        _cache.pop(key, None)
        _cache_bytes -= record[2]
    return None


def _cache_put(key: str, value: Any, ttl: int = 300):
    global _cache_bytes
    if isinstance(value, bytes):
        size_bytes = len(value)
    else:
        size_bytes = len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8"))
    if size_bytes > MAX_CACHE_BYTES:
        return
    previous = _cache.pop(key, None)
    if previous:
        _cache_bytes -= previous[2]
    while _cache and (len(_cache) >= MAX_CACHE_ENTRIES or _cache_bytes + size_bytes > MAX_CACHE_BYTES):
        _, (_, _, removed_bytes) = _cache.popitem(last=False)
        _cache_bytes -= removed_bytes
    _cache[key] = (time.monotonic() + ttl, value, size_bytes)
    _cache_bytes += size_bytes


def _num(value: Any) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def _format_date(mjd: float | None) -> str | None:
    if mjd is None:
        return None
    try:
        return Time(mjd, format="mjd", scale="utc").to_datetime(timezone=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except Exception:
        return None


def _parse_votable(xml_bytes: bytes) -> list[dict[str, Any]]:
    """Read SIA2 rows, preserving the old rows-only helper contract."""
    rows, _ = _parse_votable_response(xml_bytes)
    return rows


def _parse_votable_response(xml_bytes: bytes) -> tuple[list[dict[str, Any]], str | None]:
    """Read SIA2 rows and query status with Astropy and a safe XML fallback."""
    root = ET.fromstring(xml_bytes)
    statuses = [
        (info.attrib.get("value", "").upper(), (info.text or "").strip())
        for info in root.iter()
        if info.tag.rsplit("}", 1)[-1].upper() == "INFO" and info.attrib.get("name", "").upper() == "QUERY_STATUS"
    ]
    error = next((message for value, message in statuses if value == "ERROR"), None)
    if error is not None:
        raise ValueError(error or "IRSA reported an unsuccessful query")
    query_status = "OVERFLOW" if any(value == "OVERFLOW" for value, _ in statuses) else (statuses[-1][0] if statuses else None)
    try:
        from astropy.io.votable import parse_single_table

        table = parse_single_table(io.BytesIO(xml_bytes)).to_table(use_names_over_ids=True)
        rows = []
        for row in table:
            item: dict[str, Any] = {}
            for name in table.colnames:
                value = row[name]
                try:
                    value = value.item()
                except (AttributeError, ValueError):
                    pass
                if isinstance(value, bytes):
                    value = value.decode("utf-8", "replace")
                item[name.lower()] = value
            rows.append(item)
        return rows, query_status
    except Exception:
        namespace = "{http://www.ivoa.net/xml/VOTable/v1.3}"
        fields = [field.attrib.get("name", field.attrib.get("ID", "")).lower() for field in root.findall(f".//{namespace}FIELD")]
        rows: list[dict[str, Any]] = []
        for tr in root.findall(f".//{namespace}TABLEDATA/{namespace}TR"):
            cells = [td.text or "" for td in tr.findall(f"{namespace}TD")]
            rows.append(dict(zip(fields, cells)))
        return rows, query_status


def _normalize_result(row: dict[str, Any], release_key: str) -> dict[str, Any]:
    lower = {str(key).lower(): value for key, value in row.items()}
    access_url = _text(lower.get("access_url"))
    if not access_url:
        return {}
    start_mjd = _num(lower.get("t_min"))
    end_mjd = _num(lower.get("t_max"))
    em_min = _num(lower.get("em_min"))
    em_max = _num(lower.get("em_max"))
    product_id = _text(lower.get("obs_id") or lower.get("obs_publisher_did") or access_url.rsplit("/", 1)[-1])
    product_key = hashlib.sha256(access_url.encode("utf-8")).hexdigest()[:16]
    _url_by_id[product_key] = access_url
    _image_centers[product_key] = (_num(lower.get("s_ra")), _num(lower.get("s_dec")))
    if release_key == "dr1_cube":
        register_cube_product(product_key, access_url)
    if len(_url_by_id) > 2000:
        for old_key in list(_url_by_id)[:500]:
            _url_by_id.pop(old_key, None)
            _image_centers.pop(old_key, None)
    return {
        "id": product_key,
        "product_id": product_id,
        "collection": _text(lower.get("obs_collection")) or COLLECTIONS[release_key],
        "release": "DR1 All-Sky Cube" if release_key == "dr1_cube" else "QR3" if "qr3" in release_key else "DR1",
        "deep_field": "deep" in release_key,
        "ra": _num(lower.get("s_ra")),
        "dec": _num(lower.get("s_dec")),
        "start_mjd": start_mjd,
        "end_mjd": end_mjd,
        "observation_start": _format_date(start_mjd),
        "observation_end": _format_date(end_mjd),
        "wavelength_min_m": em_min,
        "wavelength_max_m": em_max,
        "wavelength_min_um": em_min * 1e6 if em_min is not None else None,
        "wavelength_max_um": em_max * 1e6 if em_max is not None else None,
        "exposure_seconds": _num(lower.get("t_exptime")),
        "calibration_level": int(_num(lower.get("calib_level")) or 0) or None,
        "resolution_arcsec": _num(lower.get("s_resolution")),
        "field_of_view_deg": _num(lower.get("s_fov")),
        "data_type": _text(lower.get("dataproduct_type")),
        "data_format": _text(lower.get("access_format")),
        "target": _text(lower.get("target_name")),
        "facility": _text(lower.get("facility_name")),
        "instrument": _text(lower.get("instrument_name")),
        "title": _text(lower.get("obs_title")),
        "preview_url": f"/api/preview/{product_key}",
        "original_url": access_url,
    }


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "archive": "NASA/IPAC IRSA",
        "archive_connectivity": "checked per query",
        "sia_endpoint": IRSA_SIA_URL,
        "releases": ["DR1", "DR1 Deep", "DR1 All-Sky Cube", "QR3", "QR3 Deep"],
    }


@app.get("/api/observations")
async def observations(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    radius: float = Query(0.1, gt=0, le=5),
    release: str = Query("qr3"),
    wavelength_min_um: float | None = Query(None, gt=0, le=5),
    wavelength_max_um: float | None = Query(None, gt=0, le=5),
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    release_key = release.lower()
    if release_key not in COLLECTIONS:
        raise HTTPException(400, "Choose DR1, DR1 Deep, DR1 All-Sky Cube, QR3, or QR3 Deep. QR2 is no longer returned by IRSA SIA searches; use DR1 for reprocessed QR2 observations.")
    if (wavelength_min_um is None) != (wavelength_max_um is None):
        raise HTTPException(400, "Provide both wavelength bounds or leave both empty.")
    if wavelength_min_um is not None and wavelength_min_um >= wavelength_max_um:
        raise HTTPException(400, "The minimum wavelength must be below the maximum.")
    params: list[tuple[str, str]] = [
        ("COLLECTION", COLLECTIONS[release_key]),
        ("POS", f"CIRCLE {ra:.8f} {dec:.8f} {radius:.6f}"),
        ("MAXREC", str(min(limit, IRSA_MAX_RECORDS))),
        ("RESPONSEFORMAT", "votable"),
    ]
    # The cube collection is already homogeneous; avoid adding image-format
    # predicates that the archive does not need for these FITS cube records.
    # Spectral-image collections remain explicitly constrained to image MEFs.
    if release_key != "dr1_cube":
        params.insert(2, ("DPTYPE", "image"))
        params.insert(3, ("FORMAT", "image/fits"))
    if wavelength_min_um is not None and wavelength_max_um is not None:
        params.append(("BAND", f"{wavelength_min_um * 1e-6:.12g} {wavelength_max_um * 1e-6:.12g}"))
    if start_date or end_date:
        try:
            start_mjd = Time(f"{start_date} 00:00:00", format="iso", scale="utc").mjd if start_date else -math.inf
            end_mjd = Time(f"{end_date} 23:59:59.999", format="iso", scale="utc").mjd if end_date else math.inf
        except Exception as exc:
            raise HTTPException(400, "Dates must use YYYY-MM-DD format.") from exc
        if start_mjd > end_mjd:
            raise HTTPException(400, "The start date must come before the end date.")
        params.append(("TIME", f"{start_mjd} {end_mjd}"))

    cache_key = "observations:" + hashlib.sha256(urlencode(params).encode("utf-8")).hexdigest()
    cached = _cache_get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    try:
        async with httpx.AsyncClient(timeout=IRSA_TIMEOUT_SECONDS, follow_redirects=True) as client:
            for attempt in range(2):
                try:
                    response = await client.get(IRSA_SIA_URL, params=params, headers={"User-Agent": "ASCENTRA/1.0 (public SPHEREx explorer)"})
                except httpx.TimeoutException:
                    if attempt == 1:
                        raise
                    await asyncio.sleep(0.5)
                    continue
                if response.status_code in {429, 502, 503, 504} and attempt < 1:
                    await asyncio.sleep(0.6)
                    continue
                response.raise_for_status()
                break
        if len(response.content) > 20_000_000:
            raise HTTPException(502, "IRSA returned an unexpectedly large metadata response.")
        raw_rows, query_status = await run_in_threadpool(_parse_votable_response, response.content)
        normalized = [_normalize_result(row, release_key) for row in raw_rows]
        results = [row for row in normalized if row.get("original_url")]
        results.sort(key=lambda row: (row.get("start_mjd") is None, row.get("start_mjd") or 0, row.get("product_id") or ""))
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        logger.warning("IRSA SIA2 query timed out", exc_info=True)
        raise HTTPException(504, "IRSA did not respond in time. Try a smaller region or retry shortly.") from exc
    except httpx.HTTPError as exc:
        logger.warning("IRSA SIA2 request failed", exc_info=True)
        raise HTTPException(502, "IRSA could not complete this archive query. Please retry shortly.") from exc
    except Exception as exc:
        logger.exception("Could not parse or normalize an IRSA SIA2 response")
        raise HTTPException(502, "IRSA returned metadata that could not be read safely.") from exc

    payload = {
        "query": {"ra": ra, "dec": dec, "radius_deg": radius, "collection": COLLECTIONS[release_key]},
        "count": len(results),
        "observations": results,
        "source": "NASA/IPAC IRSA Simple Image Access v2",
        "query_status": query_status,
        "truncated": query_status == "OVERFLOW",
        "cached": False,
        "message": (
            "IRSA reached the requested record limit; results are incomplete. Narrow the region or filters to inspect more products."
            if query_status == "OVERFLOW"
            else None if results
            else "No matching SPHEREx image products were returned for this region and filter."
        ),
    }
    _cache_put(cache_key, payload)
    return payload


async def _resolve_access_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(400, "The archive returned an invalid product URL.") from exc
    if (
        parsed.scheme != "https"
        or parsed.hostname not in IRSA_HOSTS
        or port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or not parsed.path.startswith("/ibe/data/spherex/")
    ):
        raise HTTPException(400, "Only SPHEREx image products hosted by IRSA can be previewed.")
    return url


async def _validate_irsa_redirect(response: httpx.Response) -> None:
    """Validate each redirect target before HTTPX follows it."""
    if response.is_redirect:
        location = response.headers.get("location")
        if not location:
            raise HTTPException(502, "IRSA returned a redirect without a destination.")
        await _resolve_access_url(urljoin(str(response.request.url), location))


@app.get("/api/preview/{product_id}")
async def preview(
    product_id: str,
    ra: float | None = Query(None),
    dec: float | None = Query(None),
    size: float = Query(0.12, gt=0.005, le=1),
    stretch: str = "asinh",
    contrast: float = 1.0,
    plane: int = Query(0, ge=0, le=4095),
    low_percentile: float = 1.0,
    high_percentile: float = 99.6,
):
    if stretch not in {"linear", "log", "sqrt", "asinh"}:
        raise HTTPException(422, "Stretch must be linear, log, sqrt, or asinh.")
    if not math.isfinite(contrast) or not 0.5 <= contrast <= 2.5:
        raise HTTPException(422, "Contrast must be between 0.5 and 2.5.")
    if not (math.isfinite(low_percentile) and math.isfinite(high_percentile) and 0 <= low_percentile < high_percentile <= 100):
        raise HTTPException(422, "Choose valid display percentiles with the low cut below the high cut.")
    access_url = _url_by_id.get(product_id)
    if not access_url:
        # Search-result IDs are generated deterministically; the URL must still come from SIA.
        raise HTTPException(404, "Run a fresh archive search before opening this preview.")
    await _resolve_access_url(access_url)
    parts = urlsplit(access_url)
    query = parse_qs(parts.query)
    centers: list[tuple[float, float] | None] = []
    if (ra is None) != (dec is None):
        raise HTTPException(400, "Provide both RA and Dec, or leave both coordinates empty.")
    if ra is not None and dec is not None:
        if not 0 <= ra < 360 or not -90 <= dec <= 90:
            raise HTTPException(400, "Coordinates are outside the valid ICRS range.")
        # An explicitly requested sky position must never silently fall back to a
        # different image center; that would make visual comparisons misleading.
        centers.append((ra, dec))
    else:
        product_center = _image_centers.get(product_id)
        if product_center and product_center[0] is not None and product_center[1] is not None:
            centers.append((product_center[0], product_center[1]))
        else:
            centers.append(None)

    try:
        async with httpx.AsyncClient(
            timeout=IRSA_TIMEOUT_SECONDS,
            follow_redirects=True,
            event_hooks={"response": [_validate_irsa_redirect]},
        ) as client:
            chunks: bytes | None = None
            used_center: tuple[float, float] | None = None
            invalid_cutout_position = False
            for center in centers:
                cutout_query = dict(query)
                if center:
                    cutout_query["center"] = [f"{center[0]:.8f},{center[1]:.8f}"]
                cutout_query["size"] = [f"{size:.5f}"]
                cutout_url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(cutout_query, doseq=True), ""))
                preview_hash = hashlib.sha256(f"{cutout_url}|{stretch}|{contrast:.3f}|{plane}|{low_percentile:.2f}|{high_percentile:.2f}".encode("utf-8")).hexdigest()
                cache_key = "preview:" + preview_hash
                cached = _cache_get(cache_key)
                if cached is not None:
                    return _preview_response(cached, cache_key)
                fits_cache_key = "fits:" + hashlib.sha256(cutout_url.encode("utf-8")).hexdigest()
                cached_fits = _cache_get(fits_cache_key)
                if cached_fits is not None:
                    chunks = cached_fits
                    used_center = center
                    break
                for attempt in range(3):
                    retry_status = 0
                    async with client.stream("GET", cutout_url, headers={"User-Agent": "ASCENTRA/1.0 (public SPHEREx explorer)"}) as response:
                        if response.status_code in {429, 502, 503, 504}:
                            retry_status = response.status_code
                            await response.aread()
                        elif response.status_code in {400, 422}:
                            body = (await response.aread()).decode("utf-8", "replace").lower()
                            invalid_cutout_position = True
                            if center != centers[-1] and ("position" in body or "center" in body or "nan" in body):
                                break
                            raise HTTPException(422, "IRSA could not make a cutout at that position. The original FITS product is still available.")
                        else:
                            response.raise_for_status()
                            final_url = str(response.url)
                            await _resolve_access_url(final_url.split("?", 1)[0])
                            result = bytearray()
                            async for chunk in response.aiter_bytes():
                                result.extend(chunk)
                                if len(result) > PREVIEW_MAX_BYTES:
                                    raise HTTPException(413, "This product is too large for an in-browser preview. Open the original data product instead.")
                            chunks = bytes(result)
                            _cache_put(fits_cache_key, chunks, ttl=3600)
                            used_center = center
                            break
                    if chunks is not None:
                        break
                    if retry_status:
                        if attempt < 2:
                            await asyncio.sleep(0.7 * (attempt + 1))
                            continue
                        raise HTTPException(503, "IRSA's cutout service is busy. Please retry shortly or open the original data product.")
                if chunks is not None:
                    break
            if chunks is None:
                if invalid_cutout_position:
                    raise HTTPException(422, "IRSA could not make a cutout around this image. The original FITS product is still available.")
                raise HTTPException(502, "IRSA did not return a cutout for this product.")
        png, metadata, wcs_header = await run_in_threadpool(_render_fits, bytes(chunks), stretch, contrast, plane, low_percentile, high_percentile)
        _cache_put(cache_key, png, ttl=3600)
        expires = time.monotonic() + 3600
        metadata["preview_id"] = preview_hash
        _preview_metadata[cache_key] = (expires, metadata)
        if wcs_header:
            _preview_wcs_headers[cache_key] = (expires, wcs_header)
        for store in (_preview_metadata, _preview_wcs_headers):
            for key in [key for key, (until, _) in store.items() if until <= time.monotonic()]:
                store.pop(key, None)
            while len(store) > 256:
                store.pop(next(iter(store)))
        return _preview_response(png, cache_key, used_center)

    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        logger.warning("IRSA cutout request timed out", exc_info=True)
        raise HTTPException(504, "The IRSA cutout service timed out. Open the source product or try again shortly.") from exc
    except httpx.HTTPError as exc:
        logger.warning("IRSA cutout request failed", exc_info=True)
        raise HTTPException(502, "IRSA could not provide this image cutout.") from exc
    except ValueError as exc:
        logger.warning("FITS preview could not be rendered: %s", exc)
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        logger.exception("Could not convert an IRSA FITS cutout to a preview")
        raise HTTPException(422, "The FITS cutout could not be converted into a preview. The original file remains available.") from exc


def _preview_response(png: bytes, cache_key: str, used_center: tuple[float, float] | None = None) -> Response:
    headers = {"Cache-Control": "public, max-age=3600"}
    entry = _preview_metadata.get(cache_key)
    if entry and entry[0] > time.monotonic():
        encoded = base64.urlsafe_b64encode(json.dumps(entry[1], separators=(",", ":"), allow_nan=False).encode("utf-8")).decode("ascii")
        headers["X-ASCENTRA-Preview-Metadata"] = encoded
    if used_center:
        headers["X-ASCENTRA-Cutout-Center"] = f"{used_center[0]:.8f},{used_center[1]:.8f}"
    return Response(content=png, media_type="image/png", headers=headers)


@app.get("/api/preview-world/{preview_id}")
async def preview_world_coordinate(
    preview_id: str,
    x: float = Query(..., ge=0),
    y: float = Query(..., ge=0),
):
    cache_key = f"preview:{preview_id}"
    metadata_entry = _preview_metadata.get(cache_key)
    wcs_entry = _preview_wcs_headers.get(cache_key)
    if metadata_entry is None or metadata_entry[0] <= time.monotonic() or wcs_entry is None or wcs_entry[0] <= time.monotonic():
        raise HTTPException(404, "Load this FITS preview before converting pixel coordinates.")
    metadata = metadata_entry[1]
    if x >= metadata["display_width"] or y >= metadata["display_height"]:
        raise HTTPException(422, "Pixel coordinates fall outside the displayed image.")
    try:
        wcs = WCS(fits.Header.fromstring(wcs_entry[1], sep="\n"))
        native_x = x * metadata["width"] / metadata["display_width"]
        native_y = y * metadata["height"] / metadata["display_height"]
        ra, dec = wcs.pixel_to_world_values(native_x, native_y)
        if not (math.isfinite(float(ra)) and math.isfinite(float(dec))):
            raise ValueError("WCS returned non-finite sky coordinates")
        return {"x": x, "y": y, "ra_deg": float(ra) % 360, "dec_deg": float(dec), "frame": metadata.get("coordinate_frame", "ICRS"), "classification": "WCS coordinate conversion", "preview_id": preview_id}
    except Exception as exc:
        raise HTTPException(422, "The FITS WCS could not convert this pixel position.") from exc


@app.get("/api/preview-grid/{preview_id}")
async def preview_coordinate_grid(preview_id: str, lines: int = Query(5, ge=3, le=9)):
    cache_key = f"preview:{preview_id}"
    metadata_entry = _preview_metadata.get(cache_key)
    wcs_entry = _preview_wcs_headers.get(cache_key)
    if metadata_entry is None or metadata_entry[0] <= time.monotonic() or wcs_entry is None or wcs_entry[0] <= time.monotonic():
        raise HTTPException(404, "Load a FITS preview with celestial WCS before displaying its grid.")
    metadata = metadata_entry[1]
    try:
        wcs = WCS(fits.Header.fromstring(wcs_entry[1], sep="\n"))
        width, height = metadata["width"], metadata["height"]
        display_width, display_height = metadata["display_width"], metadata["display_height"]
        corner_x = np.array([0, width - 1, width - 1, 0, (width - 1) / 2])
        corner_y = np.array([0, 0, height - 1, height - 1, (height - 1) / 2])
        corner_ra, corner_dec = wcs.pixel_to_world_values(corner_x, corner_y)
        center_ra = float(corner_ra[-1])
        delta_ra = (np.asarray(corner_ra, dtype=float) - center_ra + 180) % 360 - 180
        ra_values = np.linspace(float(np.nanmin(delta_ra)), float(np.nanmax(delta_ra)), lines + 2)[1:-1] + center_ra
        dec_values = np.linspace(float(np.nanmin(corner_dec)), float(np.nanmax(corner_dec)), lines + 2)[1:-1]
        paths = []
        samples = np.linspace(0, 1, 64)
        for ra_value in ra_values:
            ra_line = np.full(samples.shape, ra_value % 360)
            dec_line = float(np.nanmin(corner_dec)) + samples * float(np.nanmax(corner_dec) - np.nanmin(corner_dec))
            px, py = wcs.world_to_pixel_values(ra_line, dec_line)
            pts = [[float(xp * display_width / width), float(yp * display_height / height)] for xp, yp in zip(px, py) if np.isfinite(xp) and np.isfinite(yp) and -1 <= xp < width and -1 <= yp < height]
            if len(pts) > 1:
                paths.append({"axis": "ra", "value_deg": float(ra_value % 360), "points": pts})
        ra_min, ra_max = center_ra + float(np.nanmin(delta_ra)), center_ra + float(np.nanmax(delta_ra))
        ra_samples = ((ra_min + samples * (ra_max - ra_min)) % 360)
        for dec_value in dec_values:
            dec_line = np.full(samples.shape, dec_value)
            px, py = wcs.world_to_pixel_values(ra_samples, dec_line)
            pts = [[float(xp * display_width / width), float(yp * display_height / height)] for xp, yp in zip(px, py) if np.isfinite(xp) and np.isfinite(yp) and -1 <= xp < width and -1 <= yp < height]
            if len(pts) > 1:
                paths.append({"axis": "dec", "value_deg": float(dec_value), "points": pts})
        return {"preview_id": preview_id, "classification": "WCS coordinate grid", "width": display_width, "height": display_height, "paths": paths}
    except Exception as exc:
        raise HTTPException(422, "The FITS WCS could not generate a sky-coordinate grid.") from exc


def _fits_to_png(data: bytes) -> bytes:
    """Backward-compatible display preview helper using the default asinh stretch."""
    return _render_fits(data, "asinh", 1.0)[0]


def _render_fits(
    data: bytes,
    stretch: str = "asinh",
    contrast: float = 1.0,
    plane: int = 0,
    low_percentile: float = 1.0,
    high_percentile: float = 99.6,
) -> tuple[bytes, dict[str, Any], str | None]:
    if stretch not in {"linear", "log", "sqrt", "asinh"}:
        raise ValueError("Unsupported image stretch")
    if not math.isfinite(contrast) or not 0.5 <= contrast <= 2.5:
        raise ValueError("Contrast must be between 0.5 and 2.5")
    if not (math.isfinite(low_percentile) and math.isfinite(high_percentile) and 0 <= low_percentile < high_percentile <= 100):
        raise ValueError("Choose valid display percentiles with the low cut below the high cut")
    with fits.open(io.BytesIO(data), memmap=False, ignore_missing_simple=True) as hdus:
        image_hdus = []
        for hdu in hdus:
            if not isinstance(hdu, (fits.PrimaryHDU, fits.ImageHDU, fits.CompImageHDU)):
                continue
            header = hdu.header
            # Astropy exposes the logical image axes as NAXIS even for CompImageHDU.
            axes = int(header.get("NAXIS", 0))
            if axes < 2:
                continue
            axis_prefix = "NAXIS"
            plane_pixels = math.prod(int(header.get(f"{axis_prefix}{axis}", 0)) for axis in range(1, min(axes, 2) + 1))
            if plane_pixels > MAX_PREVIEW_PIXELS:
                raise ValueError(f"FITS image plane has {plane_pixels} pixels; the preview limit is {MAX_PREVIEW_PIXELS}")
            image_hdus.append(hdu)
        image_hdu = next((hdu for hdu in image_hdus if str(hdu.header.get("EXTNAME", "")).upper() in {"SCI", "SCIENCE", "IMAGE"}), None)
        if image_hdu is None:
            image_hdu = next((hdu for hdu in image_hdus if isinstance(hdu, fits.PrimaryHDU)), None)
        if image_hdu is None:
            image_hdu = next(iter(image_hdus), None)
        if image_hdu is None:
            raise ValueError("No image plane was found in this FITS product")
        raw_values = np.asarray(image_hdu.data)
        values = raw_values.astype(np.float32)
        blank_value = image_hdu.header.get("BLANK")
        if blank_value is not None and np.issubdtype(raw_values.dtype, np.integer):
            scaled_blank = float(blank_value) * float(image_hdu.header.get("BSCALE", 1)) + float(image_hdu.header.get("BZERO", 0))
            values[raw_values == scaled_blank] = np.nan
        original_shape = list(raw_values.shape)
        plane_count = original_shape[0] if len(original_shape) > 2 else 1
        if plane < 0 or plane >= plane_count:
            raise ValueError(f"FITS plane {plane + 1} is outside the available range of 1–{plane_count}.")
        if len(original_shape) == 2 and plane != 0:
            raise ValueError("This FITS image contains only one plane.")
        selected_plane_indices = []
        while values.ndim > 2:
            plane_index = plane if not selected_plane_indices else values.shape[0] // 2
            selected_plane_indices.append(plane_index)
            values = values[plane_index]
        values = np.squeeze(values)
        if values.ndim != 2:
            raise ValueError("The FITS image plane is not two-dimensional")
        finite = np.isfinite(values)
        if not finite.any():
            raise ValueError("The selected FITS image plane contains no finite pixels")
        finite_values = values[finite]
        low, high = np.percentile(finite_values, [low_percentile, high_percentile])
        if not np.isfinite(low) or not np.isfinite(high) or high <= low:
            high = low + max(abs(float(low)) * 1e-4, 1e-6)
        normalized = np.zeros(values.shape, dtype=np.float32)
        clipped = np.clip(values, low, high)
        normalized[finite] = (clipped[finite] - low) / (high - low)
        # Contrast and transfer functions alter only the display mapping; source values remain in FITS.
        normalized = np.clip((normalized - 0.5) * contrast + 0.5, 0, 1)
        if stretch == "linear":
            stretched = normalized
        elif stretch == "sqrt":
            stretched = np.sqrt(normalized)
        elif stretch == "log":
            stretched = np.log1p(normalized * 99.0) / np.log1p(99.0)
        else:
            stretched = np.arcsinh(normalized * 12.0) / np.arcsinh(12.0)
        grey = (np.clip(stretched, 0, 1) * 255).astype(np.uint8)
        # Restrained indigo-to-cyan display mapping; the UI labels this as a visual stretch.
        red = (grey.astype(np.float32) * 0.52).astype(np.uint8)
        green = np.clip(grey.astype(np.float32) * 0.78 + 8, 0, 255).astype(np.uint8)
        blue = np.clip(grey.astype(np.float32) * 1.1 + 20, 0, 255).astype(np.uint8)
        rgb = np.stack([red, green, blue], axis=-1)
        rgb[~finite] = (5, 8, 14)
        native_height, native_width = values.shape
        wcs_header = None
        wcs_metadata: dict[str, Any] = {"available": False}
        try:
            celestial_wcs = WCS(image_hdu.header, relax=True).celestial
            if celestial_wcs.has_celestial and celestial_wcs.pixel_n_dim == 2:
                scales = proj_plane_pixel_scales(celestial_wcs) * 3600
                center_ra, center_dec = celestial_wcs.pixel_to_world_values((native_width - 1) / 2, (native_height - 1) / 2)
                if math.isfinite(float(center_ra)) and math.isfinite(float(center_dec)) and np.all(np.isfinite(scales)):
                    wcs_header = celestial_wcs.to_header(relax=True).tostring(sep="\n", endcard=False, padding=False)
                    wcs_metadata = {
                        "available": True,
                        "ctype": [str(axis) for axis in celestial_wcs.wcs.ctype],
                        "cunit": [str(unit) for unit in celestial_wcs.wcs.cunit],
                        "center_ra_deg": float(center_ra) % 360,
                        "center_dec_deg": float(center_dec),
                        "pixel_scale_arcsec": [abs(float(scale)) for scale in scales],
                        "coordinate_frame": str(celestial_wcs.wcs.radesys or "ICRS"),
                    }
        except Exception:
            # Some valid display products do not carry a usable celestial WCS.
            pass
        background = float(np.nanmedian(finite_values))
        mad = float(np.nanmedian(np.abs(finite_values - background)))
        result = Image.fromarray(rgb, mode="RGB")
        result.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        result.save(output, format="PNG", optimize=True)
        metadata = {
            "width": native_width,
            "height": native_height,
            "display_width": result.width,
            "display_height": result.height,
            "hdu": str(image_hdu.header.get("EXTNAME", "PRIMARY")),
            "fits_shape": original_shape,
            "plane_count": plane_count,
            "selected_plane_indices": selected_plane_indices,
            "extensions": [
                {
                    "name": str(hdu.header.get("EXTNAME", "PRIMARY")),
                    "type": type(hdu).__name__,
                    "shape": [int(hdu.header.get(f"NAXIS{axis}", 0)) for axis in range(int(hdu.header.get("NAXIS", 0)), 0, -1)],
                    "bunit": str(hdu.header.get("BUNIT", "")) or None,
                }
                for hdu in hdus
            ],
            "bunit": str(image_hdu.header.get("BUNIT", "")) or None,
            "finite_pixel_count": int(finite.sum()),
            "invalid_pixel_count": int(finite.size - finite.sum()),
            "data_min": float(np.nanmin(finite_values)),
            "data_max": float(np.nanmax(finite_values)),
            "background_median": background,
            "background_mad": mad,
            "display_min_percentile": float(low_percentile),
            "display_max_percentile": float(high_percentile),
            "display_min": float(low),
            "display_max": float(high),
            "stretch": stretch,
            "contrast": float(contrast),
            "is_display_mapping": True,
            "wcs": wcs_metadata,
        }
        return output.getvalue(), metadata, wcs_header


@app.post("/api/comparison-readiness")
async def comparison_readiness(request: CompareRequest):
    await _resolve_access_url(request.earlier_url)
    await _resolve_access_url(request.later_url)
    issues: list[str] = []
    if request.earlier_url == request.later_url:
        issues.append("Both selections point to the same data product.")
    if request.earlier_collection != request.later_collection:
        issues.append("The data releases or collections differ; calibration compatibility has not been established.")
    if not request.earlier_band or request.earlier_band != request.later_band:
        issues.append("The wavelength coverage is not confirmed to match.")
    if not request.earlier_calibration or request.earlier_calibration != request.later_calibration:
        issues.append("Matching calibration-level metadata is missing or differs.")
    if request.earlier_mjd is None or request.later_mjd is None or request.earlier_mjd == request.later_mjd:
        issues.append("Distinct observation times could not be verified.")
    return {
        "side_by_side_available": True,
        "slider_available": True,
        "difference_map_available": False,
        "difference_map_reason": "No image registration, variance-weighted calibration, and PSF-matching product has been generated for this pair. A pixel subtraction would be misleading.",
        "metadata_compatible": len(issues) == 0,
        "scientific_difference_ready": False,
        "reasons": issues,
        "source": "ASCENTRA conservative metadata gate",
    }


_name_re = re.compile(r"^[\w .+'()\-]{1,120}$", re.UNICODE)


@app.get("/api/resolve")
async def resolve_name(name: str = Query(..., min_length=1, max_length=120)):
    query = name.strip()
    if not _name_re.fullmatch(query):
        raise HTTPException(400, "Use a celestial name or a coordinate pair.")
    # CDS reports intermittent outages on its Strasbourg network; use its current IDIA mirror.
    url = "https://vizier.idia.ac.za/viz-bin/nph-sesame/-oxp?" + quote(query, safe="")
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            response = await client.get(url, headers={"User-Agent": "ASCENTRA/1.0 public astronomy explorer"})
            response.raise_for_status()
        root = ET.fromstring(response.content)
        ra_text = root.findtext("./Target/Resolver/jradeg")
        dec_text = root.findtext("./Target/Resolver/jdedeg")
        ra, dec = _num(ra_text), _num(dec_text)
        if ra is None or dec is None:
            raise HTTPException(404, "No coordinate match was returned for that name.")
        return {"name": query, "ra": ra, "dec": dec, "resolver": "CDS Sesame name resolver"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("CDS Sesame name resolution failed")
        raise HTTPException(502, "The name resolver is unavailable. Enter Right Ascension and Declination directly.") from exc

