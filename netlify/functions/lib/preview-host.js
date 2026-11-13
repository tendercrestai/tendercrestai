// Deploy-preview host detection for the Turnstile preview bypass.
// Only exact Netlify deploy-preview hostnames for this site count:
//   deploy-preview-<id>--tendercrestai.netlify.app
// Never *.netlify.app, never Origin/Referer, never a client-supplied body field.
// A direct POST to the production function URL presents host
// www.tendercrestai.com, so production verification still runs there.
// Preview function URLs sit behind Netlify Team Protection (401 without a
// team sign-in), so only the team can reach a request whose host matches.
function isDeployPreviewHost(host){
 if(typeof host!=="string")return false;
 const name=host.split(":")[0].trim().toLowerCase();
 if(!name.startsWith("deploy-preview-"))return false;
 if(!name.endsWith("--tendercrestai.netlify.app"))return false;
 const middle=name.slice("deploy-preview-".length,-"--tendercrestai.netlify.app".length);
 return middle.length>0&&/^[a-z0-9-]+$/.test(middle);
}
// The request host as received by the function. Netlify normalises header
// names to lowercase; check both casings for local test events.
function requestHost(event){
 const headers=event&&event.headers?event.headers:{};
 return headers.host||headers.Host||"";
}
module.exports={isDeployPreviewHost,requestHost};
