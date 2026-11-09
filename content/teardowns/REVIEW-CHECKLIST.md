# Human review checklist

Copy this checklist into the review record for each new teardown. Automated/assistant checks support the review; they do not sign it for a human. A draft is excluded from a normal build until a human completes the checklist, fills the reviewer/date record and approves the repository change.

- [ ] Every number on the page matches the shred output (requirement count, mandatory count, gap count, category split).
- [ ] The deal-breakers are real items from the shred, not invented.
- [ ] No company name, notice ID, agency name, or live-bid date appears anywhere on the page (rendered or in JSON-LD).
- [ ] The lesson is one short paragraph and follows from the teardown, not a generic claim.
- [ ] The bid read is a band only, no win probability, no percentage.
- [ ] The disclaimer is present: `This teardown is illustrative and anonymized. It does not describe any one company's bid, and it does not certify compliance or predict an award.`
- [ ] The honesty notice is present: `Teardowns are illustrative. Solicitations change by amendment, and attachments can add requirements the shredder never saw. Always verify against the original.`
- [ ] The `Try it on yours` CTA links to `/tools/shredder` and `/tools/bid-check`.
- [ ] The `source_notice_id` is recorded privately and is not rendered.
- [ ] The teardown does not describe any one company's bid and does not present the launch teardowns as real bids.

For an example bidder, also verify that the stated profile sits next to the band, is labeled an example rather than a real bidder, and matches the scoring inputs without changes to force the band.
