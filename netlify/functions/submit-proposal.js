const SECTORS = new Set([
  "Public Sector / Gov (Section L&M)",
  "Commercial / Enterprise RFP",
  "SaaS / Tech Vendor Evaluation",
  "Grant / Non-Profit Application"
]);

const LIMITS = {
  proposalName: 300,
  submitterEmail: 254,
  rfpText: 100000,
  organizationName: 200,
  qualifications: 30000
};

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  },
  body: JSON.stringify(body)
});

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    const response = reply(405, { error: "Method Not Allowed" });
    response.headers.Allow = "POST";
    return response;
  }

  if (event.isBase64Encoded || typeof event.body !== "string" || Buffer.byteLength(event.body, "utf8") > 600000) {
    return reply(413, { error: "Request exceeds the supported size." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return reply(400, { error: "Invalid JSON request." });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return reply(400, { error: "Invalid request." });
  }

  for (const [field, limit] of Object.entries(LIMITS)) {
    if (payload[field] !== undefined && (typeof payload[field] !== "string" || payload[field].length > limit)) {
      return reply(400, { error: field + " must be text within " + limit + " characters." });
    }
  }

  const proposalName = (payload.proposalName || "").trim();
  const cleanEmail = (payload.submitterEmail || "").trim().toLowerCase();
  const rfpText = (payload.rfpText || "").trim();
  const orgName = (payload.organizationName || "").trim();
  const proposalSector = payload.proposalSector;
  let qualifications = (payload.qualifications || "").trim();

  if (!proposalName || !cleanEmail || !rfpText || !orgName) {
    return reply(400, { error: "Title, billing email, organization, and RFP content are required." });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || /[\x00-\x1f\x7f]/.test(cleanEmail)) {
    return reply(400, { error: "Enter a valid billing email." });
  }

  if (!SECTORS.has(proposalSector)) {
    return reply(400, { error: "Select a supported proposal type." });
  }

  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    return reply(503, { error: "Proposal submission is temporarily unavailable. Please try again later." });
  }

  const root = "https://api.airtable.com/v0/appsaqdp3UZdhB2VH";
  const headers = { Authorization: "Bearer " + pat, "Content-Type": "application/json" };

  try {
    // Escape formula literals for Airtable
    const escapedEmail = cleanEmail.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const escapedOrg = orgName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    // Fetch accounts matching email; include Company Name for accurate disambiguation
    const formula = encodeURIComponent("LOWER({Billing Email}) = '" + escapedEmail + "'");
    const searchUrl = root + "/tbliWnP6ThqA02G5L?filterByFormula=" + formula +
      "&fields%5B%5D=Company+Name&fields%5B%5D=Quota+Status&fields%5B%5D=Company+Credentials+Digest&fields%5B%5D=Remaining+Proposals";

    const search = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(10000) });

    if (!search.ok) {
      return reply(503, { error: "Account verification is temporarily unavailable. Please try again later." });
    }

    const accounts = await search.json();
    let company;

    if (!Array.isArray(accounts.records) || accounts.records.length === 0) {
      // Self-serve free trial: no prior Airtable provisioning or paid subscription is required.
      // Airtable formulas grant Trialing accounts 60 proposals and a 30-day trial window.
      const trial = await fetch(root + "/tbliWnP6ThqA02G5L", {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          fields: {
            "Company Name": orgName,
            "Billing Email": cleanEmail,
            "Subscription Tier": "Enterprise ($1,299/mo)",
            "Status": "Trialing",
            "Amount Paid": 0
          }
        })
      });

      if (!trial.ok) {
        return reply(503, { error: "Free trial activation is temporarily unavailable. Please try again later." });
      }

      const createdTrial = await trial.json();
      if (!createdTrial.id) {
        return reply(503, { error: "Free trial activation returned an unexpected response. Please try again later." });
      }

      // Read back computed quota fields before queuing the first proposal.
      const trialCheck = await fetch(root + "/tbliWnP6ThqA02G5L/" + encodeURIComponent(createdTrial.id) +
        "?fields%5B%5D=Company+Name&fields%5B%5D=Quota+Status&fields%5B%5D=Company+Credentials+Digest&fields%5B%5D=Remaining+Proposals", {
          headers,
          signal: AbortSignal.timeout(10000)
        });
      if (!trialCheck.ok) {
        return reply(503, { error: "Your free trial was activated, but its quota is still initializing. Please try again shortly." });
      }
      company = await trialCheck.json();
    } else {
      // Reuse an existing account for the exact email, preferring the matching organization.
      let matchingRecords = accounts.records.filter(r => {
        const cName = (r.fields["Company Name"] || "").trim().toLowerCase();
        return cName === orgName.toLowerCase();
      });

      if (matchingRecords.length === 0) {
        matchingRecords = accounts.records;
      }

      // Pick the most eligible account: ACTIVE first, followed by highest remaining proposals.
      company = matchingRecords.sort((a, b) => {
        const aActive = a.fields["Quota Status"] === "ACTIVE" ? 1 : 0;
        const bActive = b.fields["Quota Status"] === "ACTIVE" ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive;
        return (b.fields["Remaining Proposals"] || 0) - (a.fields["Remaining Proposals"] || 0);
      })[0];
    }

    if (!company || !company.id || !company.fields) {
      return reply(503, { error: "Your trial account is not ready for submissions. Please try again later." });
    }

    const quota = company.fields["Quota Status"];
    if (quota === "SUBSCRIPTION_INACTIVE") {
      return reply(403, { error: "Your subscription is inactive. Manage your subscription through the Billing Portal." });
    }
    if (quota === "QUOTA_EXCEEDED") {
      return reply(429, { error: "Your monthly proposal allowance has been reached." });
    }
    if (quota !== "ACTIVE") {
      return reply(503, { error: "Your account status is currently: " + (quota || "Pending") + ". Please check your active plan." });
    }

    const digest = company.fields["Company Credentials Digest"];
    if (!qualifications && typeof digest === "string") {
      qualifications = digest;
    }

    const insert = await fetch(root + "/tblkL2ct7mYtUTu9S", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        fields: {
          "Proposal Name": proposalName,
          "Submitter Email": cleanEmail,
          "Submitting Organization Name": orgName,
          "RFP Text Content": rfpText,
          "Proposal Specific Qualifications": qualifications,
          "Proposal Sector": proposalSector,
          "Pipeline Status": "Uploaded",
          "Company": [company.id]
        }
      })
    });

    if (!insert.ok) {
      return reply(503, { error: "The proposal could not be queued. Please try again later." });
    }

    const queued = await insert.json();
    if (!queued.id) {
      return reply(503, { error: "The proposal queue returned an unexpected response." });
    }

    return reply(200, { success: true, recordId: queued.id });
  } catch {
    return reply(503, { error: "Proposal submission is temporarily unavailable. Please try again later." });
  }
};