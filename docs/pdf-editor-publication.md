# PDF editor on DeAllSoft

The standalone «Лист PDF» editor is served at `/pdf-editor/` from `public/pdf-editor`. The homepage footer links to it alongside the mobile apps. It has its own document, scripts, styles, fonts, PDFium WASM, and local OCR assets; it does not load the engineering application or require a ChatGPT session. All document operations stay in the browser.

Imported from the editor source commit `1d746fba20ddc83306e4a4c580697231216675b0` (published version 8). The imported application and bundled third-party license notices are preserved. Only the document title and a link back to DeAllSoft were added. Future editor updates should copy the standalone directory and rerun the editor checks.

The regular Vite build copies the complete directory to `dist/pdf-editor`. Selectel's existing deployment publishes it together with the main site; no second deployment or external application hosting is required. The homepage uses a normal document link, not a React Router link, to open the standalone app. The trailing slash is required for its relative asset URLs.

Run the existing editor checks with `node scripts/pdf-editor/check-scan-and-clipboard.mjs`, `node scripts/pdf-editor/check-table-formatting.mjs`, `node scripts/pdf-editor/check-notes-and-styles.mjs`, and `node scripts/pdf-editor/check-image-transforms.mjs`. They exercise PDF saving/reopening, formatting, clipboard, scan text and image transforms against the vendored engine.
