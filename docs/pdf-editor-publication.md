# PDF editor on DeAllSoft

The standalone «Лист PDF» editor is served at `/pdf-editor/` from `public/pdf-editor`. The homepage footer links to it alongside the mobile apps. It has its own document, scripts, styles, fonts, PDFium WASM, and local OCR assets; it does not load the engineering application or require a ChatGPT session. All document operations stay in the browser.

Imported from the editor source commit `1d746fba20ddc83306e4a4c580697231216675b0` (published version 8). The imported application and bundled third-party license notices are preserved. Only the document title and a link back to DeAllSoft were added. Future editor updates should copy the standalone directory and rerun the editor checks.

The regular Vite build copies the complete directory to `dist/pdf-editor`. Selectel's existing deployment publishes it together with the main site; no second deployment or external application hosting is required. The homepage uses a normal document link, not a React Router link, to open the standalone app. The trailing slash is required for its relative asset URLs.

Run the existing editor checks with `node scripts/pdf-editor/check-scan-and-clipboard.mjs`, `node scripts/pdf-editor/check-table-formatting.mjs`, `node scripts/pdf-editor/check-notes-and-styles.mjs`, and `node scripts/pdf-editor/check-image-transforms.mjs`. They exercise PDF saving/reopening, formatting, clipboard, scan text and image transforms against the vendored engine.

## Local sessions

A new browser starts with a centered upload button; the demo only opens when explicitly selected. IndexedDB retains the last document bytes, page, zoom, applied edits and any in-progress inline text/table draft. On the next visit the editor restores that snapshot before enabling file selection. Committed edits save immediately; draft edits debounce for 300 ms with a 1.5 s maximum delay, and visibility/pagehide events flush pending changes. Save errors are visible, and a failed transaction keeps the previous snapshot.

Sessions are isolated by browser profile and origin, including guests. No IP identifier, account lookup or document upload is used. People sharing the same browser profile share its local session; a different device/profile has separate storage. Clearing browser site data removes the session. A session is a recovery copy, not a replacement for downloading the PDF.

Validate the storage behavior with `npx vitest run src/lib/pdf-editor-session.test.ts`, covering reopen, profile isolation, ordered writes, failed-write recovery, unavailable storage and invalid records.

## Office fonts

The office group now exposes Times New Roman, Arial, Arial Narrow, Calibri and Courier New. Each option explicitly identifies its actual substitute until original local font files are connected: Liberation Serif, Liberation Sans, Roboto Condensed, Carlito and Liberation Mono respectively. Roboto Condensed is a narrow visual alternative, not an exact Arial Narrow metrics match. Existing font indices are preserved for saved PDF metadata and sessions.

The Fonts dialog can connect installed fonts through the browser's user-initiated Local Font Access permission or selected TTF files. Originals stay in the browser's separate IndexedDB store and are loaded before session restoration; they are not uploaded or distributed by the server. The same face bytes are used for CSS measurement and PDF embedding, with per-style labels when only part of a family is available. Restricted embedding flags and unsupported formats are rejected. Connecting a family invalidates its previous engine face/metrics cache without altering existing PDF objects.

Roboto Condensed static faces were instantiated at weights 400 and 700 from Google Fonts variable fonts (upright and italic), with the upstream OFL notice included. `check-office-fonts.mjs` checks all 20 office family/style combinations with Cyrillic after PDF save/reopen. `pdf-office-fonts.test.ts` covers original font import, persistence, partial family labels, restricted embedding and malformed/unsupported inputs.

## Text field geometry

Inline text fields, including OCR scan replacements, have a move grip, a horizontal resize handle, a width input in millimeters, and an expand-to-right-margin action. Arrow keys on the handles support movement/width adjustment (Shift increases the step). Height follows the wrapped text. Changes remain part of the serializable inline draft, so session recovery retains them before Apply.

Moving a recognised scan replacement changes its origin/baseline but preserves the original raster erasure rectangle. The edit preview masks that old region separately. On PDF reopen, the layout bounds come from text objects, excluding the old erasure path, so repeated movements do not jump back to the original scan location. Geometry and native save/reopen checks are in `pdf-text-box.test.ts` and `check-text-box-geometry.mjs`.

## DOCX Cyrillic and OCR font sizes

Word export maps browser font families to standard office families (Arial, Times New Roman, Calibri, Courier New or Arial Narrow), with explicit Unicode run font assignments, Russian language, default styles and a font table. This avoids depending on a recipient having the editor's web fonts installed. Font shapes can differ from the PDF; this is still an editable, reflowing Word conversion rather than a layout-identical reconstruction.

OCR font size comes from its stored scan-cover nominal size. Other PDF text uses the vertical matrix scale rather than horizontal glyph stretching. Native OCR normally stretches glyphs to fit recognition boxes; interpreting that horizontal scale as Word font height made signatures and short lines excessively large.

`pdf-word-export.test.ts` checks Unicode, office declarations, OCR size and stretched ordinary text. `check-word-export.mjs` reproduces the issue with a native stretched PDFium OCR layer and validates DOCX output. Optional `PDF_WORD_QA_DIR` writes a synthetic test DOCX for LibreOffice rendering. The resulting rendered test has readable Cyrillic, one page and 9pt text. Microsoft Word and the user's original PDF were not available for that visual check.

## Fragmented paragraphs and font recovery

Paragraph grouping normalizes PDF subset prefixes in internal font names while preserving style and size boundaries. A font subset and its full-name counterpart can therefore belong to the same paragraph; all old word objects are removed when the paragraph is replaced. Downstream reflow includes both added text height and manual vertical movement of the text field.

Browser text measurement loads FontFace objects from the same bytes used for PDF embedding. Office aliases reuse already loaded core font faces instead of issuing duplicate asset requests. A failed selected font explicitly switches to its bundled substitute when possible; otherwise the toolbar offers retry without losing the draft. Stale font requests cannot overwrite a later selection.

Regression checks cover fragmented fonts, style boundaries, field reflow, exact font bytes, failed-font recovery and retry. A private two-page source also passed native PDF save/reopen: the whole fragmented paragraph was replaced without remnants and the following text moved down by the added height. The private source and generated output are excluded from the repository.
