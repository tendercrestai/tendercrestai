exports.handler = async function (event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json", "Allow": "POST" },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
  const BASE_ID = "appsaqdp3UZdhB2VH";
  const COMPANIES_TABLE_ID = "tbliWnP6ThqA02G5L";
  const PROPOSALS_TABLE_ID = "tblkL2ct7mYtUTu9S";

  try {
    const payload = JSON.parse(event.body || "{}");

    const proposalName = (payload.proposalName || "").trim();
    const cleanEmail = (payload.submitterEmail || "").trim().toLowerCase();
    const rfpText = (payload.rfpText || "").trim();
    const orgName = (payload.organizationName || "Independent Contractor").trim();
    const proposalSector = payload.proposalSector || "Commercial / Enterprise RFP";
    let qualifications = (payload.qualifications || "").trim();

    if (!proposalName || !cleanEmail || !rfpText) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required fields: Title, Email, or RFP Content." })
      };
    }

    // 1. High-speed lookup: Query ONLY Quota Status & Credentials fields to minimize latency & Netlify runtime
    const filterFormula = encodeURIComponent(`LOWER({Billing Email}) = '${cleanEmail}'`);
    const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${COMPANIES_TABLE_ID}?filterByFormula=${filterFormula}&maxRecords=1&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc&fields%5B%5D=Quota+Status&fields%5B%5D=Company+Credentials+Digest`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
    });

    const searchData = await searchRes.json();
    let companyRecordId = null;

    if (searchData.records && searchData.records.length > 0) {
      const companyRecord = searchData.records[0];
      companyRecordId = companyRecord.id;
      const quotaStatus = companyRecord.fields["Quota Status"];
      const credentialsDigest = companyRecord.fields["Company Credentials Digest"];

      // Block if subscription is inactive, canceled, or past due
      if (quotaStatus === "SUBSCRIPTION_INACTIVE") {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Your subscription is currently inactive or canceled. Please reactivate via the Billing Portal to submit proposals."
          })
        };
      }

      // Block if monthly proposal quota is exhausted
      if (quotaStatus === "QUOTA_EXCEEDED") {
        return {
          statusCode: 429,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Monthly proposal quota reached for this billing cycle. Please upgrade your tier via the Billing Portal to continue."
          })
        };
      }

      // Auto-inject verified company digest if qualifications were left blank
      if (!qualifications && credentialsDigest) {
        qualifications = credentialsDigest;
      }
    } else {
      // Auto-provision Free Developer Test Pass account
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
          body: JSON.stringify({ error: "Failed to initialize company account. Please retry." })
        };
      }
      companyRecordId = newCompData.id;
    }

    // 2. Insert proposal record into pipeline
    const postFields = {
      "Proposal Name": proposalName,
      "Submitter Email": cleanEmail,
      "Submitting Organization Name": orgName,
      "RFP Text Content": rfpText,
      "Proposal Specific Qualifications": qualifications,
      "Proposal Sector": proposalSector,
      "Pipeline Status": "Uploaded"
    };

    if (companyRecordId) {
      postFields["Company"] = [companyRecordId];
    }

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
      body: JSON.stringify({ error: err.message || "Internal Server Error" })
    };
  }
};
