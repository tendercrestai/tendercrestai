// Public configuration only; never serialize process.env or private credentials.
exports.handler = async event => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: { ...headers, Allow: "GET" }, body: "{}" };
  const url = process.env.SUPABASE_URL || "https://vfdwaqgfepvoujprtuww.supabase.co";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_7J1W7gPugOUuVnCWKpS24A_ozYw0KM3";
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(url) || !/^sb_publishable_[a-zA-Z0-9_.-]+$/.test(key))
    return { statusCode: 503, headers, body: JSON.stringify({ error: "Compliance configuration is unavailable." }) };
  return { statusCode: 200, headers, body: JSON.stringify({ url, key, enabled: process.env.COMPLIANCE_PREVIEW_ENABLED === "true" }) };
};
