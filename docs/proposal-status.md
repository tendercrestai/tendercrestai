# Proposal progress after submission

Previously, both submission pages changed the button to Queued in Engine and never requested the generation result. The upload page kept that label indefinitely; the paste workspace replaced it with Submit Another after a fixed timer.

Both workflows now use an authenticated status endpoint and a shared client tracker:

- Uploaded → Queued for generation
- Parsing Requirements → Reading requirements
- Drafting Proposal → Generating draft
- Ready for Review → Draft ready — check your email
- Failed / Quota Exceeded → the corresponding error message

The page checks about every 10 seconds while visible, pauses in hidden tabs, and stops when a terminal state is received. Temporary errors retry with a delay up to 60 seconds. Checks never create proposals, regenerate drafts, or send email. An expired session requires login.

The tracker saves only the submission UUID in account-scoped sessionStorage. A reload in the same browser tab resumes the latest tracked submission. Opening Upload another RFP clears that page's saved tracker so the user can start fresh. Trackers replace an old in-flight request when a new submission begins and ignore stale responses.

The endpoint accepts a submission UUID rather than an arbitrary Airtable record ID. It verifies the Supabase bearer token and retrieves the ledger row using the customer's JWT, RLS, and an explicit user-ID filter. Only after ownership is established does it read Airtable's Pipeline Status. It returns no document text, generated draft, email address, storage path, or API secret.

## Email wording

The existing Airtable automation sets Ready for Review before Gmail sends the email. There is no per-proposal email-sent timestamp or delivery event. Therefore the page reports Draft ready and directs the user to check email; it does not claim Email sent or inbox delivery. A confirmed-sent label would require a separately recorded post-email event. This change does not alter Airtable automation or field configuration.

## Deployment

Deploy the source changes using the existing Netlify workflow. No new migration, Airtable field, or environment variable is required. The endpoint uses the existing Functions-only AIRTABLE_PAT and Supabase configuration.

For a configured preview, the browser and function Supabase project must agree, and AIRTABLE_PAT must authorize the configured Airtable base. Do not trigger a real production generation merely to test a preview.

Tracked status starts with submissions made through this updated client. A tab created before the update has no saved status-tracker UUID. For an older submission, reloading the page and replaying the identical submission in the same tab can return its existing record and begin tracking when the original retry state is retained. Do not change inputs or clear retry state to force a new generation.

## Validation

Run node --test tests/*.test.* (Node 20+).

38 individual tests passed locally with Node 24, including the existing 21 regressions and 17 endpoint/tracker checks. Coverage includes cross-user denial before Airtable access, read-only requests, status mapping, content privacy, ambiguous submission states, reload recovery, auth expiry, hidden tabs, retries, and stale responses.

Live Firefox/Netlify polling still requires a signed-in browser check; the agent workspace cannot perform authenticated browser checks. Verify that a fresh controlled submission changes from queued to Draft ready without reloading, and that reloading the same tab retrieves the completed state.
