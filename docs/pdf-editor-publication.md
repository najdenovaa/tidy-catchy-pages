# PDF editor on DeAllSoft

The standalone «Лист PDF» editor is served at `/pdf-editor/` from `public/pdf-editor`. The homepage footer links to it alongside the mobile apps. It has its own document, scripts, styles, fonts, PDFium WASM, and local OCR assets; it does not load the engineering application or require a ChatGPT session. All document operations stay in the browser.

Imported from the editor source commit `1d746fba20ddc83306e4a4c580697231216675b0` (published version 8). The imported application and bundled third-party license notices are preserved. Only the document title and a link back to DeAllSoft were added. Future editor updates should copy the standalone directory and rerun the editor checks.

The regular Vite build copies the complete directory to `dist/pdf-editor`. Selectel's existing deployment publishes it together with the main site; no second deployment or external application hosting is required. The homepage uses a normal document link, not a React Router link, to open the standalone app. The trailing slash is required for its relative asset URLs.

Run the existing editor checks with `node scripts/pdf-editor/check-scan-and-clipboard.mjs`, `node scripts/pdf-editor/check-table-formatting.mjs`, `node scripts/pdf-editor/check-notes-and-styles.mjs`, and `node scripts/pdf-editor/check-image-transforms.mjs`. They exercise PDF saving/reopening, formatting, clipboard, scan text and image transforms against the vendored engine.

## Local sessions

A new browser starts with a centered upload button; the demo only opens when explicitly selected. IndexedDB retains the last document bytes, page, zoom, applied edits and any in-progress inline text/table draft. On the next visit the editor restores that snapshot before enabling file selection. Committed edits save immediately; draft edits debounce for 300 ms with a 1.5 s maximum delay, and visibility/pagehide events flush pending changes. Save errors are visible, and a failed transaction keeps the previous snapshot.

Sessions are isolated by browser profile and origin, including guests. No IP identifier, account lookup or document upload is used. People sharing the same browser profile share its local session; a different device/profile has separate storage. Clearing browser site data removes the session. A session is a recovery copy, not a replacement for downloading the PDF.

Validate the storage behavior with `npx vitest run src/lib/pdf-editor-session.test.ts`, covering reopen, profile isolation, ordered writes, failed-write recovery, unavailable storage and invalid records.
