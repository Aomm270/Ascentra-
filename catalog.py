"""Conservative positional cross-matches against public IRSA catalogues."""

from __future__ import annotations

import asyncio
import hashlib
import io
import math
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.table import Table
from astropy import units as u
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/catalog", tags=["Catalogue Cross-Match"])

GATOR_URL = "https://irsa.ipac.caltech.edu/cgi-bin/Gator/nph-query"
IRSA_HOST = "irsa.ipac.caltech.edu"
MAX_RESPONSE_BYTES = 2_000_000
CATALOGUES = {
    "2MASS PSC": {
        "name": "fp_psc",
        "columns": "designation,ra,dec,j_m,h_m,k_m",
        "fields": ("designation", "ra", "dec", "j_m", "h_m", "k_m"),
        "url": "https://irsa.ipac.caltech.edu/irsaviewer/",
    },
    "AllWISE": {
        "name": "allwise_p3as_psd",
        "columns": "designation,ra,dec,w1mpro,w1sigmpro,w2mpro,w2sigmpro",
        "fields": ("designation", "ra", "dec", "w1mpro", "w1sigmpro", "w2mpro", "w2sigmpro"),
        "url": "https://irsa.ipac.caltech.edu/irsaviewer/",
    },
    "Gaia DR3": {
        "name": "gaia_dr3_source",
        "columns": "source_id,ra,dec,phot_g_mean_mag,parallax,pmra,pmdec,ra_error,dec_error",
        "fields": ("source_id", "ra", "dec", "phot_g_mean_mag", "parallax", "pmra", "pmdec", "ra_error", "dec_error"),
        "url": "https://irsa.ipac.caltech.edu/irsaviewer/",
    },
}
_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()


def _as_json_scalar(value: Any) -> Any:
    if value is None or np.ma.is_masked(value):
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace").strip() or None
    if isinstance(value, (str, np.str_)):
        return str(value).strip() or None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        try:
            return int(value)
        except (TypeError, ValueError, OverflowError):
            return str(value)


