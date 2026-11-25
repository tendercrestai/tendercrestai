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
  for (const page of ["index.html", "rfp-upload.html", "auth.html", "contact.html", "security.html", "privacy.html", "terms.html", "compliance.html", "partners.html", "affiliates.html", "about.html"]) {
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
  assert.ok(files.includes("favicon.ico"), "favicon.ico");
  const protectedResource = JSON.parse(await readFile(new URL("dist/.well-known/oauth-protected-resource", root), "utf8"));
  assert.equal(protectedResource.resource, "https://www.tendercrestai.com/mcp");
  assert.deepEqual(protectedResource.authorization_servers, ["https://www.tendercrestai.com"]);
  assert.deepEqual(protectedResource.scopes_supported, ["mcp:read"]);
  // llms.txt files for AI search and citation (Nov 20, 2026): plain .txt, so
  // the no-.json rule above still holds and no Content-Type header is needed.
  assert.ok(files.includes("llms.txt"), "llms.txt");
  assert.ok(files.includes("llms-full.txt"), "llms-full.txt");
  const homepage = await readFile(new URL("dist/index.html", root), "utf8");
  assert.match(homepage, /"@type":"SoftwareApplication"/);
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

test("website redesign: affiliates and about pages, shared chrome, pricing table, single consent banner", async () => {
  await import("../scripts/build-site.mjs");
  const files = await readdir(new URL("dist/", root), { recursive: true });
  for (const page of ["affiliates.html", "about.html"]) assert.ok(files.includes(page), page);
  assert.ok(files.includes("assets/site-chrome.css"), "assets/site-chrome.css");
  assert.ok(files.includes("assets/consent-banner.mjs"), "assets/consent-banner.mjs");

  const affiliates = await readFile(new URL("dist/affiliates.html", root), "utf8");
  assert.match(affiliates, /Become a TenderCrest AI partner/);
  assert.match(affiliates, /20% of each of their first 12 monthly payments/);
  assert.match(affiliates, /first 12 monthly payments/);
  assert.match(affiliates, /90-day referral cookie/);
  assert.match(affiliates, /Commissions become due 30 days after each payment/);
  assert.match(affiliates, /Payouts via PayPal/);
  assert.match(affiliates, /no minimum payout/);
  assert.match(affiliates, /tendercrest-ai\.getrewardful\.com\/signup/);
  assert.match(affiliates, /tendercrest-ai\.getrewardful\.com\/login/);
  assert.match(affiliates, /\$59\.80/);
  assert.match(affiliates, /\$1,677\.60/);
  assert.match(affiliates, /\$3,117\.60/);
  assert.match(affiliates, /"@type":"FAQPage"/);
  assert.ok(!/Archit/.test(affiliates), "affiliates page must not name the founder");

  const about = await readFile(new URL("dist/about.html", root), "utf8");
  assert.match(about, /Our mission is to make sure good work wins bids\./);
  assert.match(about, /Founded in October 2026, headquartered in Seattle, Washington\./);
  assert.match(about, /hello@tendercrestai\.com/);
  assert.ok(!/Archit/.test(about), "About page must not name the founder");

  const pricing = await readFile(new URL("dist/pricing.html", root), "utf8");
  assert.match(pricing, /Most popular/);
  assert.match(pricing, /<table>/);
  assert.match(pricing, /\$59\.80 per proposal/);
  assert.match(pricing, /\$34\.95 per proposal/);
  assert.match(pricing, /\$21\.65 per proposal/);
  assert.match(pricing, /No card\? Try the/);
  assert.match(pricing, /Refer a customer and earn 20% of their first 12 payments/);
  // Site fixes Nov 22: the comparison table states what every plan
  // includes (KB on all plans), with the two missing rows added, and
  // each plan section carries an anchor for the homepage deep links.
  assert.match(pricing, /<td>Matrix extraction<\/td><td>Included<\/td><td>Included<\/td><td>Included<\/td>/);
  assert.match(pricing, /<td>Knowledge base<\/td><td>Included<\/td><td>Full past performance knowledge base<\/td><td>Dedicated Knowledge Base Digest<\/td>/);
  assert.match(pricing, /<td>Email delivery of generated drafts<\/td><td>Included<\/td><td>Included<\/td><td>Included<\/td>/);
  assert.match(pricing, /<td>AI-assisted draft generation<\/td><td>Included<\/td><td>Included<\/td><td>Included<\/td>/);
  assert.match(pricing, /<td>Company qualifications in each proposal<\/td><td>Included<\/td><td>Included<\/td><td>Included<\/td>/);
  assert.match(pricing, /<td>Billing<\/td><td>Manage billing and cancellation through Stripe<\/td><td>Manage billing and cancellation through Stripe<\/td><td>Manage billing and cancellation through Stripe<\/td>/);
  assert.match(pricing, /<section id="pro">/);
  assert.match(pricing, /<section id="growth">/);
  assert.match(pricing, /<section id="enterprise">/);
  assert.match(pricing, /buy\.stripe\.com\/dRm9AT6PcaJT44U622dby00/);
  assert.match(pricing, /buy\.stripe\.com\/eVqfZh4H44lv8laaiidby01/);
  assert.match(pricing, /buy\.stripe\.com\/14AdR92yW4lvcBq0HIdby02/);

  // Shared chrome: every public page renders one header and one footer
  // from the single partial, with the new nav and footer links.
  for (const page of ["index.html", "pricing.html", "partners.html", "affiliates.html", "about.html", "demo.html", "teardowns/index.html"]) {
    const html = await readFile(new URL("dist/" + page, root), "utf8");
    assert.ok(!html.includes("<!-- @site-header -->"), page + " header placeholder must be replaced");
    assert.ok(!html.includes("<!-- @site-footer -->"), page + " footer placeholder must be replaced");
    assert.match(html, /Become a Partner/);
    assert.match(html, /Log in/);
    assert.match(html, /Start trial/);
    assert.match(html, /\/assets\/site-chrome\.css/);
  }
  // The homepage pricing tab is a summary now: no duplicated Stripe payment links.
  // (The inline auth-journey script still lists the payment URLs in its routes
  // map, as on the pricing page; that is configuration, not a link.)
  const homepage = await readFile(new URL("dist/index.html", root), "utf8");
  assert.ok(!/href="https:\/\/buy\.stripe\.com/.test(homepage), "homepage must not duplicate Stripe payment links");
  assert.match(homepage, /See Pro plan details/);
  assert.match(homepage, /Shred an RFP free — no signup/);
  assert.match(homepage, /\/samples\/workspace-editor\.png/);
  assert.ok(!/(?:📊|🛡️|📦|📐)/.test(homepage), "homepage feature icons must be SVG, not emoji");
  assert.match(homepage, /class="feature-icon"/);
  // Site fixes Nov 22: homepage plan links deep-link to their plan, the
  // limits copy states the live 1,000-requirement ceiling, and every
  // built page carries the favicon link.
  assert.match(homepage, /href="\/pricing#pro">See Pro plan details/);
  assert.match(homepage, /href="\/pricing#growth">See Growth plan details/);
  assert.match(homepage, /href="\/pricing#enterprise">See Enterprise plan details/);
  assert.match(homepage, /up to 1,000 requirements/);
  assert.match(homepage, /<link rel="icon" href="\/favicon\.ico">/);
  const demo = await readFile(new URL("dist/demo.html", root), "utf8");
  assert.match(demo, /width="1152" height="479"/);
  assert.match(affiliates, /by agreement for referral partners who publish a partner page/);
  assert.match(about, /We build for the teams doing the work/);

  // Consent consolidation: the four modules register with the single
  // coordinator and no longer build their own first-visit panels.
  for (const module of ["analytics.mjs", "openai-pixel.mjs", "google-ads.mjs", "rewardful.mjs"]) {
    const source = await readFile(new URL("dist/assets/" + module, root), "utf8");
    assert.match(source, /from '\.\/consent-banner\.mjs'/);
    assert.match(source, /registerConsentOption/);
    assert.ok(!source.includes("prepend(panel)"), module + " must not prepend its own panel");
  }
  const sitemap = await readFile(new URL("dist/sitemap.xml", root), "utf8");
  assert.match(sitemap, /tendercrestai\.com\/affiliates<\/loc><lastmod>2026-11-21<\/lastmod>/);
  assert.match(sitemap, /tendercrestai\.com\/about<\/loc><lastmod>2026-11-25<\/lastmod>/);
  const config = await readFile(new URL("netlify.toml", root), "utf8");
  assert.match(config, /from = "\/affiliates"\n\s*to = "\/affiliates\.html"/);
  assert.match(config, /from = "\/about"\n\s*to = "\/about\.html"/);
  const llms = await readFile(new URL("dist/llms.txt", root), "utf8");
  assert.match(config, /from = "\/teardowns\/federal-emergency-generator-replacement-23-requirements"\n\s*to = "\/teardowns\/federal-emergency-generator-replacement-23-requirements\.html"/);
  assert.match(llms, /Become a Partner\]\(https:\/\/www\.tendercrestai\.com\/affiliates\)/);
  assert.match(llms, /About\]\(https:\/\/www\.tendercrestai\.com\/about\)/);
});

