"""Regression tests for the public API and FITS display pipeline.

Run with: .venv/Scripts/python.exe -m unittest backend.test_main -v
"""

from __future__ import annotations

import io
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from fastapi import HTTPException
from PIL import Image

from backend import main, tno


VOTABLE = b"""<?xml version="1.0"?>
<VOTABLE xmlns="http://www.ivoa.net/xml/VOTable/v1.3" version="1.3">
  <RESOURCE type="results">
    <INFO name="QUERY_STATUS" value="OK"/>
    <TABLE>
      <FIELD name="obs_id" datatype="char" arraysize="*"/>
      <FIELD name="access_url" datatype="char" arraysize="*"/>
      <FIELD name="s_ra" datatype="double"/>
      <FIELD name="s_dec" datatype="double"/>
      <FIELD name="t_min" datatype="double"/>
      <FIELD name="em_min" datatype="double"/>
      <FIELD name="em_max" datatype="double"/>
      <FIELD name="calib_level" datatype="int"/>
      <DATA><TABLEDATA><TR>
        <TD>qr2-test-product</TD>
        <TD>https://irsa.ipac.caltech.edu/ibe/data/spherex/test/product.fits</TD>
        <TD>210.8</TD><TD>54.3</TD><TD>61000</TD>
        <TD>7.5E-7</TD><TD>1.09E-6</TD><TD>2</TD>
      </TR></TABLEDATA></DATA>
    </TABLE>
  </RESOURCE>
</VOTABLE>"""


class FakeSIAClient:
    params_seen: list[tuple[str, str]] = []

    def __init__(self, **_kwargs):
        self.params_seen = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, *, params, **_kwargs):
        self.params_seen = params
        type(self).params_seen = params
        request = httpx.Request("GET", url)
        return httpx.Response(200, content=VOTABLE, request=request)


class TimeoutThenSIAClient(FakeSIAClient):
    calls = 0

    async def get(self, url, *, params, **kwargs):
        type(self).calls += 1
        if type(self).calls == 1:
            raise httpx.ReadTimeout("temporary SIA timeout")
        return await super().get(url, params=params, **kwargs)


class FakeCutoutResponse:
    status_code = 400
    url = httpx.URL("https://irsa.ipac.caltech.edu/ibe/data/spherex/test/product.fits")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def aread(self):
        return b"requested position is not covered"


class FakeCutoutClient:
    requested_urls: list[str] = []

    def __init__(self, **_kwargs):
        self.requested_urls = []
        type(self).requested_urls = self.requested_urls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def stream(self, _method, url, **_kwargs):
        self.requested_urls.append(url)
        return FakeCutoutResponse()


class FakeFITSResponse:
    status_code = 200
    url = httpx.URL("https://irsa.ipac.caltech.edu/ibe/data/spherex/test/product.fits")

    def __init__(self, data: bytes):
        self.data = data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def raise_for_status(self):
        return None

    async def aread(self):
        return self.data

    async def aiter_bytes(self):
        yield self.data


