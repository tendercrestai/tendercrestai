import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(root, "dist");
// Explicit public files only. Never publish the repository root, server source,
// internal runbooks, SQL fixtures, credentials, or future unreviewed files.
const pages = [
  "ocr.html", "index.html", "auth.html", "contact.html", "rfp-upload.html", "compliance.html",
  "workspace.html", "knowledge.html", "security.html", "product.html", "samples.html", "demo.html", "googleb40d2fbef272897b.html", "robots.txt", "sitemap.xml"
];
const assets = [
  "product-film.css", "product-film.mjs",
  "local-ocr.mjs", "customer-hub.mjs", "customer-request.mjs", "auth-journey.mjs", "account-usage.mjs", "analytics.mjs", "customer-workspace.mjs", "interactive-demo.mjs", "demo-data.mjs", "workspace.mjs", "workspace.css", "private-rfp-upload.mjs", "rfp-upload.mjs", "rfp-document.mjs", "upload-attempt.mjs", "proposal-status.mjs",
  "docx-validation.mjs", "compliance.mjs", "compliance-model.mjs",
  "compliance-export.mjs", "compliance-handoff.mjs", "compliance.css", "knowledge.mjs", "knowledge.css", "public-pages.css"
];
await rm(destination, { recursive: true, force: true });
await mkdir(resolve(destination, "assets"), { recursive: true });
for (const page of pages) {
  await cp(resolve(root, page), resolve(destination, page));
  if (page.endsWith('.html')) {
    let html = await readFile(resolve(destination, page), 'utf8');
    if (/<body\b/i.test(html)) {
      if (process.env.ANALYTICS_ENABLED === 'true') html = html.replace(/<html\b/i, '<html data-usage-analytics="enabled"');
      html = html.replace(/<\/body>/i, '<script type="module" src="/assets/analytics.mjs"></script></body>');
      await writeFile(resolve(destination, page), html);
    }
  }
}
for (const asset of assets) {
  await cp(resolve(root, "assets", asset), resolve(destination, "assets", asset));
}

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
