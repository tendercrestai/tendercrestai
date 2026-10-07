exports.handler = async function (event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
  const BASE_ID = "appsaqdp3UZdhB2VH";
  const COMPANIES_TABLE_ID = "tbliWnP6ThqA02G5L";
  const PROPOSALS_TABLE_ID = "tblkL2ct7mYtUTu9S";

  try {
    const payload = JSON.parse(event.body);

    if (!payload.proposalName || !payload.submitterEmail || !payload.rfpText) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required fields: Proposal Name, Email, or RFP Content." })
      };
    }

    const cleanEmail = payload.submitterEmail.trim().toLowerCase();
    const orgName = (payload.organizationName || "Independent Contractor").trim();

    // 1. Look up existing company by Billing Email with deterministic sorting
    const filterFormula = encodeURIComponent(`LOWER({Billing Email}) = '${cleanEmail}'`);
    const searchRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${COMPANIES_TABLE_ID}?filterByFormula=${filterFormula}&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
      }
    );

    const searchData = await searchRes.json();
    let companyRecordId = null;

    if (searchData.records && searchData.records.length > 0) {
      // Pick the primary active record
      const companyRecord = searchData.records[0];
      companyRecordId = companyRecord.id;
      const quotaStatus = companyRecord.fields["Quota Status"];

      // Block if subscription is canceled, past due, or missing
      if (quotaStatus === "SUBSCRIPTION_INACTIVE") {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Your subscription is currently inactive, canceled, or past due. Please reactivate your plan via the Billing Portal to generate proposals."
          })
        };
      }

      // Block if monthly credits are exhausted
      if (quotaStatus === "QUOTA_EXCEEDED") {
        return {
          statusCode: 429,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Monthly proposal quota reached for this billing cycle. Please upgrade your tier via the Billing Portal to continue."
          })
        };
      }
    } else {
      // New user onboarding via Developer Test Pass ($0 tier) -> Provision verified company record
      const createCompRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${COMPANIES_TABLE_ID}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: {
            "Company Name": orgName,
            "Billing Email": cleanEmail,
            "Status": "Trialing",
            "Subscription Tier": "Pro ($299/mo)"
          }
        })
      });

      const newCompData = await createCompRes.json();
      if (!createCompRes.ok || !newCompData.id) {
        return {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Failed to initialize company provisioning record. Please retry." })
        };
      }
      companyRecordId = newCompData.id;
    }

    // 2. Prepare Proposal record payload
    const postFields = {
      "Proposal Name": payload.proposalName.trim(),
      "Submitter Email": cleanEmail,
      "Submitting Organization Name": orgName,
      "RFP Text Content": payload.rfpText.trim(),
      "Proposal Specific Qualifications": (payload.qualifications || "").trim(),
      "Proposal Sector": payload.proposalSector || "Commercial / Enterprise RFP",
      "Pipeline Status": "Uploaded"
    };

    if (companyRecordId) {
      postFields["Company"] = [companyRecordId];
    }

    // 3. Insert Proposal into Proposals Pipeline table
    const insertRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PROPOSALS_TABLE_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: postFields })
    });

    const insertData = await insertRes.json();

    if (!insertRes.ok) {
      return {
        statusCode: insertRes.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: insertData.error ? insertData.error.message : "Failed to record proposal in pipeline."
        })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, recordId: insertData.id })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
