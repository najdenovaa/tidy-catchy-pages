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
