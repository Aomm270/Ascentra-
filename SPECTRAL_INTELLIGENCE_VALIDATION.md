# Spectral Intelligence and Catalogue Cross-Match Validation

**Validation date:** 2026-11-14  
**Scope:** Phase 5 spectral data, Phase 6 catalogue identification, and Phase 7 integration with the existing motion analytics workflow.

## Implemented

- Added a real DR1 All-Sky Cube profile endpoint. It reads the FITS WCS, the `SPECTRAL_CHANNELS` table, and selected pixel values from `IMAGE`, `NHITS`, and `FLAGS`.
- Uses HTTP byte ranges for FITS headers, the small wavelength table, and per-channel pixel samples. It never fetches the full cube tile; range responses are size-bounded, checked against their requested offsets, retried for transient failures, and rejected if IRSA ignores the Range request.
- Maps the requested ICRS coordinate through the 2D celestial HPX WCS, excluding the cube's separate `WAVE-TAB` axis. Returns all 102 measured wavelength centers/edges from the file's table. Blank channels 51 and 52 are represented as missing.
- The Spectral Explorer now plots real per-channel surface-brightness samples and shows the selected wavelength, pixel offset, NHITS, FLAGS, source product, and retrieval time. The main sky viewer routes All-Sky Cube products to this interface rather than trying to render a non-cutout cube as an image.
- Added IRSA Gator positional matching for 2MASS PSC, AllWISE, and Gaia DR3. The Motion Analytics ledger can query the selected image-detected track position and displays returned coordinates, great-circle separations, selected survey photometry/astrometry, and the original Gator query link.
- Added a direct link from a measured motion track to its coordinate in the Spectral Explorer. Existing observation timing, matching, registration, and motion calculations remain in `backend/motion.py` and were not duplicated.
- Added bounded process-local caches and coverage for the new APIs. No new Python or JavaScript packages were added.

## Scientific interpretation and limits

The All-Sky Cube `IMAGE` plane is surface brightness in MJy/sr. ASCENTRA reports the nearest cube pixel at each channel; it does not call that value a source flux or calibrated source spectrum. The cube contains no per-pixel variance plane. The profile is not background-subtracted, aperture-integrated, or PSF-fitted. NHITS and FLAGS are returned without silently masking flagged values.

Catalogue matches are provisional positional cross-matches. They are ordered by angular separation only. The service does not combine brightnesses from different survey filters, epochs, calibrations, or resolutions into a match probability. The result is evidence for review, not a confirmed identity.

The existing motion module still reports local detections and candidate tracks. This phase does not add calibrated variability, a variance-propagated difference image, PSF-matched subtraction, periodicity analysis, orbit fitting, or independent source verification. Comparing full source-integrated spectra between multiple detected sources is also not available from this cube-pixel sampler.

## Tests and live checks

- The 51 backend tests passed, including FITS channel-table decoding, the two documented blank channels, celestial WCS handling, safe cube URL registration, validated multipart byte ranges, refusal to download a full response when Range is ignored, great-circle catalogue ranking, existing motion tests, and the new timeout retry test.
- `python -m compileall -q backend`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed. The production-route smoke check passed all nine routes against the fresh build on port 3001. The first smoke attempt targeted a pre-existing service on port 3000 that returned 404 for `/motion`; the isolated production build rendered `/motion` successfully.
- A real DR1 All-Sky Cube product at the sample field returned a 320,909,760-byte FITS length. The new profile endpoint used selective byte ranges and returned 102 rows, with channels 51 and 52 marked blank. At the tested coordinate it sampled pixel (403, 400); the returned channel 1 value was 5.618226 MJy/sr with NHITS 5 and FLAGS 2097152. This value is an example raw cube-pixel surface brightness, not source photometry.
- A live Gator query returned 2 2MASS PSC, 1 AllWISE, and 14 Gaia DR3 nearby rows for the test coordinate. Nearest separations were about 0.156, 0.563, and 0.096 arcsec respectively. They remain positional matches, not confirmed identities.
- IRSA SIA2 timed out during repeated final live checks for the All-Sky Cube query (two 30-second reads). The API returns a visible 504 response and retries one timeout. The cube sampler itself was separately validated against a product URL returned by the public SIA service during the live archive check. SIA availability remains an external dependency and should be rechecked when IRSA is responsive.

## Operational notes

- Search the `DR1 All-Sky Cube` collection first. The product identifier is registered from SIA's returned `access_url` for this backend process; then the profile route can sample that product.
- The cube collection is already homogeneous, so its SIA query uses the collection and spatial position without image-only `DPTYPE`/`FORMAT` predicates. Spectral-image collections remain constrained to `DPTYPE=image` and `FORMAT=image/fits`.
- In-process cache entries expire after 30 minutes and are lost on restart. A multi-worker deployment needs a shared cache or sticky routing if it should share registered SIA product IDs and computed profiles.
