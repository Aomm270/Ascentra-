"""Provenance-preserving public data services for the ED138 research module."""

from __future__ import annotations

import asyncio
import csv
import io
import math
import re
import time
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

SBDB_URL = "https://ssd-api.jpl.nasa.gov/sbdb.api"
HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
PAPER_URL = "https://arxiv.org/html/2610.38693"
PAPER_ABS_URL = "https://arxiv.org/abs/2610.38693"
TESS_PAPER_URL = "https://arxiv.org/html/2610.40106"
TESS_PAPER_ABS_URL = "https://arxiv.org/abs/2610.40106"
TNO_TIMEOUT_SECONDS = 25.0
MAX_PAPER_BYTES = 2_000_000

router = APIRouter(prefix="/api/tno", tags=["TNO Intelligence Lab"])
_response_cache: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str):
    entry = _response_cache.get(key)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    _response_cache.pop(key, None)
    return None


def _cache_put(key: str, value: Any, ttl: int = 1800):
    if len(_response_cache) > 32:
        for expired in [name for name, (until, _) in _response_cache.items() if until <= time.monotonic()]:
            _response_cache.pop(expired, None)
        while len(_response_cache) >= 32:
            _response_cache.pop(next(iter(_response_cache)))
    _response_cache[key] = (time.monotonic() + ttl, value)


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def _iso_utc(value: str) -> str | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except ValueError:
        return None


def _iso_horizons_time(value: str) -> str | None:
    direct = _iso_utc(value)
    if direct is not None:
        return direct
    for format_string in ("%Y-%b-%d %H:%M:%S.%f", "%Y-%b-%d %H:%M:%S", "%Y-%b-%d %H:%M"):
        try:
            parsed = datetime.strptime(value.strip(), format_string).replace(tzinfo=timezone.utc)
            return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except ValueError:
            continue
    return None


