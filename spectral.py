"""Selective, provenance-preserving access to SPHEREx DR1 All-Sky Cube pixels.

The All-Sky Cube FITS tiles are hundreds of megabytes.  This service reads only
FITS headers, the small spectral-channel table, and selected pixel values using
HTTP byte ranges; it never downloads an entire tile to measure one sky position.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
import time
from collections import OrderedDict
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from typing import Any
from urllib.parse import urlsplit

import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
from astropy import units as u
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/spectral", tags=["Spectral Intelligence"])

IRSA_HOST = "irsa.ipac.caltech.edu"
IRSA_CUBE_PATH = re.compile(r"^/ibe/data/spherex/dr1/hips5_cube/hips_[0-9]+/Norder5/Dir[0-9]+/Npix[0-9]+_cube\.fits$")
MAX_HEADER_BYTES = 65_536
MAX_SMALL_HDU_BYTES = 2_000_000
MAX_RANGE_RESPONSE_BYTES = 1_000_000
MAX_CUBE_BYTES = 1_000_000_000
RANGE_GROUP_SIZE = 16
_cube_urls: OrderedDict[str, str] = OrderedDict()
_profile_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()


def register_cube_product(product_id: str, access_url: str) -> None:
    """Remember only SIA-returned DR1 cube URLs for this process."""
    parts = urlsplit(access_url)
    if parts.scheme != "https" or parts.hostname != IRSA_HOST or parts.port not in (None, 443) or not IRSA_CUBE_PATH.fullmatch(parts.path):
        return
    _cube_urls[product_id] = access_url
    _cube_urls.move_to_end(product_id)
    while len(_cube_urls) > 2000:
        _cube_urls.popitem(last=False)


def _parse_header(raw: bytes) -> tuple[fits.Header, int]:
    for offset in range(0, len(raw) - 79, 80):
        if raw[offset : offset + 8] == b"END     ":
            header_size = math.ceil((offset + 80) / 2880) * 2880
            if len(raw) < header_size:
                break
            try:
                return fits.Header.fromstring(raw[:header_size]), header_size
            except Exception as exc:
                raise HTTPException(502, "IRSA returned an unreadable FITS header.") from exc
    raise HTTPException(502, "IRSA returned an incomplete FITS header for the selected cube.")


def _hdu_data_size(header: fits.Header) -> int:
    naxis = int(header.get("NAXIS", 0))
    if naxis <= 0:
        return 0
    if str(header.get("XTENSION", "")).strip().upper() == "BINTABLE":
        group_bytes = int(header.get("NAXIS1", 0)) * int(header.get("NAXIS2", 0)) + int(header.get("PCOUNT", 0))
    else:
        bitpix = abs(int(header.get("BITPIX", 8)))
        group_bytes = (bitpix // 8) * math.prod(int(header.get(f"NAXIS{axis}", 0)) for axis in range(1, naxis + 1))
        group_bytes += int(header.get("PCOUNT", 0))
    return group_bytes * max(1, int(header.get("GCOUNT", 1)))


async def _read_ranges_once(client: httpx.AsyncClient, url: str, ranges: list[tuple[int, int]]) -> tuple[dict[int, bytes], int]:
    if not ranges or any(start < 0 or end < start for start, end in ranges):
        raise HTTPException(502, "The selected FITS tile contains invalid byte offsets.")
    header = "bytes=" + ",".join(f"{start}-{end}" for start, end in ranges)
    try:
        async with client.stream("GET", url, headers={"Range": header, "User-Agent": "ASCENTRA/1.0 (public SPHEREx explorer)"}) as response:
            if response.is_redirect:
                raise HTTPException(502, "IRSA redirected a selective cube read; refusing an unverified destination.")
            if response.status_code in {429, 502, 503, 504}:
                raise httpx.HTTPStatusError("Temporary IRSA response", request=response.request, response=response)
            if response.status_code != 206:
                # Crucial: do not read a server's 200 response, which could be the entire 320 MB tile.
                raise HTTPException(502, "IRSA did not honor a selective FITS byte-range request; the full cube was not downloaded.")
            parts: dict[int, bytes] = {}
            total_size: int | None = None
            content_type = response.headers.get("content-type", "")
            if content_type.lower().startswith("multipart/byteranges"):
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RANGE_RESPONSE_BYTES:
                        raise HTTPException(502, "IRSA returned an unexpectedly large cube range response.")
                mime = BytesParser(policy=policy.default).parsebytes(
                    f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii") + bytes(body)
                )
                if not mime.is_multipart():
                    raise HTTPException(502, "IRSA returned a malformed multipart byte-range response.")
                for part in mime.iter_parts():
                    match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+)", part.get("Content-Range", ""), re.IGNORECASE)
                    if not match:
                        raise HTTPException(502, "IRSA omitted byte-range provenance for a cube sample.")
                    start, end, part_total = map(int, match.groups())
                    payload = part.get_payload(decode=True) or b""
                    expected_length = min(end, part_total - 1) - start + 1
                    if len(payload) != expected_length or start in parts:
                        raise HTTPException(502, "IRSA returned an incomplete or duplicate cube byte range.")
                    parts[start] = payload
                    total_size = part_total if total_size is None else total_size
                    if total_size != part_total:
                        raise HTTPException(502, "IRSA returned inconsistent cube file lengths.")
            else:
                async for chunk in response.aiter_bytes():
                    if len(parts.get(-1, b"")) + len(chunk) > MAX_RANGE_RESPONSE_BYTES:
                        raise HTTPException(502, "IRSA returned an unexpectedly large cube range response.")
                    parts[-1] = parts.get(-1, b"") + chunk
                content_range = response.headers.get("content-range", "")
                match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+)", content_range, re.IGNORECASE)
                if not match:
                    raise HTTPException(502, "IRSA omitted byte-range provenance for the selected cube.")
                start, end, total_size = map(int, match.groups())
                payload = parts.pop(-1, b"")
                expected_length = min(end, total_size - 1) - start + 1
                if len(ranges) != 1 or start != ranges[0][0] or len(payload) != expected_length:
                    raise HTTPException(502, "IRSA returned a mismatched FITS byte range.")
                parts[start] = payload
            if total_size is None or total_size <= 0 or total_size > MAX_CUBE_BYTES:
                raise HTTPException(413, "The IRSA cube has an unexpected file size and was not processed.")
            for start, end in ranges:
                expected_length = min(end, total_size - 1) - start + 1
                if start not in parts or len(parts[start]) != expected_length:
                    raise HTTPException(502, "IRSA did not return every requested cube sample.")
            return parts, total_size
    except HTTPException:
        raise
    except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.HTTPError):
        raise


async def _read_ranges(client: httpx.AsyncClient, url: str, ranges: list[tuple[int, int]]) -> tuple[dict[int, bytes], int]:
    for attempt in range(3):
        try:
            return await _read_ranges_once(client, url, ranges)
        except HTTPException:
            raise
        except httpx.TimeoutException as exc:
            if attempt == 2:
                raise HTTPException(504, "IRSA did not return a cube sample before the timeout. Please retry shortly.") from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in {429, 502, 503, 504} or attempt == 2:
                raise HTTPException(502, "IRSA could not return a selected cube sample. Please retry shortly.") from exc
        except httpx.HTTPError as exc:
            if attempt == 2:
                raise HTTPException(502, "IRSA could not complete the selective cube read.") from exc
        if attempt < 2:
            await asyncio.sleep(0.4 * (attempt + 1))
    raise HTTPException(502, "IRSA could not complete the selective cube read.")


async def _read_header(client: httpx.AsyncClient, url: str, offset: int) -> tuple[fits.Header, int, int]:
    ranges, total = await _read_ranges(client, url, [(offset, offset + MAX_HEADER_BYTES - 1)])
    raw = ranges[offset]
    header, size = _parse_header(raw)
    return header, size, total


async def _cube_layout(client: httpx.AsyncClient, url: str) -> tuple[dict[str, tuple[fits.Header, int, int]], int]:
    offset = 0
    total_size: int | None = None
    hdus: dict[str, tuple[fits.Header, int, int]] = {}
    for _ in range(12):
        header, header_size, observed_total = await _read_header(client, url, offset)
        if total_size is not None and total_size != observed_total:
            raise HTTPException(502, "IRSA returned inconsistent FITS tile lengths.")
        total_size = observed_total
        data_start = offset + header_size
        extname = str(header.get("EXTNAME", "PRIMARY")).strip().upper()
        hdus[extname] = (header, data_start, _hdu_data_size(header))
        next_offset = data_start + math.ceil(_hdu_data_size(header) / 2880) * 2880
        if next_offset <= offset or next_offset >= total_size:
            break
        offset = next_offset
    required = {"IMAGE", "NHITS", "FLAGS", "SPECTRAL_CHANNELS"}
    if not required.issubset(hdus):
        raise HTTPException(502, "IRSA's returned cube is missing its IMAGE, NHITS, FLAGS, or channel-table extension.")
    image_header, _, _ = hdus["IMAGE"]
    shape = tuple(int(image_header.get(f"NAXIS{axis}", 0)) for axis in range(1, int(image_header.get("NAXIS", 0)) + 1))
    if shape != (512, 512, 102) or int(image_header.get("BITPIX", 0)) not in {-32, -64}:
        raise HTTPException(422, "The selected product is not a supported 512 × 512 × 102 DR1 All-Sky Cube.")
    if str(image_header.get("BUNIT", "")).replace(" ", "").lower() not in {"mjy/sr", "mjy.sr-1"}:
        raise HTTPException(422, "The selected cube does not report surface brightness in MJy/sr.")
    for name in ("NHITS", "FLAGS"):
        hdu_header = hdus[name][0]
        hdu_shape = tuple(int(hdu_header.get(f"NAXIS{axis}", 0)) for axis in range(1, int(hdu_header.get("NAXIS", 0)) + 1))
        if hdu_shape != shape or int(hdu_header.get("BITPIX", 0)) != 32:
            raise HTTPException(422, f"The selected cube's {name} extension does not match the image dimensions.")
    return hdus, int(total_size)


def _celestial_wcs(image_header: fits.Header) -> WCS:
    """Build a 2D WCS while excluding the cube's unrelated WAVE-TAB axis."""
    header = fits.Header()
    header["NAXIS"] = 2
    header["NAXIS1"] = int(image_header["NAXIS1"])
    header["NAXIS2"] = int(image_header["NAXIS2"])
    header["WCSAXES"] = 2
    for key in ("WCSNAME", "RADESYS", "RADECSYS", "EQUINOX", "LONPOLE", "LATPOLE", "MJD-OBS"):
        if key in image_header:
            header[key] = image_header[key]
    for key, value in image_header.items():
        if re.fullmatch(r"(?:CTYPE|CRPIX|CRVAL|CDELT|CUNIT|CROTA)[12]", key) or re.fullmatch(r"(?:CD|PC)[12]_[12]", key) or re.fullmatch(r"PV[12]_\d+", key):
            header[key] = value
    try:
        wcs = WCS(header, naxis=2)
        if not wcs.has_celestial:
            raise ValueError("FITS cube has no celestial WCS")
        return wcs
    except Exception as exc:
        raise HTTPException(422, "The cube's celestial WCS could not locate this sky coordinate safely.") from exc


