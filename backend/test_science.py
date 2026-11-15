"""Focused tests for the selective SPHEREx cube reader and catalogue matches."""

from __future__ import annotations

import io
import unittest

import httpx
import numpy as np
from astropy.io import fits
from astropy.table import Table
from astropy.wcs import WCS
from fastapi import HTTPException

from backend import catalog, spectral


class SpectralReaderTests(unittest.TestCase):
    def test_blank_detector_subchannels_map_to_global_channel_indices(self):
        header = fits.Header()
        header["BLANKCH"] = "D3:17,D4:01"
        self.assertEqual(spectral._blank_channel_indices(header), {51, 52})

    def test_channel_table_uses_actual_wavelength_and_band_columns(self):
        hdu = fits.BinTableHDU.from_columns([
            fits.Column(name="DETECTOR", format="I", array=np.repeat(np.arange(1, 7), 17)),
            fits.Column(name="SUBCHAN", format="I", array=np.tile(np.arange(1, 18), 6)),
            fits.Column(name="WAVELENGTH", format="E", unit="um", array=np.linspace(0.75, 5.0, 102)),
            fits.Column(name="WL_MIN", format="E", unit="um", array=np.linspace(0.74, 4.99, 102)),
            fits.Column(name="WL_MAX", format="E", unit="um", array=np.linspace(0.76, 5.01, 102)),
            fits.Column(name="R", format="E", array=np.full(102, 40.0)),
        ], name="SPECTRAL_CHANNELS")
        buffer = io.BytesIO()
        fits.HDUList([fits.PrimaryHDU(), hdu]).writeto(buffer)
        data = buffer.getvalue()[5760:8640]
        rows = spectral._channel_rows(data, hdu.header, hdu.header["NAXIS1"] * hdu.header["NAXIS2"])
        self.assertEqual(len(rows), 102)
        self.assertEqual(rows[50]["detector"], 3)
        self.assertAlmostEqual(rows[17]["wavelength_um"], float(hdu.data[17]["WAVELENGTH"]), places=5)

    def test_cube_celestial_wcs_excludes_wavelength_tab_axis(self):
        wcs = WCS(naxis=2)
        wcs.wcs.crpix = [-36351.5, -15871.5]
        wcs.wcs.cdelt = [1, 1]
        wcs.wcs.crval = [0, 0]
        wcs.wcs.ctype = ["RA---HPX", "DEC--HPX"]
        wcs.wcs.pc = [[-0.00274658203125, -0.00274658203125], [0.00274658203125, -0.00274658203125]]
        wcs.wcs.set_pv([(2, 1, 4), (2, 2, 3)])
        header = wcs.to_header()
        header["NAXIS"] = 3
        header["NAXIS1"] = 512
        header["NAXIS2"] = 512
        header["NAXIS3"] = 102
        header["CTYPE3"] = "WAVE-TAB"
        header["PS3_0"] = "WCS-WAVE"
        header["PS3_1"] = "WAVELENGTHS"
        celestial = spectral._celestial_wcs(header)
        x, y = celestial.world_to_pixel_values(210.80225, 54.34894)
        self.assertTrue(0 <= x < 512)
        self.assertTrue(0 <= y < 512)

    def test_only_sia_style_dr1_cube_urls_are_registered(self):
        spectral._cube_urls.clear()
        spectral.register_cube_product("bad", "https://example.com/Npix123_cube.fits")
        spectral.register_cube_product("good", "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/hips5_cube/hips_20261026/Norder5/Dir0/Npix2858_cube.fits")
        self.assertNotIn("bad", spectral._cube_urls)
        self.assertIn("good", spectral._cube_urls)


class RangeReadTests(unittest.IsolatedAsyncioTestCase):
    async def test_multipart_byte_ranges_are_checked_and_mapped_by_offset(self):
        content = bytes(range(100))

        def handler(request: httpx.Request) -> httpx.Response:
            ranges = request.headers["range"].removeprefix("bytes=").split(",")
            boundary = "science-ranges"
            parts = []
            for item in ranges:
                start_text, end_text = item.split("-")
                start, end = int(start_text), int(end_text)
                parts.append(
                    f"--{boundary}\r\nContent-Type: application/fits\r\nContent-Range: bytes {start}-{end}/100\r\n\r\n".encode()
                    + content[start : end + 1]
                    + b"\r\n"
                )
            body = b"".join(parts) + f"--{boundary}--\r\n".encode()
            return httpx.Response(206, headers={"content-type": f"multipart/byteranges; boundary={boundary}"}, content=body, request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result, total = await spectral._read_ranges(client, "https://irsa.ipac.caltech.edu/test.fits", [(20, 23), (2, 5)])
        self.assertEqual(total, 100)
        self.assertEqual(result[20], content[20:24])
        self.assertEqual(result[2], content[2:6])

    async def test_refuses_full_download_when_server_ignores_range(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"whole FITS", request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(HTTPException) as caught:
                await spectral._read_ranges(client, "https://irsa.ipac.caltech.edu/test.fits", [(0, 3)])
        self.assertIn("full cube was not downloaded", str(caught.exception.detail))


class CatalogueMatchTests(unittest.TestCase):
    def test_catalogue_rows_are_ranked_by_great_circle_separation(self):
        table = Table({
            "source_id": np.array([987654321098765432, 123456789012345678], dtype=np.int64),
            "ra": [210.8009, 210.80225],
            "dec": [54.34894, 54.34894],
            "phot_g_mean_mag": [17.2, 18.5],
            "parallax": [0.2, -0.1],
            "pmra": [3.0, 0.4],
            "pmdec": [1.0, -0.2],
            "ra_error": [0.3, 0.4],
            "dec_error": [0.3, 0.4],
        })
        stream = io.StringIO()
        table.write(stream, format="ascii.ipac")
        result = catalog._parse_ipac_table(stream.getvalue().encode("ascii"), 210.80225, 54.34894, 10, "Gaia DR3")
        self.assertEqual(result["status"], "matched")
        self.assertEqual(result["matches"][0]["source_id"], "123456789012345678")
        self.assertAlmostEqual(result["matches"][0]["separation_arcsec"], 0, places=5)
        self.assertEqual(len(result["matches"]), 2)


if __name__ == "__main__":
    unittest.main()
