// Public site key only; never expose TURNSTILE_SECRET_KEY to the browser.
exports.handler=async()=>({
 statusCode:200,
 headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
 body:JSON.stringify({siteKey:process.env.TURNSTILE_SITE_KEY||"",enabled:Boolean(process.env.TURNSTILE_SECRET_KEY)})
});