def _channel_rows(raw: bytes, header: fits.Header, data_size: int) -> list[dict[str, Any]]:
    padded_data_size = math.ceil(data_size / 2880) * 2880
    if len(raw) < padded_data_size:
        raise HTTPException(502, "IRSA returned an incomplete spectral-channel table.")
    try:
        header_bytes = header.tostring(sep="", endcard=True, padding=True).encode("ascii")
        hdu = fits.BinTableHDU.fromstring(header_bytes + raw[:padded_data_size])
        if hdu.data is None or len(hdu.data) != 102:
            raise ValueError("Expected 102 spectral channel rows")
        names = set(hdu.data.dtype.names or [])
        required = {"DETECTOR", "SUBCHAN", "WAVELENGTH", "WL_MIN", "WL_MAX"}
        if not required.issubset(names):
            raise ValueError("Required wavelength columns are absent")
        result = []
        for row in hdu.data:
            result.append({
                "detector": int(row["DETECTOR"]),
                "subchannel": int(row["SUBCHAN"]),
                "wavelength_um": float(row["WAVELENGTH"]),
                "wavelength_min_um": float(row["WL_MIN"]),
                "wavelength_max_um": float(row["WL_MAX"]),
                "resolving_power": float(row["R"]) if "R" in names else None,
            })
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, "The IRSA cube's spectral-channel table could not be interpreted.") from exc


