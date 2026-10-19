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
  const pat = process.env.AIRTABLE_PAT;

  if (!pat) {
    return reply(503, {
      error: "Proposal submission is temporarily unavailable. Please try again later."
    });
  }

  if (process.env.AIRTABLE_BASE_ID && !/^app[a-zA-Z0-9]{14}$/.test(process.env.AIRTABLE_BASE_ID)) {
    return reply(503, { error: "Proposal queue configuration is unavailable." });
  }
  const root = process.env.AIRTABLE_BASE_ID
    ? "https://api.airtable.com/v0/" + process.env.AIRTABLE_BASE_ID
    : "https://api.airtable.com/v0/appsaqdp3UZdhB2VH";
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
      root + "/tbliWnP6ThqA02G5L?filterByFormula=" + formula +
      "&maxRecords=2";

    const search = await fetch(searchUrl, {
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
      // One durable provisioning claim per verified owner. Ambiguous creates
      // stay locked for reconciliation rather than granting a second trial.
      const trialClaim = await credits.rpc(context.config, 'claim_free_trial', { p_user_id: context.user.id });
      if (!trialClaim.create) return reply(503, { error: "Your trial account is being provisioned. Please try again later or contact support." });
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
            "Amount Paid": 0,
            "Billing Period Start": trialClaim.start,
            "Billing Period End": trialClaim.end
          }
        })
      });

      if (!trial.ok) {
        return reply(503, {
          error: "Free trial activation is temporarily unavailable. Please try again later."
        });
      }

      const createdTrial = await trial.json();

      if (!createdTrial?.id) {
        return reply(503, {
          error: "Free trial activation returned an unexpected response. Please try again later."
        });
      }

      await credits.rpc(context.config, 'bind_free_trial', {
        p_user_id: context.user.id, p_company_id: createdTrial.id
      });
      // Do not wait for Airtable's computed fields to refresh.
      company = {
        ...createdTrial,
        fields: {
          ...(createdTrial.fields || {}),
          "Quota Status": "ACTIVE",
          "Remaining Proposals": 60,
          "Billing Period Start": trialClaim.start,
          "Billing Period End": trialClaim.end
        }
      };
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

    if (validated.evidencePassages) {
      qualifications = require("./lib/proposal-evidence").context(qualifications, validated.evidencePassages, validated.compliancePacket);
      if (qualifications.length > 90000) throw new security.RequestError(400, "Evidence context exceeds the proposal limit.");
    }
    // Any uncertain response after this point must not blindly retry.
    attempt.dispatched = true;

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

    let compliance;
    if (payload.complianceAnalysisId !== undefined) {
      compliance = await require("./lib/proposal-compliance").loadHandoff(config, token, user, payload.complianceAnalysisId);
      if (payload.complianceReviewHash !== compliance.reviewHash)
        throw new security.RequestError(409, "The compliance review changed. Reload it before submitting.");
      if (validated.rfpText !== compliance.sourceText)
        throw new security.RequestError(409, "Linked RFP text changed. Reload the analysis or detach it before submitting.");
    } else if (payload.complianceReviewHash !== undefined) {
      throw new security.RequestError(400, "A compliance analysis ID is required.");
    }
    // Authenticate retrieval with the customer JWT; the service role must not read evidence.
    // Retrieval failures happen before reservation/dispatch and cannot create a partial queue item.
    let evidencePassages;
    if (process.env.EVIDENCE_ENGINE_ENABLED === "true") {
      evidencePassages = await require("./lib/proposal-evidence").loadEvidence(
        config, token, user, validated.proposalSector, validated.rfpText, compliance?.packet.requirements
      );
    }

    reservation = await security.claim(config, user, payload);

    if (reservation.recordId) {
      return reply(200, {
        success: true,
        recordId: reservation.recordId,
        duplicate: true
      });
    }

    validated.evidencePassages = evidencePassages;
    validated.compliancePacket = compliance?.packet;
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
