# ASCENTRA Phase 2 — Image Rendering Validation

Validated 14 November 2026 against the current local build and the public NASA/IPAC IRSA archive.

## Result

The existing FITS preview path now supports selectable display stretches, adjustable percentile cuts and contrast, explicit FITS-plane selection, retained image metadata, and WCS-based coordinate inspection. The scientific pixel array is used only to create a clearly labelled display product; the original FITS URL remains available for analysis.

## Rendering path

1. The API searches IRSA SIA2 and validates the archive product URL against the SPHEREx IRSA host and path allowlist.
2. It requests a regional FITS cutout, caps downloaded products at 35 MB, and retries transient 429/502/503/504 responses up to three times.
3. It caches cutout bytes independently from display settings, so a new stretch or percentile cut can reuse the same FITS response. In-memory caches have byte and entry limits.
4. Astropy reads the FITS product and chooses a `SCI`, `SCIENCE`, or `IMAGE` HDU when present. Invalid values are excluded from display scaling, oversized planes are rejected, and multi-plane data can be inspected by plane index.
5. The preview applies user-selected percentile cuts, contrast, and linear, logarithmic, square-root, or asinh transfer to a false-colour PNG. The display is capped at 1024 × 1024 pixels and does not rewrite or modify FITS values.
6. Response metadata includes FITS dimensions, plane and extension information, units, finite/invalid counts, data range, background median and MAD, display cuts, WCS, and pixel scale. WCS-backed pixel readout and coordinate-grid paths are computed by Astropy.

The viewer derives the displayed cutout footprint from its WCS pixel scale and dimensions. Archive-reported field footprint and reference coordinates are shown separately from the cutout's actual WCS center.

## Verification

- Python regression suite: **28 tests passed**. Coverage includes SIA2 field mapping, query validation, all four stretches, percentile validation and metadata, integer blank pixels, cube-plane selection and blank-plane handling, WCS conversion/grid generation, caching across display changes, IRSA URL validation, and comparison safeguards.
- Python bytecode compilation: passed.
- Frontend lint and TypeScript typecheck: passed.
- Next.js production build: passed; all eight routes were statically generated.
- Frontend route smoke check: all eight routes returned HTTP 200 with shared navigation and footer attribution.
- Live IRSA integration check: DR1 returned 20 products and QR3 returned 5 products at the known test field; the DR1 cutout rendered to an 8,314-byte PNG. Sesame resolved M31, and the comparison gate did not claim an unprocessed difference image.
- Browser integration check: the real product `2025W19_2B_0101_1` rendered as a 70 × 70 FITS cutout with `IMAGE` science extension, `MJy / sr` units, 6.164 × 6.151 arcsec/pixel scale, celestial TAN-SIP WCS, and seven reported FITS extensions. The interface showed a 7.2′ × 7.2′ cutout and its WCS center separately from the archive's 3.485° footprint/reference coordinates.

## Scientific boundaries and remaining work

- Percentile stretch, contrast, and false colour change only the browser display. Use the original FITS for quantitative pixel work.
- The viewer does not apply new calibration, variance propagation, background matching, PSF matching, or image registration. The difference-map view remains explicitly unavailable because direct pixel subtraction would be misleading without those steps.
- WCS overlays are omitted when the FITS cutout does not contain usable celestial WCS. The coordinate grid and click readout depend on the cutout header.
- SIA2 may truncate large searches; the UI reports the returned limit and asks users to narrow their search. The 80-result limit is not archive completeness.
- The DR1 All-Sky Cube collection is queryable, but cube cutout availability depends on IRSA. If a cutout cannot be returned or a selected plane has no finite pixels, the preview fails transparently and retains the original FITS link. A plane index is not presented as a wavelength; read channel mapping from the original cube metadata. Published channels 51 and 52 are blank.
- Caches are process-local. Multi-worker deployment should use a shared cache; larger products are intentionally not sent to the browser.
- This phase improves visualization and data transparency; it does not add an object-detection or discovery pipeline.

## Sources

- [IRSA SPHEREx data access and SIA2 collections](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/)
- [SPHEREx FITS data products and cube layout](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/)
- [IRSA SPHEREx cutout service](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html)
- [IRSA SIA documentation](https://irsa.ipac.caltech.edu/ibe/sia.html)
