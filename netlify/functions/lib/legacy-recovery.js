const kb=require('./knowledge-base'),C=require('./customer-care');
exports.recover=async(config,user,submissionId)=>{
 kb.uuid(submissionId);
 const rows=await C.db(config,'rfp_submissions?id=eq.'+submissionId+'&user_id=eq.'+user.id+'&select=id,status,record_id');
 const submission=rows[0];if(!submission)kb.fail(404,'Owned submission not found.');
 if(submission.status!=='queued'||!/^rec[A-Za-z0-9]+$/.test(submission.record_id||''))kb.fail(409,'This submission has no recoverable saved draft yet.');
 const existing=await C.db(config,'cc_deliveries?submission_id=eq.'+submissionId+'&user_id=eq.'+user.id+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=id&limit=1');
 if(existing[0])return {deliveryId:existing[0].id,notice:'An existing retained copy is available. No email was sent.'};
 const source=require('./billing-source').billingSource();if(!source.pat)kb.fail(503,'Saved draft recovery is temporarily unavailable.');
 const query=new URLSearchParams({filterByFormula:"RECORD_ID()='"+submission.record_id+"'",maxRecords:'1'});for(const field of ['Generated Proposal Content','Pipeline Status','Proposal Name','Submitter Email','Credit Reservation ID'])query.append('fields[]',field);
 const r=await fetch(source.root+'/'+source.proposals+'?'+query,{headers:{Authorization:'Bearer '+source.pat},signal:AbortSignal.timeout(10000)});
 if(!r.ok)kb.fail(503,'The original saved draft could not be retrieved.');const record=(await r.json()).records?.find(r=>r.id===submission.record_id);if(!record)kb.fail(404,'The original saved record is unavailable.');const fields=record.fields||{};
 if(record.id!==submission.record_id||fields['Submitter Email']&&fields['Submitter Email'].trim().toLowerCase()!==user.email.trim().toLowerCase()||fields['Credit Reservation ID']&&fields['Credit Reservation ID']!==submissionId)kb.fail(409,'Saved draft identity needs support review.');
 if(fields['Pipeline Status']!=='Ready for Review')kb.fail(409,'The original draft is not ready for recovery.');
 let body=fields['Generated Proposal Content'];if(body&&typeof body==='object')body=body.state==='generated'&&body.isStale!==true?body.value:null;
 if(typeof body!=='string'||!body.trim())kb.fail(409,'No complete saved proposal text is available.');
 const email=require('./proposal-email');if(body.length>150000)kb.fail(413,'The saved draft exceeds the protected-download limit.');if(!email.validXMLText(body))kb.fail(409,'The saved text contains unsupported characters and needs review.');
 body=email.normalizeBrand(body);const subject='Recovered draft: '+String(fields['Proposal Name']||'Proposal').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,460);
 if(!email.validXMLText(subject))kb.fail(409,'The saved proposal title needs review.');
 // Recovery stores a snapshot; Prepared deliberately makes no provider-delivery claim.
 const key='recovered:'+submissionId;
 await C.db(config,'cc_deliveries?on_conflict=delivery_key',{method:'POST',body:{user_id:user.id,submission_id:submissionId,delivery_key:key,subject,body,status:'Prepared'},fetcher:(url,init)=>fetch(url,{...init,headers:{...init.headers,Prefer:'resolution=ignore-duplicates,return=representation'}})});
 const saved=await C.db(config,'cc_deliveries?delivery_key=eq.'+key+'&user_id=eq.'+user.id+'&select=id,expires_at');
 if(!saved[0]||Date.parse(saved[0].expires_at)<=Date.now())kb.fail(409,'The previous recovery retention expired. Contact support for review.');
 return {deliveryId:saved[0].id,notice:'Recovered a snapshot of the stored draft for Word download. This does not confirm that an earlier email was delivered or reproduce its attachment byte for byte. No email or AI request was made.'};
};
