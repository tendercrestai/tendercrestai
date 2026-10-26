// Review and paste into the existing Airtable delivery automation only after staging tests.
// Configure these input variables from the triggering proposal record; keep relayToken secret.
const {recordId,submissionId,to,subject,message,relayToken}=input.config();
if(!recordId||!submissionId||!to||!subject||!message)throw Error('Stable proposal and submission identity required');
const response=await fetch('https://www.tendercrestai.com/.netlify/functions/airtable-mail-relay',{method:'POST',headers:{Authorization:'Bearer '+relayToken,'Content-Type':'application/json'},body:JSON.stringify({to,subject,message,deliveryKey:'proposal:'+recordId,submissionId})});
const receipt=await response.json();if(!response.ok)throw Error(receipt.deliveryState==='uncertain'?'Delivery uncertain. Verify receipt; do not create a new key to retry.':'Delivery failed. Review the existing stable-key receipt.');
output.set('providerAccepted',true);output.set('providerMessageId',receipt.id);output.set('duplicateSuppressed',receipt.duplicate===true);
// Acceptance is not inbox delivery. An intentional resend needs a separately reviewed attempt key.
