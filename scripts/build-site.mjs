import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(root, "dist");
// Explicit public files only. Never publish the repository root, server source,
// internal runbooks, SQL fixtures, credentials, or future unreviewed files.
const pages = [
  "index.html", "auth.html", "contact.html", "rfp-upload.html", "compliance.html",
  "knowledge.html", "security.html", "product.html", "samples.html", "googleb40d2fbef272897b.html", "robots.txt", "sitemap.xml"
];
const assets = [
  "rfp-upload.mjs", "rfp-document.mjs", "upload-attempt.mjs", "proposal-status.mjs",
  "docx-validation.mjs", "compliance.mjs", "compliance-model.mjs",
  "compliance-export.mjs", "compliance-handoff.mjs", "compliance.css", "knowledge.mjs", "knowledge.css", "public-pages.css"
];
await rm(destination, { recursive: true, force: true });
await mkdir(resolve(destination, "assets"), { recursive: true });
for (const page of pages) await cp(resolve(root, page), resolve(destination, page));
for (const asset of assets) {
  await cp(resolve(root, "assets", asset), resolve(destination, "assets", asset));
}

// Explicit fictional examples only; never recursively copy arbitrary documents.
const samples = [
  "fictional-rfp.txt", "fictional-company-evidence.txt",
  "illustrative-compliance-matrix.csv", "illustrative-compliance-matrix.xlsx",
  "illustrative-proposal-draft.docx", "illustrative-proposal-draft.pdf"
];
await mkdir(resolve(destination, "samples"), { recursive: true });
for (const sample of samples) await cp(resolve(root, "samples", sample), resolve(destination, "samples", sample));
