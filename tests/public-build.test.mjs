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
  for (const page of ["index.html", "rfp-upload.html", "auth.html", "contact.html", "security.html", "privacy.html", "terms.html", "compliance.html", "partners.html"]) {
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
  assert.match(config, /\[functions\."compliance"\]/);
  assert.match(config, /included_files\s*=\s*\["assets\/docx-validation\.mjs"\]/);
  assert.match(config, /publish\s*=\s*"dist"/);
  assert.match(config, /command\s*=\s*"node scripts\/build-site.mjs"/);
  // RFC 9728 protected-resource metadata is published as an extensionless
  // static file (no .json, per the no-.json rule above) with its
  // Content-Type set explicitly in netlify.toml.
  assert.ok(files.includes(".well-known/oauth-protected-resource"), ".well-known/oauth-protected-resource");
  const protectedResource = JSON.parse(await readFile(new URL("dist/.well-known/oauth-protected-resource", root), "utf8"));
  assert.equal(protectedResource.resource, "https://www.tendercrestai.com/mcp");
  assert.deepEqual(protectedResource.authorization_servers, ["https://www.tendercrestai.com"]);
  assert.deepEqual(protectedResource.scopes_supported, ["mcp:read"]);
  assert.match(config, /for\s*=\s*"\/.well-known\/oauth-protected-resource"/);
  assert.match(config, /Content-Type\s*=\s*"application\/json"/);
  const hsts = config.match(/Strict-Transport-Security\s*=\s*"([^"]+)"/);
  assert.ok(hsts, "netlify.toml must set a Strict-Transport-Security header");
  assert.ok(hsts[1].includes("includeSubDomains"), "HSTS must include includeSubDomains");
  assert.ok(!hsts[1].includes("preload"), "HSTS must not include preload until the preload submission is approved");
  const csp = config.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  assert.ok(csp, "netlify.toml must set a Content-Security-Policy header");
  const policy = csp[1];
  for (const directive of ["default-src 'self'", "script-src", "style-src", "font-src", "img-src",
    "connect-src", "frame-src", "worker-src", "frame-ancestors 'none'", "form-action 'self'",
    "object-src 'none'", "base-uri 'self'"]) {
    assert.ok(policy.includes(directive), `CSP must include ${directive}`);
  }
  assert.ok(!/(^|[\s;])(\*|https:|data:|blob:)([\s;]|$)/.test(policy),
    "CSP must not use a bare wildcard or scheme wildcard");
});