def _parse_ipac_table(payload: bytes, requested_ra: float, requested_dec: float, radius_arcsec: float, label: str) -> dict[str, Any]:
    try:
        table = Table.read(io.BytesIO(payload), format="ascii.ipac")
    except Exception as exc:
        raise ValueError("IRSA returned a catalogue response that could not be parsed.") from exc
    catalog = CATALOGUES[label]
    if not {"ra", "dec"}.issubset({str(name).lower() for name in table.colnames}):
        raise ValueError("IRSA catalogue response did not include source coordinates.")
    names = {str(name).lower(): str(name) for name in table.colnames}
    target = SkyCoord(ra=requested_ra * u.deg, dec=requested_dec * u.deg, frame="icrs")
    matches = []
    for row in table:
        try:
            ra = float(row[names["ra"]])
            dec = float(row[names["dec"]])
            if not (math.isfinite(ra) and math.isfinite(dec) and 0 <= ra < 360 and -90 <= dec <= 90):
                continue
            separation_arcsec = float(target.separation(SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")).arcsec)
            if separation_arcsec > radius_arcsec:
                continue
            fields = {field.lower() for field in catalog["fields"]}
            record = {
                key: (str(row[names[key]]).strip() if key == "source_id" else _as_json_scalar(row[names[key]]))
                for key in fields if key in names and key not in {"ra", "dec"}
            }
            record.update({"ra_deg": ra, "dec_deg": dec, "separation_arcsec": separation_arcsec})
            matches.append(record)
        except (TypeError, ValueError, KeyError):
            continue
    matches.sort(key=lambda item: item["separation_arcsec"])
    return {"catalogue": catalog["name"], "status": "matched" if matches else "no match within radius", "returned_rows": len(table), "truncated": len(table) >= 100, "matches": matches[:5]}


def _cached(key: str) -> dict[str, Any] | None:
    entry = _cache.get(key)
    if not entry:
        return None
    expires, payload = entry
    if expires <= time.monotonic():
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return payload


def _put_cache(key: str, payload: dict[str, Any]) -> None:
    _cache[key] = (time.monotonic() + 1800, payload)
    _cache.move_to_end(key)
    while len(_cache) > 256:
        _cache.popitem(last=False)


async def _query_catalogue(client: httpx.AsyncClient, label: str, ra: float, dec: float, radius_arcsec: float) -> dict[str, Any]:
    catalog = CATALOGUES[label]
    params = {
        "outfmt": "1",
        "catalog": catalog["name"],
        "objstr": f"{ra:.8f} {dec:.8f}",
        "spatial": "Cone",
        "radius": f"{radius_arcsec:.4f}",
        "selcols": catalog["columns"],
        "maxrec": "100",
    }
    query_url = GATOR_URL + "?" + httpx.QueryParams(params).__str__()
    current_url = GATOR_URL
    for attempt in range(3):
        try:
            for redirect_count in range(3):
                async with client.stream("GET", current_url, params=params if redirect_count == 0 else None) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        destination = urlsplit(urljoin(str(response.request.url), location or ""))
                        if destination.scheme != "https" or destination.hostname != IRSA_HOST or not destination.path.startswith("/cgi-bin/Gator/"):
                            raise ValueError("IRSA returned an untrusted catalogue redirect.")
                        current_url = str(destination)
                        continue
                    if response.status_code in {429, 502, 503, 504}:
                        raise httpx.HTTPStatusError("Temporary IRSA catalogue response", request=response.request, response=response)
                    response.raise_for_status()
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > MAX_RESPONSE_BYTES:
                            raise ValueError("The catalogue response exceeded the safe size limit.")
                    parsed = await asyncio.to_thread(_parse_ipac_table, bytes(data), ra, dec, radius_arcsec, label)
                    return {**parsed, "query_url": query_url}
            raise ValueError("IRSA redirected the catalogue query too many times.")
        except httpx.TimeoutException:
            if attempt == 2:
                raise
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in {429, 502, 503, 504} or attempt == 2:
                raise
        if attempt < 2:
            await asyncio.sleep(0.4 * (attempt + 1))
    raise httpx.TimeoutException("IRSA catalogue request timed out")


@router.get("/matches")
async def catalogue_matches(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    radius_arcsec: float = Query(5, ge=0.2, le=60),
):
    key = hashlib.sha256(f"{ra:.7f}:{dec:.7f}:{radius_arcsec:.2f}".encode()).hexdigest()
    cached = _cached(key)
    if cached is not None:
        return {**cached, "cached": True}

    timeout = httpx.Timeout(connect=6, read=15, write=6, pool=6)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        results = await asyncio.gather(
            *(_query_catalogue(client, label, ra, dec, radius_arcsec) for label in CATALOGUES),
            return_exceptions=True,
        )
    catalogues = []
    for label, result in zip(CATALOGUES, results):
        if isinstance(result, BaseException):
            catalogues.append({
                "catalogue": CATALOGUES[label]["name"],
                "label": label,
                "status": "temporarily unavailable",
                "matches": [],
                "message": "This catalogue could not be queried right now.",
            })
        else:
            catalogues.append({**result, "label": label})
    if all(item["status"] == "temporarily unavailable" for item in catalogues):
        raise HTTPException(502, "IRSA catalogues are temporarily unavailable. Retry the positional match shortly.")
    payload = {
        "target": {"ra_deg": ra, "dec_deg": dec, "coordinate_frame": "ICRS"},
        "search_radius_arcsec": radius_arcsec,
        "source": "NASA/IPAC IRSA Gator catalogues",
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "classification": "provisional positional catalogue cross-match",
        "ranking_method": "angular separation only; no identification probability is calculated",
        "catalogues": catalogues,
        "limitations": [
            "A positional match does not confirm that a catalogue entry is the same astrophysical source.",
            "Brightnesses and astrometry come from different surveys, epochs, filters, and calibration systems; they are not combined into a single score.",
            "Proper motion, source blending, SPHEREx image resolution, and coordinate uncertainty require separate validation.",
            "No spectral match is calculated by this endpoint.",
        ],
        "cached": False,
    }
    _put_cache(key, payload)
    return payload
