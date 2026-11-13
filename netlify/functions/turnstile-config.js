// Public site key only; never expose TURNSTILE_SECRET_KEY to the browser.
// Deploy previews cannot use Turnstile: the Cloudflare site key allowlist
// holds only the production hostnames and Cloudflare rejects wildcards.
// The widget is disabled on exact deploy-preview hosts instead; those
// previews sit behind Netlify Team Protection, so only the team reaches them.
const {isDeployPreviewHost,requestHost}=require("./lib/preview-host");
exports.handler=async(event)=>{
 const preview=isDeployPreviewHost(requestHost(event));
 return {
  statusCode:200,
  headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
  body:JSON.stringify({siteKey:process.env.TURNSTILE_SITE_KEY||"",enabled:!preview&&Boolean(process.env.TURNSTILE_SECRET_KEY)})
 };
};