def _blank_channel_indices(header: fits.Header) -> set[int]:
    blank = set()
    for detector, subchannel in re.findall(r"D(\d+)\s*:\s*(\d+)", str(header.get("BLANKCH", "")), re.IGNORECASE):
        index = (int(detector) - 1) * 17 + int(subchannel)
        if 1 <= index <= 102:
            blank.add(index)
    return blank


async def _pixel_channels(client: httpx.AsyncClient, semaphore: asyncio.Semaphore, url: str, data_start: int, width: int, height: int, pixel_bytes: int, x: int, y: int, dtype: str) -> list[Any]:
    ranges = [
        (data_start + (channel * width * height + y * width + x) * pixel_bytes,
         data_start + (channel * width * height + y * width + x + 1) * pixel_bytes - 1)
        for channel in range(102)
    ]
    pieces: dict[int, bytes] = {}
    total = None
    for start in range(0, len(ranges), RANGE_GROUP_SIZE):
        batch = ranges[start : start + RANGE_GROUP_SIZE]
        async with semaphore:
            result, result_total = await _read_ranges(client, url, batch)
        total = result_total if total is None else total
        if result_total != total:
            raise HTTPException(502, "IRSA returned inconsistent cube lengths while sampling channels.")
        pieces.update(result)
    ordered = b"".join(pieces[offset] for offset, _ in ranges)
    if len(ordered) != 102 * pixel_bytes:
        raise HTTPException(502, "IRSA returned an incomplete 102-channel pixel profile.")
    # FITS numeric arrays are stored big-endian.
    values = np.frombuffer(ordered, dtype=np.dtype(dtype).newbyteorder(">"))
    return [value.item() for value in values]


