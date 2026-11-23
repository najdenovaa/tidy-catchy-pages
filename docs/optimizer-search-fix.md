# Optimizer search and responsiveness

The 600 m regression fixture with a 20 l/s mixing limit reproduced the reported failure: about 25.1 s of search followed by the same rib/standoff, transitional-buffer and mixing-limit errors, with no selectable program.

Changes:

- Run the optimizer in a dedicated module worker. Forward progress, terminate on cancel/unmount, and keep calculations off the UI thread.
- Use the centralization calculator's existing depth-range argument when assessing a local pipe interval. This produces the same sampled results without recalculating the entire string for every local density trial. Deduplicate mechanically identical centralizer layouts.
- Place unmodified catalogue turbulator products in free joint slots using the calculated local standoff, sleeve length and centralizer support positions. Calculate wake decay as an output; do not demand continuous swirl coverage by installing another device after every L90 wake. Check actual geometry and axial overlap before placement.
- Independently cap cement and buffer surface stages at the mixing limit, even when a higher annular rate is desired while displacing. Keep the final process-contract guard.
- Evaluate optional buffer boost and a safe baseline program separately. Unconfirmed buffer contact/regime targets do not erase physically safe quality variants. Surface pressure, fracture/underbalance, thickening and geometric checks remain mandatory. Explain missing compatible products or available slots; never fabricate catalogue sizes or force equipment into the wall.
- Prefer the feasible complete alternatives with installed turbulators when the catalogue and geometry admit them. Preserve catalogue identity, program snapshots, reports and immutable input behavior.

Validation: 776 tests pass, TypeScript passes, production build passes. New regressions cover the reported error combination, unattainable optional boost, absent compatible turbulators, slot geometry/collisions and worker cancellation. The actual emitted worker bundle was executed with the regression input in an isolated worker: two feasible programs, 30/10 turbulators, about 7.7 s with the default rate grid while the main thread continued to tick. This is a test-machine measurement, not an iPhone timing guarantee. A headless browser launch in this environment was blocked by its socket permissions, so the emitted bundle was validated in an isolated Node worker with the Web Worker message bridge instead.
