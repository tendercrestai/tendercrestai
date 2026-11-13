# Vendored Tesseract worker script

`worker.min.js` is a verbatim copy of
`tesseract.js@6.0.1/dist/worker.min.js`, fetched from
`https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js`.

SHA-256:
`38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842`

## Why it is vendored instead of loaded from the CDN

`assets/local-ocr.mjs` used to pass the CDN URL as `workerPath`.
tesseract.js v6 creates its worker from a `blob:` URL by default
(`workerBlobURL: true`), and the site's Content-Security-Policy
(`worker-src 'self' ...`, no `blob:`) blocks blob workers, so the OCR
engine never started and the page stuck on "Loading local English OCR
engine…". The repo's own build test forbids `blob:` in the CSP, so the
fix is to run the worker same-origin instead of weakening the CSP:
`workerBlobURL: false` with this vendored, same-origin worker script.

Only the worker script is vendored. The main `tesseract.min.js`, the
core glue (`tesseract.js-core@6.0.0`) and the English language data
still load from the version-pinned CDN, exactly as before.

## Updating

To move to a newer tesseract.js version, replace this file with the
matching `dist/worker.min.js` from that release, update the SHA-256 in
`tests/ocr-worker.test.mjs`, and update the `tesseract.min.js` version
pinned in `assets/local-ocr.mjs` to match.