class FakeFITSClient:
    data = b""
    requests = 0

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def stream(self, _method, _url, **_kwargs):
        type(self).requests += 1
        return FakeFITSResponse(type(self).data)


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        main._cache.clear()
        main._cache_bytes = 0
        main._url_by_id.clear()
        main._image_centers.clear()
        main._preview_metadata.clear()
        main._preview_wcs_headers.clear()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_health_identifies_archive_and_release_scope(self):
        response = await self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["archive"], "NASA/IPAC IRSA")
        self.assertEqual(response.json()["archive_connectivity"], "checked per query")
        self.assertEqual(response.json()["releases"], ["DR1", "DR1 Deep", "DR1 All-Sky Cube", "QR3", "QR3 Deep"])

    async def test_observation_query_maps_real_sia2_fields_and_time_range(self):
        with patch.object(main.httpx, "AsyncClient", FakeSIAClient):
            response = await self.client.get(
                "/api/observations",
                params={"ra": 210.8, "dec": 54.3, "release": "dr1", "start_date": "2025-01-01", "end_date": "2025-01-01", "limit": 5},
            )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["count"], 1)
        product = payload["observations"][0]
        self.assertEqual(product["product_id"], "qr2-test-product")
        self.assertAlmostEqual(product["wavelength_min_um"], 0.75)
        self.assertEqual(product["calibration_level"], 2)
        self.assertEqual(product["release"], "DR1")
        self.assertIn(("COLLECTION", "spherex_dr1"), FakeSIAClient.params_seen)
        self.assertTrue(any(key == "TIME" for key, _ in FakeSIAClient.params_seen))
        self.assertTrue(product["original_url"].startswith("https://irsa.ipac.caltech.edu/ibe/data/spherex/"))

    async def test_observation_query_supports_public_dr1_all_sky_cube_collection(self):
        with patch.object(main.httpx, "AsyncClient", FakeSIAClient):
            response = await self.client.get("/api/observations", params={"ra": 210.8, "dec": 54.3, "release": "dr1_cube"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn(("COLLECTION", "spherex_dr1_cube"), FakeSIAClient.params_seen)
        self.assertNotIn(("DPTYPE", "cube"), FakeSIAClient.params_seen)
        self.assertNotIn(("FORMAT", "image/fits"), FakeSIAClient.params_seen)
        self.assertEqual(response.json()["observations"][0]["release"], "DR1 All-Sky Cube")

    async def test_observation_query_retries_one_upstream_timeout(self):
        TimeoutThenSIAClient.calls = 0
        with patch.object(main.httpx, "AsyncClient", TimeoutThenSIAClient), patch.object(main.asyncio, "sleep", new=AsyncMock()):
            response = await self.client.get("/api/observations", params={"ra": 210.8, "dec": 54.3, "release": "dr1"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(TimeoutThenSIAClient.calls, 2)

    async def test_observation_query_rejects_invalid_coordinates_without_upstream_call(self):
        response = await self.client.get("/api/observations", params={"ra": 360, "dec": 0})
        self.assertEqual(response.status_code, 422)
        response = await self.client.get("/api/observations", params={"ra": 10, "dec": 91})
        self.assertEqual(response.status_code, 422)

    async def test_observation_query_explains_retired_qr2_sia_collection(self):
        response = await self.client.get("/api/observations", params={"ra": 10, "dec": 0, "release": "qr2"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("use DR1", response.json()["detail"])

    async def test_overflow_query_status_is_returned_as_incomplete_results(self):
        with patch.object(main.httpx, "AsyncClient", FakeSIAClient), patch.object(main, "_parse_votable_response", return_value=([], "OVERFLOW")):
            response = await self.client.get("/api/observations", params={"ra": 10, "dec": 0, "release": "dr1"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["truncated"])
        self.assertIn("incomplete", response.json()["message"])

    def test_votable_query_status_error_is_not_reported_as_empty_sky(self):
        xml = b'''<VOTABLE xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE><INFO name="QUERY_STATUS" value="ERROR">invalid query</INFO></RESOURCE></VOTABLE>'''
        with self.assertRaisesRegex(ValueError, "invalid query"):
            main._parse_votable(xml)

    def test_votable_overflow_is_preserved_for_transparent_result_limits(self):
        xml = VOTABLE.replace(b'value="OK"', b'value="OVERFLOW"')
        rows, status = main._parse_votable_response(xml)
        self.assertEqual(len(rows), 1)
        self.assertEqual(status, "OVERFLOW")

    def test_fits_renderer_prefers_science_extension_and_handles_nonfinite_pixels(self):
        science = np.arange(64 * 64, dtype=np.float32).reshape(64, 64)
        science[0, 0] = np.nan
        science[0, 1] = np.inf
        buffer = io.BytesIO()
        fits.HDUList(
            [
                fits.PrimaryHDU(),
                fits.ImageHDU(np.full((64, 64), 7, dtype=np.float32), name="VAR"),
                fits.ImageHDU(science, name="SCI"),
            ]
        ).writeto(buffer)
        rendered = main._fits_to_png(buffer.getvalue())
        self.assertTrue(rendered.startswith(b"\x89PNG\r\n\x1a\n"))
        with Image.open(io.BytesIO(rendered)) as image:
            self.assertEqual(image.mode, "RGB")
            self.assertEqual(image.size, (64, 64))
            self.assertGreater(len(set(image.get_flattened_data())), 20)
        _, metadata, _ = main._render_fits(buffer.getvalue())
        self.assertEqual(metadata["hdu"], "SCI")
        self.assertEqual([extension["name"] for extension in metadata["extensions"]], ["PRIMARY", "VAR", "SCI"])

    def test_fits_blank_integer_pixels_are_reported_as_invalid(self):
        values = np.arange(16, dtype=np.int16).reshape(4, 4)
        values[0, 0] = -32768
        hdu = fits.PrimaryHDU(values)
        hdu.header["BLANK"] = -32768
        buffer = io.BytesIO()
        hdu.writeto(buffer)
        _, metadata, _ = main._render_fits(buffer.getvalue())
        self.assertEqual(metadata["invalid_pixel_count"], 1)
        self.assertEqual(metadata["data_min"], 1.0)

    def test_fits_cube_selects_requested_plane_and_rejects_blank_channel(self):
        cube = np.stack([np.full((8, 8), plane, dtype=np.float32) for plane in range(5)])
        cube[4] = np.nan
        buffer = io.BytesIO()
        fits.PrimaryHDU(cube).writeto(buffer)
        with patch.object(main, "MAX_PREVIEW_PIXELS", 64):
            _, metadata, _ = main._render_fits(buffer.getvalue(), plane=2)
            self.assertEqual(metadata["plane_count"], 5)
            self.assertEqual(metadata["selected_plane_indices"], [2])
            self.assertEqual(metadata["width"], 8)
            with self.assertRaisesRegex(ValueError, "no finite pixels"):
                main._render_fits(buffer.getvalue(), plane=4)

    def test_fits_renderer_handles_compressed_image_hdu(self):
        buffer = io.BytesIO()
        fits.HDUList([fits.PrimaryHDU(), fits.CompImageHDU(data=np.arange(32 * 32, dtype=np.float32).reshape(32, 32), name="SCI")]).writeto(buffer)
        self.assertTrue(main._fits_to_png(buffer.getvalue()).startswith(b"\x89PNG\r\n\x1a\n"))

    def test_fits_renderer_supports_transfer_functions_and_returns_wcs_provenance(self):
        wcs = WCS(naxis=2)
        wcs.wcs.crpix = [33, 33]
        wcs.wcs.cdelt = [-0.001, 0.001]
        wcs.wcs.crval = [210.8, 54.3]
        wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        header = wcs.to_header()
        header["BUNIT"] = "MJy/sr"
        values = np.arange(64 * 64, dtype=np.float32).reshape(64, 64)
        values[0, 0] = np.nan
        buffer = io.BytesIO()
        fits.PrimaryHDU(values, header=header).writeto(buffer)
        rendered = {}
        for mode in ("linear", "log", "sqrt", "asinh"):
            png, metadata, wcs_header = main._render_fits(buffer.getvalue(), mode, 1.2)
            rendered[mode] = png
            self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertEqual(metadata["stretch"], mode)
            self.assertEqual(metadata["bunit"], "MJy/sr")
            self.assertEqual(metadata["invalid_pixel_count"], 1)
            self.assertTrue(metadata["wcs"]["available"])
            self.assertAlmostEqual(metadata["wcs"]["center_ra_deg"], 210.8, delta=0.001)
            self.assertIsNotNone(wcs_header)
        self.assertEqual(len(set(rendered.values())), 4)

    async def test_wcs_pixel_to_sky_endpoint_uses_cached_cutout_header(self):
        wcs = WCS(naxis=2)
        wcs.wcs.crpix = [33, 33]
        wcs.wcs.cdelt = [-0.001, 0.001]
        wcs.wcs.crval = [210.8, 54.3]
        wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        cache_key = "preview:wcs-test"
        main._preview_metadata[cache_key] = (main.time.monotonic() + 60, {"width": 64, "height": 64, "display_width": 64, "display_height": 64, "coordinate_frame": "ICRS"})
        main._preview_wcs_headers[cache_key] = (main.time.monotonic() + 60, wcs.to_header().tostring(sep="\n", endcard=False, padding=False))
        response = await self.client.get("/api/preview-world/wcs-test?x=32&y=32")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertAlmostEqual(response.json()["ra_deg"], 210.8, places=5)
        self.assertAlmostEqual(response.json()["dec_deg"], 54.3, places=5)
        grid_response = await self.client.get("/api/preview-grid/wcs-test?lines=3")
        self.assertEqual(grid_response.status_code, 200, grid_response.text)
        self.assertGreater(len(grid_response.json()["paths"]), 0)

    def test_fits_renderer_rejects_oversized_pixel_plane_before_rendering(self):
        buffer = io.BytesIO()
        fits.PrimaryHDU(np.arange(16, dtype=np.float32).reshape(4, 4)).writeto(buffer)
        with patch.object(main, "MAX_PREVIEW_PIXELS", 10):
            with self.assertRaisesRegex(ValueError, "preview limit"):
                main._fits_to_png(buffer.getvalue())

    async def test_preview_endpoint_returns_stretched_png_and_fits_metadata_header(self):
        product_id = "scientific-preview-test"
        main._url_by_id[product_id] = "https://irsa.ipac.caltech.edu/ibe/data/spherex/test/product.fits"
        wcs = WCS(naxis=2)
        wcs.wcs.crpix = [9, 9]
        wcs.wcs.cdelt = [-0.001, 0.001]
        wcs.wcs.crval = [210.8, 54.3]
        wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        buffer = io.BytesIO()
        fits.PrimaryHDU(np.arange(256, dtype=np.float32).reshape(16, 16), header=wcs.to_header()).writeto(buffer)
        FakeFITSClient.data = buffer.getvalue()
        FakeFITSClient.requests = 0
        with patch.object(main, "_resolve_access_url", AsyncMock()), patch.object(main.httpx, "AsyncClient", FakeFITSClient):
            response = await self.client.get(f"/api/preview/{product_id}?ra=210.8&dec=54.3&stretch=log&contrast=1.4&low_percentile=2&high_percentile=98", headers={"Origin": "http://localhost:3000"})
            second_render = await self.client.get(f"/api/preview/{product_id}?ra=210.8&dec=54.3&stretch=sqrt&contrast=1.4")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["content-type"], "image/png")
        encoded = response.headers["x-ascentra-preview-metadata"]
        import base64
        metadata = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
        self.assertEqual(metadata["stretch"], "log")
        self.assertEqual(metadata["contrast"], 1.4)
        self.assertEqual(metadata["display_min_percentile"], 2.0)
        self.assertEqual(metadata["display_max_percentile"], 98.0)
        self.assertEqual(metadata["width"], 16)
        self.assertTrue(metadata["wcs"]["available"])
        self.assertIn("x-ascentra-preview-metadata", response.headers.get("access-control-expose-headers", "").lower())
        grid = await self.client.get(f"/api/preview-grid/{metadata['preview_id']}")
        self.assertEqual(grid.status_code, 200, grid.text)
        self.assertGreater(len(grid.json()["paths"]), 0)
        world = await self.client.get(f"/api/preview-world/{metadata['preview_id']}?x=8&y=8")
        self.assertEqual(world.status_code, 200, world.text)
        self.assertAlmostEqual(world.json()["ra_deg"], 210.8, places=3)
        self.assertEqual(second_render.status_code, 200, second_render.text)
        self.assertEqual(FakeFITSClient.requests, 1, "Changing the display stretch should reuse cached FITS bytes.")
        bad_stretch = await self.client.get(f"/api/preview/{product_id}?ra=210.8&dec=54.3&stretch=solarized")
        self.assertEqual(bad_stretch.status_code, 422)
        bad_percentiles = await self.client.get(f"/api/preview/{product_id}?ra=210.8&dec=54.3&low_percentile=99&high_percentile=98")
        self.assertEqual(bad_percentiles.status_code, 422)

    def test_cache_uses_a_byte_bound_and_lru_eviction(self):
        with patch.object(main, "MAX_CACHE_BYTES", 10), patch.object(main, "MAX_CACHE_ENTRIES", 3):
            main._cache_put("small", b"1234")
            main._cache_put("large", b"12345678")
            self.assertIsNone(main._cache_get("small"))
            self.assertEqual(main._cache_get("large"), b"12345678")
            main._cache_put("too-large", b"x" * 11)
            self.assertIsNone(main._cache_get("too-large"))
            self.assertLessEqual(main._cache_bytes, 10)

    async def test_compare_readiness_never_claims_a_difference_image(self):
        result = await main.comparison_readiness(
                main.CompareRequest(
                    earlier_url="https://irsa.ipac.caltech.edu/ibe/data/spherex/a.fits",
                    later_url="https://irsa.ipac.caltech.edu/ibe/data/spherex/b.fits",
                    earlier_collection="spherex_dr1",
                    later_collection="spherex_dr1",
                    earlier_band="0.75–1.09 μm",
                    later_band="0.75–1.09 μm",
                    earlier_calibration=2,
                    later_calibration=2,
                    earlier_mjd=61000,
                    later_mjd=61001,
                )
        )
        self.assertTrue(result["metadata_compatible"])
        self.assertFalse(result["scientific_difference_ready"])
        self.assertFalse(result["difference_map_available"])

    async def test_preview_refuses_partial_coordinates(self):
        product_id = "coordinate-validation-test"
        main._url_by_id[product_id] = "https://irsa.ipac.caltech.edu/ibe/data/spherex/test/product.fits"
        with self.assertRaises(HTTPException) as caught:
            await main.preview(product_id, ra=10.0, dec=None)
        self.assertEqual(caught.exception.status_code, 400)


PUBLISHED_TABLE_FIXTURE = """<figure><figcaption>Table 11: Astrometry and photometry</figcaption><table>
<tr><th>Time (UTC)</th><th>R.A.</th><th>Decl.</th><th>sigma RA</th><th>sigma Dec</th><th>mag</th><th>sigma m</th><th>Band</th><th>Source</th><th>Origin</th></tr>
<tr><td>2016-02-25 07:49:48.7</td><td>260.3187519</td><td>-44.7826230</td><td>0.0519</td><td>0.0518</td><td>19.751</td><td>0.0166</td><td>VR</td><td>DECam</td><td>D</td></tr>
<tr><td>2016-02-25 07:51:31.7</td><td>260.3187745</td><td>-44.7826351</td><td>0.0537</td><td>0.0530</td><td>19.769</td><td>0.0161</td><td>VR</td><td>DECam</td><td>D</td></tr>
<tr><td>2026-03-04 09:33:14.7</td><td>274.7906291</td><td>-42.4543647</td><td>0.0131</td><td>0.0130</td><td>19.319</td><td>0.0218</td><td>y</td><td>local fit</td><td>R</td></tr>
</table></figure>"""


class TNOTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        tno._response_cache.clear()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver")

    async def asyncTearDown(self):
        await self.client.aclose()

    def test_published_astrometry_parser_retains_measurement_provenance(self):
        rows = tno.parse_published_observations(PUBLISHED_TABLE_FIXTURE, "2026-11-13T00:00:00Z")
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["observed_at"], "2016-02-25T07:49:48.700Z")
        self.assertEqual(rows[0]["observatory_code"], "W84")
        self.assertEqual(rows[2]["observatory_code"], "X05")
        self.assertAlmostEqual(rows[0]["sigma_ra_arcsec"], 0.0519)
        self.assertEqual(rows[0]["provenance"]["source"], tno.PAPER_ABS_URL)
        self.assertEqual(rows[0]["provenance"]["retrieved_at"], "2026-11-13T00:00:00Z")

    def test_spherical_separation_handles_ra_wrap_and_small_angles(self):
        self.assertAlmostEqual(tno.angular_separation_arcsec(359.999, 0, 0.001, 0), 7.2, places=3)

    def test_tess_parser_keeps_published_uncertainty_significance_and_provenance(self):
        html = """<p>TESS magnitudes are 18.94\\pm 0.11, 19.40\\pm 0.21, 19.14\\pm 0.08, 18.99\\pm 0.06, and 19.08\\pm 0.06.</p><p>ED138 is detected at 9.9, 5.1, 14.6, 20.0 and 20.7 sigma.</p>"""
        rows = tno.parse_tess_sector_photometry(html, "2026-11-13T00:00:00Z")
        self.assertEqual([row["sector"] for row in rows], [12, 39, 66, 93, 104])
        self.assertAlmostEqual(rows[0]["magnitude_sigma"], 0.11)
        self.assertAlmostEqual(rows[-1]["detection_significance_sigma"], 20.7)
        self.assertEqual(rows[0]["provenance"]["source"], tno.TESS_PAPER_ABS_URL)
        self.assertEqual(rows[0]["provenance"]["retrieved_at"], "2026-11-13T00:00:00Z")

    def test_horizons_csv_parser_reads_exact_utc_and_coordinates(self):
        result = """header\n$$SOE\n 2026-Nov-13 00:00, , , 18 12 25.342738, -42 08 37.04067, 2.7, 0.8, 19.766, n.a., 47.2, 0.001, 47.9, 0.01,\n$$EOE\n"""
        row = tno.parse_horizons_csv(result, full_ephemeris=True)[0]
        self.assertEqual(row["observed_at"], "2026-11-13T00:00:00.000Z")
        self.assertAlmostEqual(row["ra_deg"], (18 + 12 / 60 + 25.342738 / 3600) * 15)
        self.assertAlmostEqual(row["dec_deg"], -(42 + 8 / 60 + 37.04067 / 3600))
        self.assertAlmostEqual(row["heliocentric_distance_au"], 47.2)
        self.assertAlmostEqual(row["observer_distance_au"], 47.9)

    async def test_orbit_endpoint_preserves_live_jpl_source_and_uncertainties(self):
        orbit = {
            "designation": "2026 ED138",
            "elements": {"a": {"value": 42.9, "uncertainty_1sigma": 0.0005, "units": "au", "label": "semi-major axis"}},
            "provenance": {"source": "JPL SBDB", "retrieved_at": "2026-11-13T00:00:00Z"},
        }
        with patch.object(tno, "fetch_sbdb", AsyncMock(return_value=orbit)):
            response = await self.client.get("/api/tno/ed138?refresh=true")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["object"]["designation"], "2026 ED138")
        self.assertEqual(response.json()["object"]["elements"]["a"]["uncertainty_1sigma"], 0.0005)

    async def test_observation_endpoint_matches_each_site_position_and_reports_residual(self):
        retrieved = "2026-11-13T00:00:00Z"
        observations = tno.parse_published_observations(PUBLISHED_TABLE_FIXTURE, retrieved)

        async def mock_positions(rows, site):
            self.assertEqual(site, rows[0]["observatory_code"])
            return [{"observed_at": row["observed_at"], "ra_deg": row["ra_deg"], "dec_deg": row["dec_deg"]} for row in rows]

        async def mock_data():
            return observations, retrieved

        async def mock_tess():
            return [{"sector": 12, "magnitude": 18.94, "magnitude_sigma": 0.11, "detection_significance_sigma": 9.9, "epoch_label": "TESS Sector 12", "provenance": {"kind": "published catalogue measurement", "source": tno.TESS_PAPER_ABS_URL, "retrieved_at": retrieved}}], retrieved

        with patch.object(tno, "fetch_published_observations", mock_data), patch.object(tno, "fetch_published_tess_photometry", mock_tess), patch.object(tno, "_horizons_positions", mock_positions):
            response = await self.client.get("/api/tno/ed138/observations?refresh=true")
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["validation"]["matched"], 3)
        self.assertEqual(payload["validation"]["status"], "complete")
        self.assertTrue(all(row["residual_arcsec"] == 0 for row in payload["observations"]))
        self.assertGreater(len(payload["motion_samples"]), 0)
        self.assertEqual(payload["benchmark_rate_arcsec_min"], 0.043)
        self.assertEqual(payload["tess_sector_photometry"][0]["sector"], 12)

    async def test_horizons_ephemeris_endpoint_returns_prediction_class_and_ranges(self):
        fixture = """header\n$$SOE\n 2026-Nov-13 00:00, , , 18 12 25.342738, -42 08 37.04067, 2.7, 0.8, 19.766, n.a., 47.2, 0.001, 47.9, 0.01,\n 2026-Nov-14 00:00, , , 18 12 31.269245, -42 08 17.08356, 2.8, 0.8, 19.766, n.a., 47.2, 0.001, 47.9, 0.01,\n$$EOE\n"""
        with patch.object(tno, "_get_json", AsyncMock(return_value={"result": fixture})):
            response = await self.client.get("/api/tno/ed138/ephemeris?start_date=2026-11-13&days=2&refresh=true")
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["classification"], "ephemeris prediction")
        self.assertEqual(payload["count"], 2)
        self.assertAlmostEqual(payload["positions"][0]["heliocentric_distance_au"], 47.2)
        self.assertIsNotNone(payload["positions"][1]["angular_rate_arcsec_hour"])

    async def test_preview_does_not_fall_back_to_a_different_image_center(self):
        product_id = "strict-cutout-center-test"
        main._url_by_id[product_id] = "https://irsa.ipac.caltech.edu/ibe/data/spherex/test/product.fits"
        main._image_centers[product_id] = (20.0, 30.0)
        with patch.object(main.httpx, "AsyncClient", FakeCutoutClient):
            with self.assertRaises(HTTPException) as caught:
                await main.preview(product_id, ra=11.0, dec=12.0, size=0.12)
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(len(FakeCutoutClient.requested_urls), 1)
        self.assertIn("center=11.00000000%2C12.00000000", FakeCutoutClient.requested_urls[0])

    async def test_preview_redirect_validator_rejects_other_hosts(self):
        request = httpx.Request("GET", "https://irsa.ipac.caltech.edu/ibe/data/spherex/a.fits")
        response = httpx.Response(302, headers={"location": "https://example.org/collect"}, request=request)
        with self.assertRaises(HTTPException) as caught:
            await main._validate_irsa_redirect(response)
        self.assertEqual(caught.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