class _AstrometryTableParser(HTMLParser):
    """Extract only the published Table 11 astrometry/photometry rows."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.caption = ""
        self.in_table = False
        self.in_cell = False
        self.current_row: list[str] | None = None
        self.current_cell: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs):
        if tag == "figcaption":
            self.caption = ""
        elif tag == "table" and "Table 11:" in self.caption:
            self.in_table = True
        elif self.in_table and tag == "tr":
            self.current_row = []
        elif self.in_table and tag in {"td", "th"} and self.current_row is not None:
            self.in_cell = True
            self.current_cell = []

    def handle_data(self, data: str):
        if self.in_table and self.in_cell:
            self.current_cell.append(data)
        elif not self.in_table and data.strip():
            self.caption += data

    def handle_endtag(self, tag: str):
        if self.in_table and tag in {"td", "th"} and self.in_cell and self.current_row is not None:
            value = " ".join(" ".join(self.current_cell).split())
            self.current_row.append(value)
            self.in_cell = False
            self.current_cell = []
        elif self.in_table and tag == "tr" and self.current_row is not None:
            self.rows.append(self.current_row)
            self.current_row = None
        elif self.in_table and tag == "table":
            self.in_table = False


def parse_published_observations(html: str, retrieved_at: str) -> list[dict[str, Any]]:
    parser = _AstrometryTableParser()
    parser.feed(html)
    observations = []
    for row in parser.rows:
        if len(row) < 10:
            continue
        timestamp = _iso_utc(row[0])
        ra, dec = _number(row[1]), _number(row[2])
        if timestamp is None or ra is None or dec is None:
            continue
        origin = row[9]
        observations.append({
            "observed_at": timestamp,
            "ra_deg": ra,
            "dec_deg": dec,
            "sigma_ra_arcsec": _number(row[3]),
            "sigma_dec_arcsec": _number(row[4]),
            "magnitude": _number(row[5]),
            "magnitude_sigma": _number(row[6]),
            "filter": row[7] or None,
            "measurement_source": row[8] or None,
            "origin_code": origin or None,
            "observatory_code": "W84" if origin == "D" else "X05" if origin in {"P", "C", "R"} else None,
            "provenance": {
                "kind": "published catalogue measurement",
                "source": PAPER_ABS_URL,
                "retrieved_at": retrieved_at,
            },
            "ephemeris": None,
            "residual_arcsec": None,
        })
    observations.sort(key=lambda item: item["observed_at"])
    return observations


class _PaperTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str):
        if data.strip():
            self.parts.append(data.strip())


def parse_tess_sector_photometry(html: str, retrieved_at: str) -> list[dict[str, Any]]:
    parser = _PaperTextParser()
    parser.feed(html)
    text = " ".join(parser.parts)
    brightness_index = text.find("TESS magnitudes are")
    detection_index = text.find("is detected at")
    if brightness_index < 0 or detection_index < 0:
        raise ValueError("The published TESS sector results could not be located")
    brightness_text = text[brightness_index:brightness_index + 1000]
    detection_text = text[detection_index:detection_index + 500]
    magnitudes = re.findall(r"(\d+\.\d+)\\pm\s*(\d+\.\d+)", brightness_text)
    significance = re.search(r"is detected at\s+([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s+and\s+([\d.]+)", detection_text)
    if len(magnitudes) < 5 or significance is None:
        raise ValueError("The published TESS photometry format was not recognized")
    sectors = [12, 39, 66, 93, 104]
    values = []
    for sector, (magnitude, sigma), snr in zip(sectors, magnitudes[:5], significance.groups()):
        values.append({
            "sector": sector,
            "magnitude": float(magnitude),
            "magnitude_sigma": float(sigma),
            "detection_significance_sigma": float(snr),
            "epoch_label": f"TESS Sector {sector}",
            "provenance": {
                "kind": "published catalogue measurement",
                "source": TESS_PAPER_ABS_URL,
                "retrieved_at": retrieved_at,
            },
        })
    return values


async def fetch_published_tess_photometry() -> tuple[list[dict[str, Any]], str]:
    async with httpx.AsyncClient(timeout=TNO_TIMEOUT_SECONDS, follow_redirects=True) as client:
        response = await client.get(TESS_PAPER_URL, headers={"User-Agent": "ASCENTRA TNO Lab/1.0 (public research interface)"})
    response.raise_for_status()
    if len(response.content) > MAX_PAPER_BYTES:
        raise ValueError("The ED138 TESS literature source exceeded the allowed response size")
    retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return parse_tess_sector_photometry(response.text, retrieved_at), retrieved_at


def angular_separation_arcsec(ra1_deg: float, dec1_deg: float, ra2_deg: float, dec2_deg: float) -> float:
    """Great-circle separation, stable at small angles and across RA=0."""
    ra1, dec1, ra2, dec2 = map(math.radians, (ra1_deg, dec1_deg, ra2_deg, dec2_deg))
    delta_ra, delta_dec = ra2 - ra1, dec2 - dec1
    hav = math.sin(delta_dec / 2) ** 2 + math.cos(dec1) * math.cos(dec2) * math.sin(delta_ra / 2) ** 2
    return math.degrees(2 * math.asin(math.sqrt(min(1.0, max(0.0, hav))))) * 3600


def _sexagesimal_ra(value: str) -> float | None:
    try:
        hour, minute, second = (float(part) for part in value.strip().split())
        return ((hour + minute / 60 + second / 3600) * 15) % 360
    except (ValueError, TypeError):
        return None


def _sexagesimal_dec(value: str) -> float | None:
    try:
        sign = -1 if value.strip().startswith("-") else 1
        degree, minute, second = (float(part) for part in value.strip().replace("+", "").replace("-", "").split())
        return sign * (degree + minute / 60 + second / 3600)
    except (ValueError, TypeError):
        return None


def parse_horizons_csv(result: str, *, full_ephemeris: bool = False) -> list[dict[str, Any]]:
    """Parse Horizons observer rows between its explicit table markers."""
    if "$$SOE" not in result or "$$EOE" not in result:
        raise ValueError("Horizons returned no ephemeris table")
    body = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows = []
    for record in csv.reader(io.StringIO(body), skipinitialspace=True):
        if len(record) < 5:
            continue
        observed_at = _iso_horizons_time(record[0].strip())
        ra = _sexagesimal_ra(record[3])
        dec = _sexagesimal_dec(record[4])
        if observed_at is None or ra is None or dec is None:
            continue
        item: dict[str, Any] = {"observed_at": observed_at, "ra_deg": ra, "dec_deg": dec}
        if full_ephemeris:
            # QUANTITIES=1,3,9,19,20: RA/Dec, their rates, APmag/S-brt,
            # heliocentric range/rate, and observer range/rate, in that order.
            item.update({
                "ra_rate_arcsec_hour": _number(record[5]) if len(record) > 5 else None,
                "dec_rate_arcsec_hour": _number(record[6]) if len(record) > 6 else None,
                "apparent_magnitude": _number(record[7]) if len(record) > 7 else None,
                "heliocentric_distance_au": _number(record[9]) if len(record) > 9 else None,
                "observer_distance_au": _number(record[11]) if len(record) > 11 else None,
            })
        rows.append(item)
    return rows


async def _get_json(url: str, params: dict[str, str]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=TNO_TIMEOUT_SECONDS, follow_redirects=True) as client:
        response = await client.get(url, params=params, headers={"User-Agent": "ASCENTRA TNO Lab/1.0 (public research interface)"})
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise ValueError(payload["error"])
    return payload


def _normalize_sbdb(payload: dict[str, Any], retrieved_at: str) -> dict[str, Any]:
    orbit = payload.get("orbit") or {}
    values = {item.get("name"): item for item in orbit.get("elements", [])}
    physical = {item.get("name"): item for item in payload.get("phys_par", [])}

    def element(name: str):
        item = values.get(name) or {}
        return {
            "value": _number(item.get("value")),
            "uncertainty_1sigma": _number(item.get("sigma")),
            "units": item.get("units"),
            "label": item.get("title") or item.get("label") or name,
        }

    H = physical.get("H") or {}
    elements = {name: element(name) for name in ("a", "e", "q", "ad", "i", "om", "w", "ma", "tp", "per", "n")}
    return {
        "designation": payload.get("object", {}).get("des") or "2026 ED138",
        "full_designation": payload.get("object", {}).get("fullname"),
        "object_class": (payload.get("object", {}).get("orbit_class") or {}).get("name"),
        "spkid": payload.get("object", {}).get("spkid"),
        "orbit_solution_id": orbit.get("orbit_id"),
        "orbit_solution_date": orbit.get("soln_date"),
        "orbit_epoch_jd_tdb": _number(orbit.get("epoch")),
        "orbit_epoch": orbit.get("epoch_cd"),
        "source": orbit.get("source"),
        "producer": orbit.get("producer"),
        "observation_arc_days": _number(orbit.get("data_arc")),
        "first_observation_date": orbit.get("first_obs"),
        "last_observation_date": orbit.get("last_obs"),
        "observations_used": int(orbit["n_obs_used"]) if str(orbit.get("n_obs_used", "")).isdigit() else None,
        "orbit_fit_rms_arcsec": _number(orbit.get("rms")),
        "condition_code": orbit.get("condition_code"),
        "elements": elements,
        "absolute_magnitude_H": {
            "value": _number(H.get("value")),
            "uncertainty_1sigma": _number(H.get("sigma")),
            "units": "mag",
            "reference": H.get("ref"),
        },
        "covariance": orbit.get("covariance"),
        "provenance": {
            "kind": "published catalogue measurement",
            "source": "https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=2026%20ED138&phys-par=true&cov=mat&full-prec=true",
            "retrieved_at": retrieved_at,
            "citation": "NASA/JPL Small-Body Database API",
        },
    }


async def fetch_sbdb() -> dict[str, Any]:
    payload = await _get_json(SBDB_URL, {"sstr": "2026 ED138", "phys-par": "true", "cov": "mat", "full-prec": "true", "cd-epoch": "true"})
    return _normalize_sbdb(payload, datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"))


async def fetch_published_observations() -> tuple[list[dict[str, Any]], str]:
    async with httpx.AsyncClient(timeout=TNO_TIMEOUT_SECONDS, follow_redirects=True) as client:
        response = await client.get(PAPER_URL, headers={"User-Agent": "ASCENTRA TNO Lab/1.0 (public research interface)"})
    response.raise_for_status()
    if len(response.content) > MAX_PAPER_BYTES:
        raise ValueError("The ED138 literature source exceeded the allowed response size")
    retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    rows = parse_published_observations(response.text, retrieved_at)
    if not rows:
        raise ValueError("The published ED138 astrometry table could not be parsed")
    return rows, retrieved_at


async def _horizons_positions(observations: list[dict[str, Any]], site: str) -> list[dict[str, Any]]:
    times = [datetime.fromisoformat(item["observed_at"].replace("Z", "+00:00")).strftime("%Y-%b-%d %H:%M:%S.%f").rstrip("0").rstrip(".") for item in observations]
    params = {
        "format": "json",
        "COMMAND": "'2026 ED138'",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": site,
        "TLIST": " ".join(f"'{value}'" for value in times),
        "TLIST_TYPE": "CAL",
        "TIME_TYPE": "UT",
        "QUANTITIES": "'1'",
        "CSV_FORMAT": "YES",
        "EXTRA_PREC": "YES",
    }
    payload = await _get_json(HORIZONS_URL, params)
    return parse_horizons_csv(payload.get("result", ""))


@router.get("/ed138")
async def ed138_orbit(refresh: bool = Query(False)):
    cached = None if refresh else _cache_get("ed138:orbit")
    if cached is not None:
        return {**cached, "cached": True}
    try:
        orbit = await fetch_sbdb()
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(502, "JPL Small-Body Database is unavailable or returned an unreadable orbit. Retry shortly.") from exc
    payload = {"object": orbit, "cached": False}
    _cache_put("ed138:orbit", payload, ttl=3600)
    return payload


@router.get("/ed138/observations")
async def ed138_observations(validate_ephemeris: bool = Query(True), refresh: bool = Query(False)):
    cache_key = f"ed138:observations:{validate_ephemeris}"
    cached = None if refresh else _cache_get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}
    try:
        observations, retrieved_at = await fetch_published_observations()
    except httpx.HTTPError as exc:
        raise HTTPException(502, "The published ED138 observation table is temporarily unavailable.") from exc
    except ValueError as exc:
        raise HTTPException(502, str(exc)) from exc

    try:
        tess_sector_photometry, tess_retrieved_at = await fetch_published_tess_photometry()
        tess_source_status = "available"
    except (httpx.HTTPError, ValueError):
        tess_sector_photometry, tess_retrieved_at = [], None
        tess_source_status = "unavailable"

    validation = {"status": "not requested", "source": None, "retrieved_at": None, "matched": 0, "message": None}
    if validate_ephemeris:
        groups: dict[str, list[int]] = {"X05": [], "W84": []}
        for index, item in enumerate(observations):
            site = item.get("observatory_code")
            if site in groups:
                groups[site].append(index)
        try:
            tasks = [_horizons_positions([observations[index] for index in indices], site) for site, indices in groups.items() if indices]
            results = await asyncio.gather(*tasks)
            result_iter = iter(results)
            matched = 0
            for site, indices in groups.items():
                if not indices:
                    continue
                predictions = next(result_iter)
                if len(predictions) != len(indices):
                    raise ValueError("Horizons returned a different number of positions than requested")
                for index, prediction in zip(indices, predictions):
                    item = observations[index]
                    item["ephemeris"] = {
                        "ra_deg": prediction["ra_deg"],
                        "dec_deg": prediction["dec_deg"],
                        "source": "JPL Horizons observer ephemeris",
                        "center": site,
                    }
                    item["residual_arcsec"] = angular_separation_arcsec(
                        item["ra_deg"], item["dec_deg"], prediction["ra_deg"], prediction["dec_deg"]
                    )
                    matched += 1
            validation = {
                "status": "complete",
                "source": "https://ssd.jpl.nasa.gov/api/horizons.api",
                "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "matched": matched,
                "message": "Residuals compare published astrometry to geocentric-at-observatory-site JPL positions at the listed UTC midpoint. They do not refit the published orbit.",
            }
        except (httpx.HTTPError, ValueError) as exc:
            validation = {
                "status": "unavailable",
                "source": "https://ssd.jpl.nasa.gov/api/horizons.api",
                "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "matched": 0,
                "message": "JPL Horizons validation could not be completed. The published measurements remain available; retry validation later.",
            }

    motion_samples = []
    for previous, current in zip(observations, observations[1:]):
        previous_time = datetime.fromisoformat(previous["observed_at"].replace("Z", "+00:00"))
        current_time = datetime.fromisoformat(current["observed_at"].replace("Z", "+00:00"))
        minutes = (current_time - previous_time).total_seconds() / 60
        if 0.5 <= minutes <= 60:
            motion_samples.append({
                "observed_at": current["observed_at"],
                "interval_minutes": minutes,
                "angular_displacement_arcsec": angular_separation_arcsec(
                    previous["ra_deg"], previous["dec_deg"], current["ra_deg"], current["dec_deg"]
                ),
                "angular_rate_arcsec_min": angular_separation_arcsec(
                    previous["ra_deg"], previous["dec_deg"], current["ra_deg"], current["dec_deg"]
                ) / minutes,
                "from": previous["observed_at"],
                "to": current["observed_at"],
                "provenance": "calculated from adjacent published positions using great-circle angular separation",
            })

    payload = {
        "designation": "2026 ED138",
        "count": len(observations),
        "observations": observations,
        "tess_sector_photometry": tess_sector_photometry,
        "tess_source_status": tess_source_status,
        "tess_source": TESS_PAPER_ABS_URL,
        "tess_retrieved_at": tess_retrieved_at,
        "motion_samples": motion_samples,
        "benchmark_rate_arcsec_min": 0.043,
        "validation": validation,
        "source": PAPER_ABS_URL,
        "retrieved_at": retrieved_at,
        "cached": False,
        "notice": "Published astrometry and filter-dependent photometry from the literature. Rubin source images are restricted to data-rights holders; these rows are measurements, not images served by this module.",
    }
    _cache_put(cache_key, payload, ttl=3600)
    return payload


@router.get("/ed138/ephemeris")
async def ed138_ephemeris(
    start_date: date = Query(default_factory=date.today),
    days: int = Query(30, ge=2, le=366),
    step_days: int = Query(1, ge=1, le=31),
    refresh: bool = Query(False),
):
    end_date = date.fromordinal(start_date.toordinal() + days - 1)
    cache_key = f"ed138:ephemeris:{start_date.isoformat()}:{days}:{step_days}"
    cached = None if refresh else _cache_get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}
    params = {
        "format": "json",
        "COMMAND": "'2026 ED138'",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "500@399",
        "START_TIME": start_date.isoformat(),
        "STOP_TIME": end_date.isoformat(),
        "STEP_SIZE": f"{step_days} d",
        "TIME_TYPE": "UT",
        "QUANTITIES": "'1,3,9,19,20'",
        "CSV_FORMAT": "YES",
        "EXTRA_PREC": "YES",
    }
    try:
        response = await _get_json(HORIZONS_URL, params)
        ephemeris = parse_horizons_csv(response.get("result", ""), full_ephemeris=True)
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "JPL Horizons could not compute this ED138 ephemeris. Check the date range and retry.") from exc
    if not ephemeris:
        raise HTTPException(502, "JPL Horizons returned no ED138 positions for this date range.")
    for previous, current in zip(ephemeris, ephemeris[1:]):
        a = datetime.fromisoformat(previous["observed_at"].replace("Z", "+00:00"))
        b = datetime.fromisoformat(current["observed_at"].replace("Z", "+00:00"))
        hours = (b - a).total_seconds() / 3600
        current["angular_rate_arcsec_hour"] = angular_separation_arcsec(
            previous["ra_deg"], previous["dec_deg"], current["ra_deg"], current["dec_deg"]
        ) / hours if hours > 0 else None
    if ephemeris:
        ephemeris[0]["angular_rate_arcsec_hour"] = ephemeris[1].get("angular_rate_arcsec_hour") if len(ephemeris) > 1 else None
    payload = {
        "designation": "2026 ED138",
        "observer": "Geocenter (JPL Horizons CENTER=500@399)",
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "step_days": step_days,
        "count": len(ephemeris),
        "positions": ephemeris,
        "classification": "ephemeris prediction",
        "source": HORIZONS_URL,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "cached": False,
    }
    _cache_put(cache_key, payload, ttl=1800)
    return payload
