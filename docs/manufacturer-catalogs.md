# Reagents and casing equipment - sources and calculation boundaries

Verified 2026-11-08 against https://igchem.ru/chemical and https://gk-avrora.ru/catalog/.

## Reagents

IG chemical identifies its own manufactured product range. Product identity (brand/manufacturer, TU, lot, URL) is stored separately from generic role correlations and measured laboratory results.

- IG Retard: TU 001, 0.1-0.7% BWOC, static temperature up to 100 C.
- IG FLice: TU 002, 0.2-1% BWOC. Website temperature text reads 15-18 C; no corrected upper limit is inferred.
- IG Flex: TU 003, 0.05-0.3% BWOC, stated effectiveness up to 160 C.
- IG AntiFoam (L): TU 007, starting at 0.05%, basis unspecified. No BWOC range is inferred. Not automatically introduced into foam cement.
- IG Clean (L): TU 004, starting at 5 kg/m3 wash. Site mixes powder description with liquid packaging; form and true density require lot passport.
- IG Rheology: TU 005, source says 1-10% of water volume, dimensionally ambiguous. No automatic BWOC conversion.
- MKU-85: TU 010, source says 2-20% of mixture volume. Not hollow microspheres, not quartz flour, not microcement.

All TU numbers have the common prefix 20.59.59 and suffix 30392090-2024. Bulk densities on the website are not particle/liquid true density and never populate SG. Generic SG remains explicitly assumed unless a user supplies lot-specific SG. Published dose/temperature limits generate warnings; they do not silently clamp user doses. Commercial identity does not validate forecasts or certify laboratory compliance.

Recipe selection is available in cementing and bridge design; manual product additions are available for cement and buffer inputs. RIR laboratory material selection is role-filtered, retains editable mass parts, and invalidates laboratory binding when product/manufacturer/lot changes. Product substitution clears the lot and flags the inherited SG as an assumption until confirmed. Reports retain product identity and source.

## Equipment

Official source PDFs: float equipment, simple and premium shoes, centralizers, and stage collars, linked on the manufacturer's catalog page.

- AVRORA 141-SG product page: https://gk-avrora.ru/poplavkovaja-mufta-avrora-141-sg/ - max 130 C, antirotation, optional two valves. No general backpressure is assigned: it varies by casing size.
- AVRORA 141-P Plug Up page: https://gk-avrora.ru/probka-avrora-141-%D0%BF-plug-up/ - max 120 C, no numerical bump rating published.
- Float equipment PDF (2024/04): SFF valve backpressure 35 MPa; SFF PLUS 70 MPa. These are valve-unit ratings, not every collar's limit and not forward-flow pressure loss.
- Same PDF, page 8: AVRORA-141 POLYMER PLUG DOWN diaphragm opens at 1-1.5 MPa. This range is shown, not converted to a single automatic stop setting.
- AVRORA 500S is a cement basket, not a centralizer, packer or pressure-tight barrier.

Equipment BOM supports manufacturer/model, count, casing size, OD, passage/plug working ID, thread, depth, passport and separate pressure fields. Unknown dimensions and ratings remain blank. Generic family selection does not imply size/thread/plug-seat compatibility; verification warnings remain until a passport is entered. Explicit buttons can transfer shoe and collar depth into the existing calculation inputs. Pressure limits never silently replace hydraulic stop/shear inputs. Centralizer counts use the same joint placement schedule as the report, not a second length/spacing approximation.

## Validation

Tests cover product identity round trips, true SG volume balance, published-range warnings, separate pressure meanings, equipment compatibility, RIR binding invalidation and complete DOCX content. Two old recipe tests were updated for the already merged SMS/polymer stabilizer behavior: default lightweight systems no longer require bentonite, and polymer stabilization does not guarantee zero free water.
