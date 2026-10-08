TenderCrest self-serve free trial fix

This package replaces netlify/functions/submit-proposal.js.


Behavior


A valid email with no matching Airtable Companies record receives a new $0 Trialing account.

Airtable's existing formulas assign the Enterprise-equivalent 60 proposal quota and 30-day trial window.

The proposal is linked to that new account and enters the existing generation automation.

Existing active accounts are reused; paid plan checks and quota enforcement remain in place.

No Airtable token or other secret is included. The function uses the existing Netlify AIRTABLE_PAT environment variable.


Apply the code

Replace the repository file netlify/functions/submit-proposal.js with the file in this package and commit it to the branch Netlify deploys (currently main). Wait for the production deploy to finish before testing a new email.


The GitHub connector rejected the attempted write with HTTP 403, so the repository and live Netlify deploy were not changed by this package creation.


Apply the Airtable automation draft

The Automation 1 draft was updated to use exact billing-email matching and to stop creating a duplicate Companies row. Open the automation in Airtable and click Update to publish the draft. The Airtable connector can edit the draft but cannot publish it.


Test

Submit a proposal with a valid email that is not already in Companies. Confirm Airtable creates one Trialing company row, links the proposal to it, and the existing automation produces and emails the output.
