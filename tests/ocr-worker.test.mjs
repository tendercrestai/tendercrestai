import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
// SHA-256 of tesseract.js@6.0.1/dist/worker.min.js, fetched from
// https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js
const WORKER_SHA256 = "38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842";
// SHA-256 of pdfjs-dist@4.10.38/build/pdf.worker.min.mjs, fetched from
// https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs
const PDF_WORKER_SHA256 = "1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36";

test("local OCR uses a same-origin worker, never a blob or cross-origin worker", async () => {
  const source = await readFile(new URL("assets/local-ocr.mjs", root), "utf8");
  assert.match(source, /workerPath:\s*'\/assets\/vendor\/tesseract\/worker\.min\.js'/);
  assert.match(source, /workerBlobURL:\s*false/);
  assert.doesNotMatch(source, /workerPath:\s*'https?:\/\//);
  // Pinned CDN versions for the main script, core and language data are unchanged.
  assert.ok(source.includes("tesseract.js@6.0.1/dist/tesseract.min.js"));
  assert.ok(source.includes("tesseract.js-core@6.0.0"));
  assert.ok(source.includes("@tesseract.js-data/eng@1.0.0/4.0.0_best_int"));
});

test("vendored OCR worker is the pinned tesseract.js 6.0.1 worker and is published by the build", async () => {
  const worker = await readFile(new URL("assets/vendor/tesseract/worker.min.js", root));
  assert.equal(createHash("sha256").update(worker).digest("hex"), WORKER_SHA256);
  await import("../scripts/build-site.mjs");
  const published = await readFile(new URL("dist/assets/vendor/tesseract/worker.min.js", root));
  assert.equal(createHash("sha256").update(published).digest("hex"), WORKER_SHA256);
});

test("CSP keeps blob workers forbidden and allows same-origin workers", async () => {
  const config = await readFile(new URL("netlify.toml", root), "utf8");
  const csp = config.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  assert.ok(csp, "netlify.toml must set a Content-Security-Policy header");
  assert.ok(csp[1].includes("worker-src 'self'"), "CSP worker-src must allow same-origin workers");
  assert.ok(!/(^|[\s;])blob:([\s;]|$)/.test(csp[1]), "CSP must not allow blob: workers");
});

test("local OCR uses a same-origin pdf.js worker, never a cross-origin workerSrc", async () => {
  const source = await readFile(new URL("assets/local-ocr.mjs", root), "utf8");
  assert.match(source, /GlobalWorkerOptions\.workerSrc\s*=\s*'\/assets\/vendor\/pdfjs\/pdf\.worker\.min\.mjs'/);
  assert.doesNotMatch(source, /GlobalWorkerOptions\.workerSrc\s*=\s*'https?:\/\//);
  // Pinned CDN version for the main pdf.js module is unchanged.
  assert.ok(source.includes("pdfjs-dist@4.10.38/build/pdf.min.mjs"));
});

test("vendored pdf.js worker is the pinned 4.10.38 worker and is published by the build", async () => {
  const worker = await readFile(new URL("assets/vendor/pdfjs/pdf.worker.min.mjs", root));
  assert.equal(createHash("sha256").update(worker).digest("hex"), PDF_WORKER_SHA256);
  await import("../scripts/build-site.mjs");
  const published = await readFile(new URL("dist/assets/vendor/pdfjs/pdf.worker.min.mjs", root));
  assert.equal(createHash("sha256").update(published).digest("hex"), PDF_WORKER_SHA256);
});

test("CSP allows WebAssembly compilation for the OCR engine, without unsafe-eval", async () => {
  const config = await readFile(new URL("netlify.toml", root), "utf8");
  const csp = config.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  assert.ok(csp, "netlify.toml must set a Content-Security-Policy header");
  // 'wasm-unsafe-eval' permits WebAssembly.instantiate() (needed by the
  // tesseract.js core) without permitting JavaScript eval().
  assert.ok(/(^|[\s;])'wasm-unsafe-eval'([\s;]|$)/.test(csp[1]),
    "CSP script-src must include 'wasm-unsafe-eval' so the OCR engine's WebAssembly core can load");
  assert.ok(!/(^|[\s;])'unsafe-eval'([\s;]|$)/.test(csp[1]),
    "CSP must not include bare 'unsafe-eval'");
});
