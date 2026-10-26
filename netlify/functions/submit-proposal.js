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

function validateRequest(event) {
  if (event.httpMethod !== "POST") {
    const response = reply(405, { error: "Method Not Allowed" });
    response.headers.Allow = "POST";
    return response;
  }

  if (
    event.isBase64Encoded ||
    typeof event.body !== "string" ||
    Buffer.byteLength(event.body, "utf8") > 600000
  ) {
    return reply(413, {
      error: "Request exceeds the supported size."
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body);
  } catch {
    return reply(400, { error: "Invalid JSON request." });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return reply(400, { error: "Invalid request." });
  }

  for (const [field, limit] of Object.entries(LIMITS)) {
    if (
      payload[field] !== undefined &&
      (
        typeof payload[field] !== "string" ||
        payload[field].length > limit
      )
    ) {
      return reply(400, {
        error: field + " must be text within " + limit + " characters."
      });
    }
  }

  const proposalName = (payload.proposalName || "").trim();
  const cleanEmail = (payload.submitterEmail || "").trim().toLowerCase();
  const rfpText = (payload.rfpText || "").trim();
  const orgName = (payload.organizationName || "").trim();
  const proposalSector = payload.proposalSector;
  const qualifications = (payload.qualifications || "").trim();

  if (!proposalName || !cleanEmail || !rfpText || !orgName) {
    return reply(400, {
      error: "Title, billing email, organization, and RFP content are required."
    });
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
    /[\x00-\x1f\x7f]/.test(cleanEmail)
  ) {
    return reply(400, { error: "Enter a valid billing email." });
  }

  if (!SECTORS.has(proposalSector)) {
    return reply(400, {
      error: "Select a supported proposal type."
    });
  }

  return {
    proposalName,
    cleanEmail,
    rfpText,
    orgName,
    proposalSector,
    qualifications
  };
}

async function queueProposal(validated, attempt, context) {
  const {
    proposalName,
    cleanEmail,
    rfpText,
    orgName,
    proposalSector
  } = validated;

  let { qualifications } = validated;
  const source=require('./lib/billing-source').billingSource();
  const pat = source.pat;

  if (!pat) {
    return reply(503, {
      error: "Proposal submission is temporarily unavailable. Please try again later."
    });
  }

  const root = source.root;
  const headers = {
    Authorization: "Bearer " + pat,
    "Content-Type": "application/json"
  };

  try {
    const escapedEmail = cleanEmail
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'");

    const formula = encodeURIComponent(
      "LOWER(TRIM({Billing Email})) = '" + escapedEmail + "'"
    );

    const searchUrl =
      root + "/"+source.company+"?filterByFormula=" + formula +
      "&maxRecords=2";

    const bound=await require('./lib/customer-care').boundCompany(context.config,context.user,root,headers);
    const search = bound ? {ok:true,json:async()=>({records:[bound]})} : await fetch(searchUrl, {
      headers,
      signal: AbortSignal.timeout(10000)
    });

    if (!search.ok) {
      return reply(503, {
        error: "Account verification is temporarily unavailable. Please try again later."
      });
    }

    const accounts = await search.json();
    let company;

    if (!Array.isArray(accounts.records)) {
      return reply(503, { error: "Account verification returned an unexpected response." });
    }
    if (accounts.records.length === 0) {
      // New trials must start in Stripe Checkout on a selected plan. Never
      // provision an unbilled Enterprise account as a submission side effect.
      return reply(403, {
        code: "subscription_required",
        error: "Choose a plan and complete its 14-day trial checkout before submitting. If you just checked out, allow billing synchronization to finish.",
        billingUrl: "/#pricing"
      });
    } else {
      if (accounts.records.length !== 1) {
        return reply(503, { error: "Multiple billing accounts match this email. Please contact support." });
      }
      company = accounts.records[0];
    }

    if (!company || !company.id || !company.fields) {
      return reply(503, {
        error: "Your trial account is not ready for submissions. Please try again later."
      });
    }

    await credits.reserve(context.config, context.user, context.submissionId, company, root, headers);
    attempt.creditReserved = true;

    const digest = company.fields["Company Credentials Digest"];

    if (!qualifications && typeof digest === "string") {
      qualifications = digest;
    }

    // Any uncertain response after this point must not blindly retry.
    attempt.dispatched = true;

    const insert = await fetch(root + "/"+source.proposals, {
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
          "Credit Reservation ID": context.submissionId,
          "Company": [company.id]
        }
      })
    });

    if (!insert.ok) {
      return reply(503, {
        error: "The proposal could not be queued. Please try again later."
      });
    }

    const queued = await insert.json();

    if (!queued.id) {
      return reply(503, {
        error: "The proposal queue returned an unexpected response."
      });
    }

    return reply(200, {
      success: true,
      recordId: queued.id
    });
  } catch (error) {
    return reply(error.status || 503, {
      error: error.status ? error.message : "Proposal submission is temporarily unavailable. Please try again later."
    });
  }
}

const security = require("./lib/rfp-security");
const credits = require("./lib/credits");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    const response = reply(405, { error: "Method Not Allowed" });
    response.headers.Allow = "POST";
    return response;
  }

  if (process.env.SUBMISSION_ENABLED === "false") {
    return reply(503, { error: "Proposal submission is disabled for this deployment." });
  }

  if (
    event.isBase64Encoded ||
    typeof event.body !== "string" ||
    Buffer.byteLength(event.body, "utf8") > 600000
  ) {
    return reply(413, {
      error: "Request exceeds the supported size."
    });
  }

  let config;
  let reservation;
  const attempt = { dispatched: false };

  try {
    let payload;

    try {
      payload = JSON.parse(event.body);
    } catch {
      return reply(400, { error: "Invalid JSON request." });
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      return reply(400, { error: "Invalid request." });
    }

    config = security.configuration();

    const { user, token } = await security.authenticate(event, config);

    if (
      typeof payload.submitterEmail !== "string" ||
      payload.submitterEmail.trim().toLowerCase() !==
        user.email.toLowerCase()
    ) {
      return reply(403, {
        error: "Use your signed-in email for billing and proposal delivery."
      });
    }

    if (payload.documentId !== undefined) {
      await security.verifyDocument(
        config,
        token,
        user,
        payload.documentId
      );
    }

    const validated = validateRequest(event);
    if (validated.statusCode) return validated;

    reservation = await security.claim(config, user, payload);

    if (reservation.recordId) {
      return reply(200, {
        success: true,
        recordId: reservation.recordId,
        duplicate: true
      });
    }

    const response = await queueProposal(validated, attempt, { config, user, submissionId: reservation.id });
    const result = JSON.parse(response.body);

    if (attempt.creditReserved) {
      await credits.finish(config, reservation.id,
        result.success ? "queued" : attempt.dispatched ? "uncertain" : "released",
        result.recordId);
    }

    await security.finish(
      config,
      reservation.id,
      result.success
        ? "queued"
        : attempt.dispatched
          ? "uncertain"
          : "retryable",
      result.recordId
    );

    if (attempt.dispatched && !result.success) {
      return reply(503, {
        error: "The queue response could not be confirmed. Do not resubmit; contact support to verify this submission.",
        submissionId: reservation.id
      });
    }

    return response;
  } catch (error) {
    // A failed state save leaves the reservation locked.
    return reply(error.status || 503, {
      error: error.status
        ? error.message
        : "Secure submission is temporarily unavailable. Please try again later."
    });
  }
};


