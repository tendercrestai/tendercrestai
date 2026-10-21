import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
test("public build excludes internal source and preserves public module dependencies", async () => {
  await import("../scripts/build-site.mjs");
  const files = await readdir(new URL("dist/", root), { recursive: true });
  for (const file of files) {
    assert.ok(!/(^|\/)(netlify|supabase|docs|tests|scripts|work|\.git)(\/|$)/.test(file), file);
    assert.ok(!/\.(sql|md|json|toml)$/.test(file), file);
  }
  for (const page of ["index.html", "rfp-upload.html", "auth.html", "contact.html", "security.html", "compliance.html"]) {
    assert.ok(files.includes(page), page);
  }
  for (const asset of ["assets/docx-validation.mjs", "assets/compliance.mjs", "assets/compliance.css",
    "assets/compliance-model.mjs", "assets/compliance-export.mjs", "assets/compliance-handoff.mjs"]) {
    assert.ok(files.includes(asset), asset);
  }
  for (const file of files.filter(file => /\.(html|mjs)$/.test(file))) {
    const source = await readFile(new URL("dist/" + file, root), "utf8");
    for (const match of source.matchAll(/(?:["'])(\/assets\/[^"']+|\.\/[^"']+\.mjs)["']/g)) {
      const dependency = new URL(match[1].startsWith("/") ? "." + match[1] : match[1],
        match[1].startsWith("/") ? new URL("dist/", root) : new URL("dist/" + file, root));
      await readFile(dependency);
    }
  }
  const config = await readFile(new URL("netlify.toml", root), "utf8");
  assert.match(config, /included_files\s*=\s*\["assets\/docx-validation\.mjs"\]/);
  assert.match(config, /publish\s*=\s*"dist"/);
  assert.match(config, /command\s*=\s*"node scripts\/build-site.mjs"/);
});
