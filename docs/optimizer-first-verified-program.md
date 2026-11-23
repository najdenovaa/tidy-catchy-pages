# First verified program before exhaustive search

A private field export reproduced the long-running catalogue search. Profiling identified repeated dense-survey axial-weight integration, repeated placement trials across target labels, and repeated radial outlet solves. The export itself and all calculated private programs remain outside the repository.

Changes:

- Reuse immutable per-well/per-mud geometry, axial tension and curvature samples while testing catalogue layouts. Cache identical local density trials and above-cement placements across target labels. Reject a prepared context when the well identity or mud density differs. Cached/uncached parity tests cover a generated 125-point survey.
- Deduplicate physically identical layouts before recalculating the full profile. Retain the existing selected target label, catalogue identity and placement result.
- Reuse a bounded exact scalar outlet-loss cache across candidate simulations. Its key includes casing diameter, bore/product geometry, flow and all hydraulic fluid parameters. This does not change the radial model or visualization profiles.
- Before the rate grid, test a small set of in-range seed rates and verify one complete programme on the original buffer compositions/volumes using the full native acceptance path. Publish only completed confirmations. Continue the normal search for quality and optional buffer boost afterward.
- Merge confirmed alternatives across stages without dropping an earlier verified programme or duplicating identical programmes. Every published snapshot has its own consistent record label.
- Stream verified alternatives to the main thread. The user can apply and stop while improvement continues. Cancellation and the independent watchdog retain verified alternatives; a preliminary-only message is never accepted as a fallback. The input data are not modified or automatically applied.
- Record first-confirmation timing in the local diagnostic export.

Validation: the existing suite passed 788 tests, and a separate component interaction test passed for applying a verified programme while search was still running. TypeScript and production builds pass. On the supplied private export the emitted worker produced its first fully confirmed programme in approximately 4.6 seconds while the main thread continued to tick. This is the measured first result on the test machine, not a guarantee of total optimization time or another computer's speed. Full search may continue until its existing runtime budget.
