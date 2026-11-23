# Optimizer runtime bounds on long strings

A previous 600 m reproduction did not cover the reported 90-minute stall at 85%. The exact failing user input was unavailable after cancellation. Added a separate 6000 m stress fixture and a deterministic budget-expiration case at the same progress point.

The final candidate confirmation previously ran report envelopes (80 depth intervals per frame), inverse safe-rate searches and repeated per-device geometric checks/outlet calculations for every fluid segment. These computations scale badly with long intervals and many devices.

- Native pressure simulation now has an explicit optimizer option. It preserves the full 50 m integration step, transport frames, actual surface/bottom pressures and every formation check. It omits report envelopes, inverse-rate curves and observation reports that are not acceptance criteria. Ordinary program/report calculations keep their existing diagnostics. A parity test compares the full forward pressure trace and all safety checks exactly.
- A per-simulation index groups identical valid tools in equal local bores. Binary range counts keep the existing `(top, bottom]` assignment; a scalar cache reuses the same physical outlet closure without recalculating radial profiles for every identical device. Invalid devices remain excluded as before. Test comparisons cover interval edges, multiple products and changed geometry.
- Candidate layouts retain only the calculated swirl influence at the existing centralization sample depths, rather than retaining all radial/wake profiles for every candidate. Full visualizations still use the ordinary model.
- The worker gets a 90-second cooperative budget with time reserved for final confirmation. Completed alternatives may be returned with an explicit incomplete-search note. Unconfirmed preliminary alternatives are never presented as complete programs.
- The main thread independently terminates the worker after 120 seconds, even if the worker is stuck inside synchronous code. Input data are not reset and unverified alternatives are not applied. Progress now names the stage and shows elapsed seconds. A time-limited empty search is described as stopped, not as proof of infeasibility.

Validation includes a 6000 m / 121-device completed alternative (about 26 s in an isolated source test; times increase under concurrent test/build load), full/optimizer forward-physics parity, exact grouped loss checks, expiration at 85%, zero-budget refusal of preliminary candidates and independent worker-watchdog cleanup. These are synthetic stress tests; they do not reconstruct the unavailable user input or guarantee a fixed duration on another computer.

Final validation: all 783 tests pass with two test workers; TypeScript and production build pass. The emitted module worker completed the 6000 m fixture in about 25.5 s, returned one fully confirmed program with 121 turbulators, and the main thread continued to tick throughout.
