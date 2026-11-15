"""Scientific regression tests for SPHEREx motion processing.

The FITS images generated here are synthetic unit-test fixtures and are never
returned by the public API as astronomical observations.
"""

from __future__ import annotations

import io
import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import numpy as np
from astropy import units as u
from astropy.io import fits
from astropy.wcs import WCS
from fastapi import HTTPException
from unittest.mock import Mock

from backend.motion import (
    MotionAnalysisRequest,
    MotionEpoch,
    _angular_separation_arcsec,
    analyze_motion,
    _compatibility_reasons,
    _cutout_url,
    _extract_sources,
    _fit_motion,
    _spectral_values_at_pixel,
    _spatial_wcs_warnings,
    _validate_irsa_url,
)


def make_epoch(epoch_id: str, day: int = 1) -> MotionEpoch:
    return MotionEpoch(
        id=epoch_id,
        product_id=f"test-{epoch_id}",
        original_url=f"https://irsa.ipac.caltech.edu/ibe/data/spherex/test/{epoch_id}.fits",
        collection="spherex_dr1",
        release="dr1",
        observation_start=f"2025-01-{day:02d}T00:00:00Z",
        calibration_level=2,
        wavelength_min_um=0.75,
        wavelength_max_um=1.09,
        resolution_arcsec=5.0,
    )


def synthetic_fits() -> bytes:
    rng = np.random.default_rng(73019)
    image = rng.normal(0, 1, (128, 128)).astype(np.float32)
    yy, xx = np.mgrid[:128, :128]
    for x, y, amplitude in [(24, 29, 75), (55, 39, 100), (94, 31, 88), (37, 91, 120), (93, 99, 96)]:
        image += (amplitude * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * 1.1**2))).astype(np.float32)
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.crval = [210.80225, 54.34894]
    wcs.wcs.crpix = [64.5, 64.5]
    wcs.wcs.cdelt = [-1.7 / 3600, 1.7 / 3600]
    header = wcs.to_header()
    header["BUNIT"] = "MJy/sr"
    header["EXTNAME"] = "IMAGE"
    flags = np.zeros((128, 128), dtype=np.uint32)
    flags[0:5, :] = 64
    flags[5:10, :] = 2097152
    flags[10:15, :] = 2
    hdus = fits.HDUList([
        fits.PrimaryHDU(),
        fits.ImageHDU(image, header=header, name="IMAGE"),
        fits.ImageHDU(np.ones_like(image), name="VARIANCE"),
        fits.ImageHDU(flags, name="FLAGS"),
        fits.ImageHDU(np.zeros_like(image), name="ZODI"),
    ])
    stream = io.BytesIO()
    hdus.writeto(stream)
    return stream.getvalue()


