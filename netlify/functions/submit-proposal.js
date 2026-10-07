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
        body: JSON.stringify({ error: "Missing required fields." })
      };
    }

    const cleanEmail = payload.submitterEmail.trim().toLowerCase();

    // 1. Look up existing company by Billing Email
    const filterFormula = encodeURIComponent(`LOWER({Billing Email}) = '${cleanEmail}'`);
    const searchRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${COMPANIES_TABLE_ID}?filterByFormula=${filterFormula}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
      }
    );

    const searchData = await searchRes.json();
    let companyRecordId = null;

    if (searchData.records && searchData.records.length > 0) {
      // Pick the most relevant record
      const companyRecord = searchData.records[0];
      companyRecordId = companyRecord.id;
      const quotaStatus = companyRecord.fields["Quota Status"];

      // Block if inactive or out of credits
      if (quotaStatus === "SUBSCRIPTION_INACTIVE") {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Subscription is inactive or canceled. Please renew via the Billing Portal to submit proposals."
          })
        };
      }

      if (quotaStatus === "QUOTA_EXCEEDED") {
        return {
          statusCode: 429,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Monthly proposal quota reached for this billing cycle. Please upgrade your plan in the Billing Portal."
          })
        };
      }
    }

    // 2. Prepare Proposal record payload
    const postFields = {
      "Proposal Name": payload.proposalName,
      "Submitter Email": cleanEmail,
      "Submitting Organization Name": payload.organizationName || "",
      "RFP Text Content": payload.rfpText,
      "Proposal Specific Qualifications": payload.qualifications || "",
      "Proposal Sector": payload.proposalSector || "Commercial / Enterprise RFP",
      "Pipeline Status": "Uploaded"
    };

    // If company exists, link to the single existing record (prevents duplicates)
    if (companyRecordId) {
      postFields["Company"] = [companyRecordId];
    }

    // 3. Insert Proposal into pipeline
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