def _cache_get(key: str) -> dict[str, Any] | None:
    entry = _profile_cache.get(key)
    if not entry:
        return None
    expires, payload = entry
    if expires <= time.monotonic():
        _profile_cache.pop(key, None)
        return None
    _profile_cache.move_to_end(key)
    return payload


def _cache_put(key: str, payload: dict[str, Any]) -> None:
    _profile_cache[key] = (time.monotonic() + 1800, payload)
    _profile_cache.move_to_end(key)
    while len(_profile_cache) > 128:
        _profile_cache.popitem(last=False)


@router.get("/profile/{product_id}")
async def spectral_profile(
    product_id: str,
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
):
    url = _cube_urls.get(product_id)
    if not url:
        raise HTTPException(404, "Search the DR1 All-Sky Cube collection first, then open a returned cube product.")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != IRSA_HOST or parsed.port not in (None, 443) or not IRSA_CUBE_PATH.fullmatch(parsed.path):
        raise HTTPException(400, "Only a DR1 All-Sky Cube product returned by IRSA SIA2 can be sampled.")
    cache_key = hashlib.sha256(f"{product_id}:{ra:.7f}:{dec:.7f}".encode()).hexdigest()
    cached = _cache_get(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    timeout = httpx.Timeout(connect=8, read=25, write=8, pool=8)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        hdus, file_size = await _cube_layout(client, url)
        image_header, image_start, _ = hdus["IMAGE"]
        width, height = int(image_header["NAXIS1"]), int(image_header["NAXIS2"])
        wcs = _celestial_wcs(image_header)
        try:
            x_float, y_float = wcs.world_to_pixel_values(ra, dec)
            x, y = int(round(float(x_float))), int(round(float(y_float)))
        except Exception as exc:
            raise HTTPException(422, "The selected sky coordinate could not be projected into the cube tile.") from exc
        if not (0 <= x < width and 0 <= y < height):
            raise HTTPException(422, "This cube tile does not contain the requested sky coordinate. Search a smaller position or select another returned tile.")

        channel_header, channel_start, channel_size = hdus["SPECTRAL_CHANNELS"]
        if channel_size > MAX_SMALL_HDU_BYTES:
            raise HTTPException(502, "The cube's spectral-channel table exceeds the safe parsing limit.")
        padded_size = math.ceil(channel_size / 2880) * 2880
        channel_range_end = channel_start + padded_size - 1
        channel_bytes, _ = await _read_ranges(client, url, [(channel_start, channel_range_end)])
        table_data = channel_bytes[channel_start]
        channel_rows = await asyncio.to_thread(_channel_rows, table_data, channel_header, channel_size)

        range_semaphore = asyncio.Semaphore(4)
        image_values, hit_values, flag_values = await asyncio.gather(
            _pixel_channels(client, range_semaphore, url, image_start, width, height, abs(int(image_header["BITPIX"])) // 8, x, y, "f4" if image_header["BITPIX"] == -32 else "f8"),
            _pixel_channels(client, range_semaphore, url, hdus["NHITS"][1], width, height, abs(int(hdus["NHITS"][0]["BITPIX"])) // 8, x, y, "i4"),
            _pixel_channels(client, range_semaphore, url, hdus["FLAGS"][1], width, height, abs(int(hdus["FLAGS"][0]["BITPIX"])) // 8, x, y, "i4"),
        )
        primary_header = hdus["PRIMARY"][0]
        blank_indices = _blank_channel_indices(primary_header)
        pixel_center_ra, pixel_center_dec = wcs.pixel_to_world_values(x, y)
        offset_arcsec = float(SkyCoord(ra=ra * u.deg, dec=dec * u.deg).separation(
            SkyCoord(ra=float(pixel_center_ra) * u.deg, dec=float(pixel_center_dec) * u.deg)
        ).arcsec)
        channels = []
        for index, (meta, brightness, hits, flags) in enumerate(zip(channel_rows, image_values, hit_values, flag_values), start=1):
            blank = index in blank_indices
            finite = math.isfinite(float(brightness))
            channels.append({
                "channel": index,
                **meta,
                "surface_brightness_mjy_sr": float(brightness) if finite and int(hits) > 0 and not blank else None,
                "contributing_input_pixels": int(hits),
                "flags": int(flags),
                "blank_channel": blank,
                "has_measurement": bool(finite and int(hits) > 0 and not blank),
            })
        payload = {
            "product_id": product_id,
            "source": "NASA/IPAC IRSA SPHEREx DR1 All-Sky Cube",
            "original_url": url,
            "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "file_size_bytes": file_size,
            "cached": False,
            "target": {"ra_deg": ra, "dec_deg": dec, "coordinate_frame": "ICRS"},
            "sample": {
                "method": "nearest cube pixel; not aperture or PSF photometry",
                "pixel_x": x,
                "pixel_y": y,
                "pixel_center_ra_deg": float(pixel_center_ra),
                "pixel_center_dec_deg": float(pixel_center_dec),
                "target_to_pixel_center_arcsec": offset_arcsec,
                "pixel_scale_arcsec": 12.9,
            },
            "measurement": {
                "quantity": "surface brightness at one cube pixel",
                "unit": "MJy/sr",
                "uncertainty": None,
                "uncertainty_note": "The DR1 All-Sky Cube exposes IMAGE, NHITS, FLAGS, and channel wavelengths; it does not provide a per-pixel variance plane.",
                "limitations": [
                    "These are sampled surface-brightness values, not calibrated point-source fluxes or a source-integrated spectrum.",
                    "The values are not background-subtracted or PSF-fitted by ASCENTRA.",
                    "Flags and input-pixel counts are returned per channel for inspection; no flags are silently masked.",
                    "Channels 51 and 52 are blank in the DR1 cube and are shown as missing.",
                ],
            },
            "channel_count": 102,
            "channels": channels,
        }
        _cache_put(cache_key, payload)
        return payload