class MotionValidationTests(unittest.TestCase):
    def test_spherical_separation_wraps_ra_and_matches_known_offset(self):
        self.assertAlmostEqual(_angular_separation_arcsec(359.999, 0, 0.001, 0), 7.2, places=4)

    def test_irsa_url_validation_rejects_external_hosts(self):
        with self.assertRaises(HTTPException):
            _validate_irsa_url("https://example.com/ibe/data/spherex/a.fits")

    def test_cutout_request_preserves_irsa_product_and_adds_region(self):
        request = MotionAnalysisRequest(ra=210.8, dec=54.3, epochs=[make_epoch("a"), make_epoch("b", 2)])
        url = _cutout_url(request.epochs[0], request)
        self.assertIn("center=210.80000000%2C54.30000000", url)
        self.assertIn("size=0.12000", url)
        self.assertTrue(url.startswith("https://irsa.ipac.caltech.edu/ibe/data/spherex/"))

    def test_compatible_epochs_require_same_collection_calibration_and_band(self):
        self.assertEqual(_compatibility_reasons([make_epoch("a", 1), make_epoch("b", 3)]), [])
        mismatched = make_epoch("c", 5).model_copy(update={"wavelength_min_um": 1.0, "wavelength_max_um": 1.3})
        self.assertTrue(any("wavelength" in reason.lower() for reason in _compatibility_reasons([make_epoch("a", 1), mismatched])))

    def test_wavelength_range_accepts_reported_long_wavelength_edge(self):
        epoch = make_epoch("edge").model_copy(update={"wavelength_max_um": 5.0096})
        self.assertEqual(epoch.wavelength_max_um, 5.0096)

    def test_wcs_wave_lookup_uses_astropy_spectral_coordinates(self):
        spectral_wcs = Mock()
        spectral_wcs.pixel_to_world.return_value = (4.12 * u.um, 0.04 * u.um)
        wavelength, bandwidth = _spectral_values_at_pixel(spectral_wcs, 3, 3)
        self.assertAlmostEqual(wavelength or 0, 4.12, places=5)
        self.assertAlmostEqual(bandwidth or 0, 0.04, places=5)
        spectral_wcs.pixel_to_world.assert_called_once_with(3, 3)
        self.assertEqual(_spectral_values_at_pixel(None, 3, 3), (None, None))

    def test_spatial_wcs_sip_ambiguity_is_reported(self):
        header = fits.Header()
        header["A_ORDER"] = 2
        header["B_ORDER"] = 2
        self.assertEqual(len(_spatial_wcs_warnings(header, ["RA---TAN", "DEC--TAN"])), 1)
        self.assertEqual(_spatial_wcs_warnings(header, ["RA---TAN-SIP", "DEC--TAN-SIP"]), [])

    def test_local_lvf_mismatch_withholds_motion_fit(self):
        start = datetime(2025, 1, 1, tzinfo=timezone.utc)
        positions = []
        for index, wavelength in enumerate((4.85, 4.99, 4.55)):
            positions.append({
                "observation_start": (start + timedelta(days=index * 4)).isoformat().replace("+00:00", "Z"),
                "ra_deg": 10 + index * 0.0001,
                "dec_deg": 20,
                "position_uncertainty_arcsec": 0.2,
                "local_wavelength_um": wavelength,
                "local_bandwidth_um": 0.036,
            })
        from backend.motion import _local_channel_compatibility
        compatibility = _local_channel_compatibility(positions)
        self.assertFalse(compatibility["compatible"])
        result = _fit_motion({"positions": positions}, None, compatibility)
        self.assertIsNone(result["proper_motion"])
        self.assertIn("apparent-motion fit withheld", result["classification"])

    def test_local_lvf_overlap_allows_motion_fit(self):
        start = datetime(2025, 1, 1, tzinfo=timezone.utc)
        positions = []
        for index, wavelength in enumerate((4.85, 4.8504, 4.8496)):
            positions.append({
                "observation_start": (start + timedelta(days=index * 2)).isoformat().replace("+00:00", "Z"),
                "ra_deg": 10 + index * 0.0001,
                "dec_deg": 20,
                "position_uncertainty_arcsec": 0.2,
                "local_wavelength_um": wavelength,
                "local_bandwidth_um": 0.036,
            })
        from backend.motion import _local_channel_compatibility
        compatibility = _local_channel_compatibility(positions)
        self.assertTrue(compatibility["compatible"])
        result = _fit_motion({"positions": positions}, None, compatibility)
        self.assertIsNotNone(result["proper_motion"])

    def test_fits_source_detection_uses_wcs_variance_flags_and_zodiacal_extension(self):
        result = _extract_sources(synthetic_fits(), make_epoch("synthetic", 1), 5, 210.80225, 54.34894)
        self.assertGreaterEqual(result["source_count"], 5)
        self.assertTrue(result["wcs"]["available"])
        self.assertTrue(result["quality"]["flags_applied"])
        self.assertTrue(result["quality"]["variance_applied"])
        self.assertTrue(result["quality"]["zodi_subtracted_for_detection"])
        self.assertEqual(result["quality"]["valid_pixels"], int(128 * 128 - 5 * 128))
        self.assertTrue(all(210.7 < point["ra_deg"] < 210.9 for point in result["detections"]))
        self.assertTrue(all(point["flux_unit"] == "Jy" for point in result["detections"]))
        self.assertLess(result["quality"]["valid_fraction"], 1)

    def test_source_results_disclose_sip_wcs_ctype_ambiguity(self):
        with fits.open(io.BytesIO(synthetic_fits()), memmap=False) as hdus:
            header = hdus["IMAGE"].header
            header["A_ORDER"] = 2
            header["B_ORDER"] = 2
            for key in ("A_2_0", "A_1_1", "A_0_2", "B_2_0", "B_1_1", "B_0_2"):
                header[key] = 0.0
            payload = io.BytesIO()
            hdus.writeto(payload)
        result = _extract_sources(payload.getvalue(), make_epoch("sip-fixture", 1), 5, 210.80225, 54.34894)
        self.assertTrue(any("CTYPE omits -SIP" in message for message in result["wcs"]["warnings"]))

    def test_weighted_motion_fit_recovers_benchmark_rate_and_velocity_only_with_distance(self):
        epoch = datetime(2025, 1, 1, tzinfo=timezone.utc)
        positions = []
        rate_arcsec_day = 0.043 * 60 * 24
        for index in range(5):
            positions.append({
                "observation_start": (epoch + timedelta(days=index * 2)).isoformat().replace("+00:00", "Z"),
                "ra_deg": 150 + rate_arcsec_day * index * 2 / 3600,
                "dec_deg": 0,
                "position_uncertainty_arcsec": 0.15,
            })
        without_distance = _fit_motion({"positions": positions}, None)
        self.assertAlmostEqual(without_distance["proper_motion"]["total_arcsec_per_year"], rate_arcsec_day * 365.25, delta=0.02)
        self.assertIsNone(without_distance["transverse_velocity_kms"])
        with_distance = _fit_motion({"positions": positions}, 40.0)
        self.assertAlmostEqual(with_distance["transverse_velocity_kms"], 4.74047 * rate_arcsec_day * 365.25 * 40, places=5)
        self.assertGreaterEqual(with_distance["proper_motion"]["significance_sigma"], 3)

    def test_proper_motion_is_unavailable_with_only_two_epochs(self):
        points = [
            {"observation_start": "2025-01-01T00:00:00Z", "ra_deg": 10.0, "dec_deg": 1.0, "position_uncertainty_arcsec": 0.2},
            {"observation_start": "2025-01-03T00:00:00Z", "ra_deg": 10.001, "dec_deg": 1.0, "position_uncertainty_arcsec": 0.2},
        ]
        result = _fit_motion({"positions": points}, None)
        self.assertIsNone(result["proper_motion"])
        self.assertIsNotNone(result["angular_displacement_arcsec"])

    def test_motion_endpoint_registers_and_returns_structured_tracks(self):
        epochs = [make_epoch("one", 1), make_epoch("two", 3), make_epoch("three", 5)]
        request = MotionAnalysisRequest(ra=210.80225, dec=54.34894, cutout_size_deg=0.12, epochs=epochs)
        with patch("backend.motion._get_cutout", new_callable=AsyncMock, return_value=synthetic_fits()):
            result = asyncio.run(analyze_motion(request))
        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(result["epochs"]), 3)
        self.assertGreaterEqual(len(result["tracks"]), 5)
        self.assertEqual(result["compatibility"]["calibration_level"], 2)
        self.assertEqual(result["source"], "NASA/IPAC IRSA SPHEREx spectral-image FITS cutouts")

    def test_fastapi_registers_the_motion_analysis_route(self):
        from backend.main import app
        paths = set(app.openapi()["paths"])
        self.assertIn("/api/motion/analyze", paths)


if __name__ == "__main__":
    unittest.main()
