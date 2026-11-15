# Motion Analytics · Phase 3/4 Validation

**Project:** ASCENTRA · SPHEREx Sky Chronicles  
**Validation date:** 2026-11-14  
**Status:** Motion Analytics is integrated and validated against synthetic regression fixtures and live NASA/IPAC IRSA SPHEREx data.

## Delivered

The new `/motion` page is linked from the shared navigation. It queries IRSA SIA2, lets users select compatible observation products, fetches regional FITS cutouts, detects sources, registers epochs, builds source tracks, and presents measured positions, uncertainties, local wavelength metadata, plots, and CSV/PNG exports. It also connects the existing 2026 ED138 published-astrometry and JPL Horizons benchmark.

The backend route is `POST /api/motion/analyze`. It validates that source URLs use IRSA's SPHEREx IBE path, limits cutout size and FITS bytes, retries temporary archive failures, caches small cutouts in process, and limits concurrent cutout requests. FITS processing reads the science, flags, variance, zodiacal-light, celestial WCS and approximate spectral-WCS extensions when present.

## Live IRSA exercise

IRSA SIA2 returned 44 DR1 products for the test query at ICRS `RA 210.80225°`, `Dec 54.34894°`, within 4.4–5.0 μm and 2025-05-09 through 2025-05-30. Three products were retrieved as genuine regional FITS cutouts and processed:

| Product | UTC start | Local WCS-WAVE wavelength at query | Detections |
|---|---|---:|---:|
| `2025W19_2B_0101_1` | 2025-05-09 03:33:55 | 4.85091 μm | 4 |
| `2025W19_2B_0399_1` | 2025-05-11 01:15:09 | 4.99384 μm | 4 |
| `2025W20_2D_0434_1` | 2025-05-18 02:49:22 | 4.54571 μm | 3 |

All three cutouts were 70 × 70 pixels (about 4.02 MB each). The WCS registration found 3 mutual background-source matches for each later epoch. Three image-source tracks were matched across all epochs. Their approximate local WCS-WAVE passbands did not overlap by the configured 95% criterion, so the application withheld proper-motion fits and reported **zero motion candidates**. This is the intended transparent result: broad product wavelength metadata alone did not make these epoch images comparable for a source-level motion fit.

IRSA cutout responses were intermittently unavailable during parallel requests. The backend now caps concurrent cutout retrieval at two while preserving retries. The successful validation retrieved the three real cutout files, then passed their bytes through the same FITS analysis and matching pipeline to avoid making redundant archive requests.

## Scientific method and limits

- Source peaks are detected with Photutils `DAOStarFinder`; nominal SPHEREx flag values are retained according to the [IRSA Source Discovery tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-source-discovery-tool-demo/). Variance and zodiacal-light model extensions are used when their dimensions and values are usable.
- Centroids are converted to sky coordinates with Astropy celestial WCS. Epoch registration is a robust translation from mutual WCS source matches, not a full astrometric solution. One-to-one matching uses a local tangent plane and includes centroid and registration terms in the reported positional error.
- Per-source wavelength and bandwidth use Astropy's alternate spectral WCS with spectral SIP disabled, following the [IRSA spectral-image tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/). The archive documents WCS-WAVE as an approximate visualization aid with roughly 1 nm lookup accuracy; calibration-grade spectral analysis must use the CWAVE and CBAND calibration products described in [SPHEREx Data Products](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/). ASCENTRA currently uses the approximate values only as a conservative compatibility screen; it does not claim calibrated spectra.
- Some live image headers contain SIP distortion coefficients while their CTYPE strings omit `-SIP`. Astropy reports this ambiguity. The interface now shows that warning for affected epochs. Coordinates are not checked against an external astrometric reference catalogue, and the current uncertainty model cannot fully account for this WCS systematic.
- Apparent-motion regression requires at least three matched epochs spanning at least one day, compatible approximate local passbands, and a fit significance of at least 3σ to label a track a motion candidate. A candidate is not a confirmed moving object. The supplied `0.043 arcsec/minute` benchmark remains illustrative and is not imposed on any source.
- Aperture fluxes are exploratory Jy conversions from image surface-brightness pixels when the FITS `BUNIT` supports that conversion. ASCENTRA does not use the detector ePSF for model photometry, nor does it interpret flux differences as calibrated variability.
- There is no variance-propagated, background-matched, PSF-matched difference-image product yet. Brightness changes, moving-object identities, orbital fits, and satellite candidates are therefore not asserted from these image tracks.

The 2026 ED138 endpoint was also checked against the current published astrometry and JPL Horizons: 74 parsed published rows matched predictions requested at their listed observatory sites. This is a consistency comparison against the current solution, not an independent orbit validation. A separate IRSA search at ED138's latest published position returned no matching SPHEREx product, so the interface does not imply SPHEREx coverage of ED138.

## Automated checks

| Check | Result |
|---|---|
| Python compilation | Passed |
| Backend unit and regression suite | 43 passed (`backend.test_motion` and `backend.test_main`) |
| TypeScript typecheck | Passed |
| Frontend ESLint | Passed |
| Optimized Next.js production build | Passed; `/motion` generated as a static route |
| Production route smoke check | Passed for all 9 pages; each returned HTTP 200 and included shared navigation and data attribution |
| Live IRSA SIA2 and FITS cutouts | Passed; 44 SIA rows, 3 genuine FITS cutouts processed |
| Local wavelength mismatch behavior | Passed; fit withheld for non-overlapping local passbands |
| ED138 published-astrometry / Horizons cross-check | Passed for 74 rows at their supplied observatory sites |

The route smoke check exercises production page responses and shared navigation. It does not simulate every interactive control in an automated browser.

## Prioritized remaining work

1. Integrate IRSA CWAVE/CBAND calibration data and validate spectral passband compatibility at science-analysis accuracy.
2. Resolve SPHEREx SIP/WCS behavior against external astrometric standards and replace the translation-only registration with a distortion-aware solution.
3. Use the local detector ePSF and consistent background/variance treatment for calibrated photometry, then validate fluxes against reference products.
4. Add PSF-matched, variance-aware difference imaging before presenting variability or transient candidates.
5. Add persistent shared caching and deployment-level rate limiting before multi-worker or public-scale operation.