test("grant mode: pricing grants section, homepage grant search, compare pages, feed actions", async () => {
  await import("../scripts/build-site.mjs");
  const files = await readdir(new URL("dist/", root), { recursive: true });
  for (const page of ["compare-grantable.html", "compare-granted-ai.html", "compare-grantparty.html"]) assert.ok(files.includes(page), page);

  const pricing = await readFile(new URL("dist/pricing.html", root), "utf8");
  assert.match(pricing, /<section id="grants">/);
  assert.match(pricing, /<strong>1 grant<\/strong> per month/);
  assert.match(pricing, /<strong>5 grants<\/strong> per month/);
  assert.match(pricing, /<strong>15 grants<\/strong> per month/);
  assert.match(pricing, /buy\.stripe\.com\/3cI28r3D0aJTfNCfCCdby04/);
  assert.match(pricing, /buy\.stripe\.com\/7sY28r5L8dW544U1LMdby05/);
  assert.match(pricing, /buy\.stripe\.com\/8x2fZh0qOf09fNCcqqdby03/);
  assert.match(pricing, /Annual: save 17%/);
  // Toggling monthly/annual must not bypass authenticated checkout: the toggle
  // re-applies the checkout-link rewrite after restoring the monthly hrefs.
  assert.match(pricing, /window\.__tcRewriteCheckoutLinks=\(\)=>\{if\(!window\.__tcAuthenticatedCheckout\)return;/);
  assert.match(pricing, /if\(!isAnnual&&window\.__tcRewriteCheckoutLinks\)window\.__tcRewriteCheckoutLinks\(\)/);
  assert.match(pricing, /A payment card is required at Stripe checkout/);
  assert.match(pricing, /Do you train AI on my documents\?/);
  assert.match(pricing, /Can I get an invoice or pay by purchase order\?/);

  const homepage = await readFile(new URL("dist/index.html", root), "utf8");
  assert.match(homepage, /<form class="grant-search" action="\/opportunities\/grants" method="get" role="search">/);
  assert.match(homepage, /name="keyword"/);
  assert.match(homepage, /Grants\.gov<\/span>/);
  assert.match(homepage, /A generic chatbot vs Grant Mode/);
  assert.match(homepage, /href="\/pricing#grants">See grant plan details/);
  assert.match(homepage, /Grant trials include up to <strong>1 grant on Grant Starter/);

  const feed = await readFile(new URL("dist/assets/grants-opportunities.mjs", root), "utf8");
  assert.match(feed, /Start a grant proposal/);
  assert.match(feed, /days left/);
  assert.match(feed, /Award amounts and eligibility/);
  assert.match(feed, /active opportunities/);

  for (const page of ["compare-grantable.html", "compare-granted-ai.html", "compare-grantparty.html"]) {
    const html = await readFile(new URL("dist/" + page, root), "utf8");
    assert.match(html, /GRANT SOFTWARE COMPARISON/);
    assert.match(html, /Published information and fit, checked November 25, 2026/);
    assert.match(html, /Why teams choose TenderCrest/);
    assert.match(html, /"@type": ?"FAQPage"/);
    assert.ok(!html.includes("—"), page + " must not use em dashes");
  }
  const grantable = await readFile(new URL("dist/compare-grantable.html", root), "utf8");
  assert.match(grantable, /Starter \$50\/month/);
  assert.match(grantable, /Pro \$150\/month/);
  const granted = await readFile(new URL("dist/compare-granted-ai.html", root), "utf8");
  assert.match(granted, /Basic \$29\/month/);
  assert.match(granted, /Professional \$89\/month/);
  const grantparty = await readFile(new URL("dist/compare-grantparty.html", root), "utf8");
  assert.match(grantparty, /\$249\/month/);
  assert.match(grantparty, /\$100 pilot/);

  const sitemap = await readFile(new URL("dist/sitemap.xml", root), "utf8");
  for (const slug of ["grantable", "granted-ai", "grantparty"]) assert.match(sitemap, new RegExp("tendercrestai\\.com\\/compare\\/" + slug + "<\\/loc><lastmod>2026-11-25<\\/lastmod>"));
  assert.match(sitemap, /tendercrestai\.com\/pricing<\/loc><lastmod>2026-11-25<\/lastmod>/);
  assert.match(sitemap, /tendercrestai\.com\/opportunities\/grants<\/loc><lastmod>2026-11-25<\/lastmod>/);

  const config = await readFile(new URL("netlify.toml", root), "utf8");
  for (const slug of ["grantable", "granted-ai", "grantparty"]) assert.match(config, new RegExp("from = \"\\/compare\\/" + slug + "\"\\n\\s*to = \"\\/compare-" + slug + "\\.html\""));

  const llms = await readFile(new URL("dist/llms.txt", root), "utf8");
  assert.match(llms, /Grant Starter \$19\/month \(1 grant\)/);
  assert.match(llms, /Grant Plus \$49\/month \(5 grants\)/);
  assert.match(llms, /Grant Pro \$99\/month \(15 grants\)/);

  const about = await readFile(new URL("dist/about.html", root), "utf8");
  assert.match(about, /Grant Mode brings the same evidence-backed approach to NOFOs/);
});
