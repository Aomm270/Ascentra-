"""Live smoke check for the local API and public IRSA services.

Run with the FastAPI service on http://127.0.0.1:8000, or set ASCENTRA_API_URL:
    python -m backend.smoke_check
"""

from __future__ import annotations

import io
import os

import httpx
import numpy as np
from astropy.io import fits

from backend.main import _fits_to_png

BASE = os.getenv("ASCENTRA_API_URL", "http://127.0.0.1:8000").rstrip("/")
KNOWN_DR1_POSITION = {"ra": 210.80225, "dec": 54.34894, "radius": 0.1, "release": "dr1", "limit": 20}
KNOWN_QR3_POSITION = {"ra": 210.80225, "dec": 54.34894, "radius": 0.1, "release": "qr3", "limit": 5}


def main() -> None:
    with httpx.Client(timeout=100.0) as client:
        health = client.get(f"{BASE}/api/health")
        health.raise_for_status()
        health_payload = health.json()
        assert health_payload["archive"] == "NASA/IPAC IRSA"
        assert health_payload["archive_connectivity"] == "checked per query"
        print("PASS health: API reports the configured IRSA SIA endpoint; archive reachability is tested below")

        search = client.get(f"{BASE}/api/observations", params=KNOWN_DR1_POSITION)
        search.raise_for_status()
        observations = search.json()["observations"]
        assert observations, "The known public DR1 test field returned no image products"
        observation = observations[0]
        assert observation["original_url"].startswith("https://irsa.ipac.caltech.edu/ibe/data/spherex/")
        assert observation["wavelength_min_um"] is not None and observation["wavelength_max_um"] is not None
        assert observation["release"] == "DR1"
        print(f"PASS SIA2: {len(observations)} real DR1 FITS product(s); first product {observation['product_id']}")

        qr3_search = client.get(f"{BASE}/api/observations", params=KNOWN_QR3_POSITION)
        qr3_search.raise_for_status()
        qr3_observations = qr3_search.json()["observations"]
        assert qr3_observations, "The known public QR3 test field returned no image products"
        assert all(item["release"] == "QR3" for item in qr3_observations)
        print(f"PASS SIA2: {len(qr3_observations)} real QR3 FITS product(s) returned")

        preview = client.get(
            f"{BASE}{observation['preview_url']}",
            params={"ra": KNOWN_DR1_POSITION["ra"], "dec": KNOWN_DR1_POSITION["dec"]},
        )
        if preview.status_code == 503:
            print("WARN live FITS preview: IRSA cutout service is busy; the endpoint returned a retryable 503")
        else:
            preview.raise_for_status()
            assert preview.headers.get("content-type", "").startswith("image/png")
            assert preview.content.startswith(b"\x89PNG\r\n\x1a\n")
            print(f"PASS live FITS preview: returned {len(preview.content):,} PNG bytes from an IRSA cutout")

        sample = io.BytesIO()
        fits.PrimaryHDU(np.arange(64 * 64, dtype=np.float32).reshape(64, 64)).writeto(sample)
        rendered = _fits_to_png(sample.getvalue())
        assert rendered.startswith(b"\x89PNG\r\n\x1a\n")
        print(f"PASS FITS renderer: produced a {len(rendered):,}-byte display PNG from a test image plane")

        resolved = client.get(f"{BASE}/api/resolve", params={"name": "M31"})
        resolved.raise_for_status()
        coordinates = resolved.json()
        assert abs(coordinates["ra"] - 10.6847) < 0.01 and abs(coordinates["dec"] - 41.2688) < 0.01
        print("PASS name resolver: M31 resolved through the active Sesame mirror")

        later = observations[1] if len(observations) > 1 else observation
        comparison = client.post(
            f"{BASE}/api/comparison-readiness",
            json={
                "earlier_url": observation["original_url"],
                "later_url": later["original_url"],
                "earlier_collection": observation["collection"],
                "later_collection": later["collection"],
                "earlier_band": f"{observation['wavelength_min_um']}–{observation['wavelength_max_um']}",
                "later_band": f"{later['wavelength_min_um']}–{later['wavelength_max_um']}",
                "earlier_calibration": observation["calibration_level"],
                "later_calibration": later["calibration_level"],
                "earlier_mjd": observation["start_mjd"],
                "later_mjd": later["start_mjd"],
            },
        )
        comparison.raise_for_status()
        assert comparison.json()["scientific_difference_ready"] is False
        print("PASS comparison gate: no unprocessed pixel difference is represented as a scientific result")


if __name__ == "__main__":
    main()
