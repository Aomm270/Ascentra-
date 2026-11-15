# ASCENTRA Final Integration & Quality Assurance Report

**Run date:** 15 November 2026  
**Scope:** Integration and quality assurance of the existing ASCENTRA project. Existing modules and prior validation reports were retained.

## Overall result

The production frontend builds and all 12 application routes render. The seven-chapter home journey, scientific research navigation, comparison handoff and Cosmic Explorer research handoff were exercised. A reproducible mobile overflow in the research/comparison viewer was corrected.

Local checks pass. Live SPHEREx archive retrieval could not be confirmed in this run: IRSA SIA2 returned an upstream timeout through the API, which correctly surfaced as HTTP 504. The app therefore must not be described as having completed a fresh live-observation workflow in this QA run.

## Existing architecture retained

- Next.js 15, React 19 and TypeScript frontend with the existing dark astronomical design system.
- FastAPI backend for IRSA SIA2, FITS previews and metadata, spectral sampling, catalogue context, motion analysis and JPL/Horizons endpoints.
- No required application database; local Cosmic Explorer progress remains in browser storage. Existing API and scientific modules were not replaced.
- Public NASA/IPAC IRSA observations remain the source for archive-backed results. Procedural Cosmic Explorer scenes remain explicitly identified as simulations.

## Integration refinements

- The home page now follows the requested seven chapters: The Unknown, The Observatory, The Observations, Decoding the Cosmos, Time and Motion, The Discoveries, and Beyond the Screen. Chapter anchors and forward links allow visitors to move through or directly jump around the story.
- Research-to-comparison navigation preserves RA, Dec, search radius, release, wavelength band and date filters, then reruns that search on the comparison page. The field-investigation link carries the current coordinates and target.
- Shared navigation now resolves one active link for the research route and closes its mobile menu after route changes, including browser history navigation.
- Cosmic Explorer keeps its own navigation and save state. Quality changes preserve the camera pose; idle flight updates no longer trigger redundant progress writes. On reaching a catalogued destination, the in-simulation briefing displays source-linked NASA facts and labels the environment as procedural. A scientific handoff carries catalogued coordinates into Object Investigator.
- Object Investigator now rejects non-finite coordinates before submitting them.
- The mobile research/comparison viewer header now wraps its coordinate readout instead of widening the page.
- The Python live smoke check accepts `ASCENTRA_API_URL`; README setup notes reflect the workspace API port.

## Bugs found and fixed

| Priority | Finding | Resolution |
|---|---|---|
| High | The landing journey had six numbered chapters and no distinct observation/archive chapter. | Added the seventh chapter and chapter navigation without replacing the established sections. |
| High | Compare and investigator handoffs discarded selected sky-search context. | Added URL-based context transfer and automatic comparison search. Verified with QA-only mocked archive responses. |
| Moderate | A research navigation state could mark both the research page and its observatory anchor active. | Active navigation now selects a single matching item. |
| Moderate | Changing Cosmic Explorer graphics quality recreated the scene at the origin. | The renderer now restores camera position, rotation and field of view. |
| Moderate | The research/comparison viewer overflowed horizontally on a 390 px viewport. | Viewer header/readout wraps; measured page width now remains 390 px. |
| Moderate | `NaN` coordinates could pass the investigator’s range checks. | Added finite-number validation. |
| Minor | The backend smoke script assumed port 8000 although this workspace API uses port 8001. | Added an environment-configurable API base URL. |
| Minor | Idle Cosmic Explorer HUD frames could cause unchanged progress state updates. | State updates now return the prior object when progress is unchanged. |

## Tests and browser checks

| Check | Result |
|---|---|
| `pnpm lint` | Pass, no warnings or errors. |
| `pnpm typecheck` | Pass. |
| `pnpm build` | Pass; optimized production build generated all 12 routes. |
| `pnpm test:smoke` | Pass for all 12 routes, shared navigation and NASA/IPAC footer attribution. |
| Python `unittest` suite | Pass: 51 tests covering API validation, FITS rendering, WCS, motion, spectral cube reading, catalogue ranking, TNO parsing and error cases. |
| Python `compileall` | Pass. |
| Local API health | Pass; reports NASA/IPAC IRSA as the configured archive and notes that reachability is checked per query. |
| Direct route responses | Pass: all 12 routes returned HTTP 200. |
| Browser journey | Pass: home → research → Cosmic Explorer → browser Back/Forward; research active navigation was singular. |
| Comparison handoff | Pass using an explicitly QA-only mocked response: selected coordinates/release/filter context appeared in `/compare`, which automatically reran the query. No mock response was stored or presented as NASA data. |
| Cosmic Explorer interaction | Pass: WebGL canvas rendered; a mobile movement control changed flight position; graphics-quality change preserved range; course to M42 reached arrival; NASA-linked briefing facts displayed; scan completed the Nebula Expedition mission; scientific handoff opened Object Investigator with M42 coordinates; mission progress persisted across the research route. The isolated test profile’s original save was restored after the check. |
| Responsive/reduced motion | Pass at 390 px with reduced motion enabled on home, Cosmic Explorer, research, comparison, spectral and investigator routes. No horizontal overflow; touch flight controls were present. Mobile navigation opened and its route behavior was exercised. |

The Python suite emits Astropy’s SIP/CTYPE warning from a deliberate ambiguity test fixture. The motion pipeline reports that ambiguity rather than suppressing it.

## External data validation and limitations

- Local `/api/health` succeeded, but this only verifies the local service configuration.
- The current live SIA2 check for the known DR1 region returned HTTP 504 after waiting on the upstream archive. Consequently, DR1 observation retrieval, QR3 retrieval, live cutout preview, and live comparison could not be verified in this run. The API returned the error instead of presenting an empty sky or invented observation.
- The comparison route’s context handoff was tested with clearly QA-only fixture data because live IRSA was unavailable. It does not establish that a live observation pair is currently retrievable or scientifically comparable.
- The 51 backend unit tests mock external services where appropriate; they validate parsing, coordinate, processing and failure behavior, not current external-service availability.
- Discovery Centre correctly remains empty until a verified candidate set exists. No discovery was fabricated.
- Prior scientific validation documents remain the reference for product-specific limits, including the absence of a registered science difference map and the distinction between sampled cube surface brightness and calibrated source photometry.
- Public archive access does not require user credentials. IRSA, JPL/Horizons, Sesame and linked NASA pages remain dependent on their public service availability. No external credentials were used or exposed.

## Prioritized remaining work

1. Re-run the live IRSA check when SIA2 responds; verify real DR1 and QR3 records, product URLs and cutout retrieval.
2. With a live compatible pair, verify the backend’s metadata gate and image previews end to end. A readiness result must not be described as a registered/calibrated difference map.
3. Repeat the spectral cube profile and catalogue/motion workflows against live archive results after the archive is reachable; retain their existing uncertainty and provenance reporting.
4. Perform manual checks on physical iOS/Android devices, screen readers and additional browsers. This run used headless Chrome device emulation, not physical devices.

## Delivery status

The final integration/build is ready for local use. Production build and local route checks pass. Live archive access is the outstanding external dependency, so full scientific end-to-end acceptance remains pending that service response.
