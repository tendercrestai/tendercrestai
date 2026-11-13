import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {generateTeardowns,addSitemapRoutes} from "./lib/teardowns.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(root, "dist");
// Explicit public files only. Never publish the repository root, server source,
// internal runbooks, SQL fixtures, credentials, or future unreviewed files.
const pages = [
  "nyc-opportunities.html", "bid-check.html", "shredder.html", "opportunities.html", "compare-responsive.html", "compare-loopio.html", "ocr.html", "index.html", "auth.html", "contact.html", "rfp-upload.html", "compliance.html",
  "workspace.html", "knowledge.html", "security.html", "privacy.html", "terms.html", "product.html", "samples.html", "demo.html", "pricing.html", "googleb40d2fbef272897b.html", "robots.txt", "sitemap.xml"
];
const assets = [
  "nyc-opportunities.mjs", "bid-check.mjs", "teardowns.mjs", "free-tools.css", "free-tools.mjs", "product-film.css", "product-film.mjs", "openai-pixel.mjs", "google-ads.mjs", "rewardful.mjs",
  "local-ocr.mjs", "customer-hub.mjs", "customer-request.mjs", "auth-journey.mjs", "account-usage.mjs", "analytics.mjs", "customer-workspace.mjs", "interactive-demo.mjs", "demo-data.mjs", "workspace.mjs", "workspace.css", "private-rfp-upload.mjs", "rfp-upload.mjs", "rfp-document.mjs", "upload-attempt.mjs", "proposal-status.mjs",
  "docx-validation.mjs", "compliance.mjs", "compliance-model.mjs",
  "compliance-export.mjs", "compliance-handoff.mjs", "compliance.css", "knowledge.mjs", "knowledge.css", "public-pages.css"
];
await rm(destination, { recursive: true, force: true });
await mkdir(resolve(destination, "assets"), { recursive: true });
function decorateHTML(html, page) {
  if (/<body\b/i.test(html)) {
    html = html.replace(/<\/head>/i, `<template id="rewardful-tracking"><script>(function(w,r){w._rwq=r;w[r]=w[r]||function(){(w[r].q=w[r].q||[]).push(arguments)}})(window,'rewardful');</script>
<script async src="https://r.wdfl.co/rw.js" data-rewardful="bbbf92"></script></template><script type="module" src="/assets/rewardful.mjs"></script></head>`);
    if (['index.html','demo.html'].includes(page)) html = html.replace(/<\/body>/i, '<script type="module" src="/assets/openai-pixel.mjs"></script><script type="module" src="/assets/google-ads.mjs"></script></body>');
    if (process.env.ANALYTICS_ENABLED === 'true') html = html.replace(/<html\b/i, '<html data-usage-analytics="enabled"');
    html = html.replace(/<\/body>/i, '<script type="module" src="/assets/analytics.mjs"></script></body>');
  }
  return html;
}
for (const page of pages) {
  await cp(resolve(root, page), resolve(destination, page));
  if (page.endsWith('.html')) {
    const html = await readFile(resolve(destination, page), 'utf8');
    await writeFile(resolve(destination, page), decorateHTML(html, page));
  }
}
const generatedRoutes = await generateTeardowns(root, destination, decorateHTML,{includeDrafts:process.env.TEARDOWN_REVIEW_PREVIEW==='true'});
const sitemap = await readFile(resolve(destination, 'sitemap.xml'), 'utf8');
await writeFile(resolve(destination, 'sitemap.xml'), addSitemapRoutes(sitemap, generatedRoutes));
for (const asset of assets) {
  await cp(resolve(root, "assets", asset), resolve(destination, "assets", asset));
}

await mkdir(resolve(destination,"assets/social"),{recursive:true});
await cp(resolve(root,"assets/social/og-default.png"),resolve(destination,"assets/social/og-default.png"));

// Vendored Tesseract worker script (same-origin worker; the site CSP forbids
// blob: workers, and tesseract.js defaults to a blob worker, which left the
// OCR page stuck on "Loading local English OCR engine…"). The worker file is
// a verbatim copy of tesseract.js@6.0.1/dist/worker.min.js; see
// assets/vendor/tesseract/README.md. Only the worker script is vendored;
// the core and language data still load from the version-pinned CDN.
await mkdir(resolve(destination, "assets/vendor/tesseract"), { recursive: true });
await cp(resolve(root, "assets/vendor/tesseract/worker.min.js"), resolve(destination, "assets/vendor/tesseract/worker.min.js"));

// Vendored pdf.js worker script (same-origin module worker; pdf.js wraps a
// cross-origin workerSrc in a blob: URL, which the site CSP forbids, so the
// CDN workerSrc fell back to the main-thread fake worker on every OCR run).
// The worker file is a verbatim copy of
// pdfjs-dist@4.10.38/build/pdf.worker.min.mjs; see assets/vendor/pdfjs/README.md.
// Only the worker script is vendored; the main pdf.min.mjs module still
// loads from the version-pinned CDN.
await mkdir(resolve(destination, "assets/vendor/pdfjs"), { recursive: true });
await cp(resolve(root, "assets/vendor/pdfjs/pdf.worker.min.mjs"), resolve(destination, "assets/vendor/pdfjs/pdf.worker.min.mjs"));

// Only reviewed, fictional public media; renderer sources and private recordings stay excluded.
await mkdir(resolve(destination,"assets/product-film"),{recursive:true});
for(const media of ["overview.mp4","poster.webp","overview.vtt"])
  await cp(resolve(root,"assets/product-film",media),resolve(destination,"assets/product-film",media));

// Explicit fictional examples only; never recursively copy arbitrary documents.
const samples = [
  "fictional-rfp.txt", "fictional-company-evidence.txt",
  "illustrative-compliance-matrix.csv", "illustrative-compliance-matrix.xlsx",
  "illustrative-proposal-draft.docx", "illustrative-proposal-draft.pdf",
  "fictional-workspace-package.zip", "workspace-evidence.png", "workspace-editor.png", "workspace-review.png", "evaluation-scorecard.csv"
];
await mkdir(resolve(destination, "samples"), { recursive: true });
for (const sample of samples) await cp(resolve(root, "samples", sample), resolve(destination, "samples", sample));

// Vulnerability disclosure file; copied explicitly like the other public files above.
await mkdir(resolve(destination, ".well-known"), { recursive: true });
await cp(resolve(root, ".well-known", "security.txt"), resolve(destination, ".well-known", "security.txt"));
