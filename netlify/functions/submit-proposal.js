exports.handler = async function (event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  // Pulls securely from Netlify Environment Variables
  const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
  const BASE_ID = "appsaqdp3UZdhB2VH";
  const TABLE_ID = "tblkL2ct7mYtUTu9S"; // Proposals Pipeline

  try {
    const payload = JSON.parse(event.body);

    if (!payload.proposalName || !payload.submitterEmail || !payload.rfpText) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required fields." })
      };
    }

    const postBody = {
      fields: {
        "Proposal Name": payload.proposalName,
        "Submitter Email": payload.submitterEmail,
        "Submitting Organization Name": payload.organizationName,
        "RFP Text Content": payload.rfpText,
        "Proposal Specific Qualifications": payload.qualifications || "",
        "Proposal Sector": payload.proposalSector || "Commercial / Enterprise RFP",
        "Pipeline Status": "Uploaded"
      }
    };

    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AIRTABLE_PAT}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(postBody)
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: data.error ? data.error.message : "Failed to record proposal in pipeline" })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, recordId: data.id })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
