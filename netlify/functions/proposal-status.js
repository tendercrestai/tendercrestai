const { configuration, authenticate } = require("./lib/rfp-security");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD = /^rec[a-zA-Z0-9]{14}$/;

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  },
  body: JSON.stringify(body)
});

const STATES = {
  Uploaded: "queued",
  "Parsing Requirements": "parsing",
  "Drafting Proposal": "drafting",
  "Ready for Review": "ready",
  Failed: "failed",
  "Quota Exceeded": "quota_exceeded"
};

exports.handler = async event => {
  if (event.httpMethod !== "GET") {
    const response = reply(405, { error: "Method Not Allowed" });
    response.headers.Allow = "GET";
    return response;
  }
  const id = event.queryStringParameters?.submissionId;
  if (typeof id !== "string" || !UUID.test(id)) {
    return reply(400, { error: "A valid submission ID is required." });
  }

  try {
    const config = configuration();
    const { user, token } = await authenticate(event, config);
    // User JWT and explicit ownership filter: never trust a client Airtable ID.
    const lookup = await fetch(
      config.url + "/rest/v1/rfp_submissions?id=eq." + id +
        "&user_id=eq." + user.id + "&select=id,status,record_id",
      {
        headers: { apikey: config.key, Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!lookup.ok) {
      return reply(503, { error: "Submission status is temporarily unavailable." });
    }
    const saved = (await lookup.json())[0];
    if (!saved) return reply(404, { error: "Submission not found." });
    if (saved.status !== "queued") {
      const status = { processing: "processing", uncertain: "uncertain", retryable: "retryable" }[saved.status];
      if (!status) return reply(503, { error: "Submission status is temporarily unavailable." });
      return reply(200, { status, emailStatus: "unconfirmed" });
    }
    if (!RECORD.test(saved.record_id || "")) {
      return reply(503, { error: "Submission status is temporarily unavailable." });
    }
    const source=require('./lib/billing-source').billingSource();
    const pat = source.pat;
    if (!pat) return reply(503, { error: "Proposal status is temporarily unavailable." });
    // Fetch only the status field; do not fetch or expose document/draft text.
    const query = new URLSearchParams({
      filterByFormula: "RECORD_ID()='" + saved.record_id + "'",
      maxRecords: "1"
    });
    query.append("fields[]", "Pipeline Status");
    const upstream = await fetch(
      source.root+"/"+source.proposals+"?"+query,
      {
        headers: { Authorization: "Bearer " + pat },
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!upstream.ok) return reply(503, { error: "Proposal status is temporarily unavailable." });
    const record = (await upstream.json()).records?.find(row => row.id === saved.record_id);
    if (!record) return reply(503, { error: "Proposal status is temporarily unavailable." });
    const status = STATES[record.fields?.["Pipeline Status"]] || "processing";
    // Ready for Review precedes email sending in the existing automation.
    return reply(200, { status, emailStatus: "unconfirmed" });
  } catch (error) {
    return reply(error.status || 503, {
      error: error.status ? error.message : "Proposal status is temporarily unavailable."
    });
  }
};
