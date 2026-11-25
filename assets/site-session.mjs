// The shared site header is rendered statically at build time
// (scripts/lib/site-chrome.mjs), so it says "Log in" on every public page
// even while signed in — the account hub on auth.html knows the session,
// the header never did. That is why the pricing and shredder pages showed
// "Log in" for a signed-in account.
//
// Swap the header link to "My account" when a Supabase session token is
// stored locally. No network call: the Supabase JS client keeps the
// session in localStorage under sb-<project-ref>-auth-token, so reading
// it here is synchronous and runs before first paint in practice (module
// scripts are deferred, the header is already parsed). A parseable token
// with an access_token means signed in — sign-out removes the token, and
// an expired token still resolves to the account page, where auth.html
// refreshes the session or shows sign-in. Any failure leaves the header
// exactly as built ("Log in").
export function syncSiteHeaderSessionLink(doc=document,storage=globalThis.localStorage){
 try{
  const link=doc.querySelector('.site-login-link');
  if(!link||!storage)return false;
  for(let i=0;i<storage.length;i++){
   const key=storage.key(i);
   if(!key||!key.startsWith('sb-')||!key.endsWith('-auth-token'))continue;
   let session=null;
   try{session=JSON.parse(storage.getItem(key));}catch{continue;}
   if(session&&typeof session.access_token==='string'&&session.access_token){
    link.textContent='My account';
    return true;
   }
  }
 }catch{}
 return false;
}
try{syncSiteHeaderSessionLink();}catch{}
