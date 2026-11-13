# Vendored pdf.js worker script

`pdf.worker.min.mjs` is a verbatim copy of
`pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`, fetched from
`https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`.

SHA-256:
`1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36`

## Why it is vendored instead of loaded from the CDN

`assets/local-ocr.mjs` used to point `pdfjs.GlobalWorkerOptions.workerSrc`
at the CDN URL. pdf.js wraps a cross-origin worker source in a same-origin
`blob:` URL (`_createCDNWrapper`), and the site's Content-Security-Policy
(`worker-src 'self' ...`, no `blob:`) blocks blob workers, so pdf.js fell
back to its main-thread fake worker on every OCR run (and logged a CSP
violation). The repo's own build test forbids `blob:` in the CSP, so the
fix is to run the worker same-origin instead of weakening the CSP: this
vendored, same-origin worker script is loaded directly as a module worker.

Only the worker script is vendored. The main `pdf.min.mjs` module still
loads from the version-pinned CDN, exactly as before.

## Updating

To move to a newer pdfjs-dist version, replace this file with the
matching `build/pdf.worker.min.mjs` from that release, update the SHA-256
in `tests/ocr-worker.test.mjs`, and update the `pdf.min.mjs` version
pinned in `assets/local-ocr.mjs` to match.
