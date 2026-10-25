# Cited reference guidance production release

This release provides read-only structure suggestions inside an authenticated proposal project. It is not an LLM upgrade, a trained winning-bid model, a compliance verdict or an output-quality benchmark. The owner authorized production activation after successful checks.

## Released scope

The Reference guidance tab selects a saved section, reference market and sector. The server uses linked saved requirement text only; the client cannot submit an arbitrary query, catalogue, mode, source or evidence override. Guidance includes public source links, source locators and hashes. No-match is explicit. Changing inputs clears earlier results, and stale revision/evidence requests fail rather than presenting advice against a newer project.

The production manifest contains four reviewed public snapshots: three USDS Playbook plays with retained public-domain/CC0 notice and one Acumen technical-documentation example with retained adjacent MIT notice covering associated documentation. It is a small historical US federal IT collection. Award notices, unlicensed candidates and unverified full-response claims are excluded. None is represented as a verified full winning proposal. The research catalogue retains its independent offline approval scopes.

Production manifest/source/notice files are bundled privately with the proposals function, not copied into the static website. Every load verifies source and licence hashes and root-contained paths. Integrity/availability failure returns an error, not an unverified fallback. Four immutable snapshots remain version-pinned; additions/updates require renewed source/reuse review and a reviewed production manifest.

## Access and effects

The existing project authentication, active organization/project membership and admission controls apply. Viewers may read guidance because they can already read the project requirements. Membership is checked again before results return. A removed membership now explicitly returns 403 rather than a generic failure. Requests bind the saved project revision/evidence epoch.

No draft, evidence mapping, compliance status, bid decision, final approval, job, export, billing credit or customer email is modified. Existing read-admission accounting still applies. No additional model, embedding, external-source or private knowledge lookup occurs. Guidance does not automatically replace draft text or become a claim/citation in customer submission packages. Normal drafting/review/export flows remain available independently.

## Activation and rollback

PROPOSAL_REFERENCE_ENABLED must equal true, alongside the existing workspace flag. It defaults off. Public proposal-config exposes only its boolean state. Turn the flag off and redeploy to hide the tab and deny new requests; this requires no data rollback because no project content is changed. Do not revert unrelated billing/14-day trial or existing workspace flags. Keep PROPOSAL_EMAIL_LIVE=false for this release.

Stage the exact built assets/functions on the isolated site with its test Supabase. Verify live authenticated owner/viewer/no-match/stale/unauthorized checks, source-file exclusion and browser behavior before production activation. A deploy-specific flag can enable guidance on that staging deployment without modifying production environment values. Package inspection must confirm the private production manifest and source/notice hashes actually exist in the function ZIP.

After local/hosted checks pass, merge PR #18 normally, verify its published commit, enable only the new flag, redeploy that same commit and run read-only production checks with the previously authorized fictional Test1 owner. No new account, paid generation, card checkout, charge, customer email, SQL migration or automatic source ingestion is part of this release.

A real hosted card flow, LLM quality comparison, semantic retrieval or a representative verified winning-proposal corpus is not established by this feature's tests. Public wording must describe cited structure guidance and its limited coverage; do not claim training on winning bids or measured win-rate/compliance improvement.

## Pre-release evidence

220 Node regression tests and 14 offline mobile/desktop browser checks pass. The first isolated deployment passed 24 hosted API/security checks and 16 real owner/viewer browser checks using existing fictional accounts on test Supabase. The final candidate includes the final-revision race check and repeated all hosted checks successfully. No model, billing or email action was invoked. Netlify locally packaged all 15 functions; the isolated hosted deployment contains only proposals/proposal-config/knowledge/knowledge-config to avoid uploading unrelated large parser bundles through this environment. Production CI still packages the complete application. Private manifest/source/notice bytes were verified in the packaged proposals ZIP.

The first optional deploy-specific-environment request returned a provider server error before upload; its incomplete deployment was canceled. A subsequent large unrelated parser transfer reset and was canceled. The isolated reference-only deployment was explicitly published to the separate test site; the older branch alias was not used as evidence after it was found to serve an older function version. Production remained on its baseline throughout these tests.
