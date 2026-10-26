const { RequestError } = require('./rfp-security');
const QUOTAS = { 'Pro ($299/mo)': 5, 'Growth ($699/mo)': 20, 'Enterprise ($1,299/mo)': 60 };
const FAILED = new Set(['Failed', 'Quota Exceeded']);

function monthlyPeriod(createdTime, now = Date.now()) {
  const origin = new Date(createdTime);
  if (!Number.isFinite(origin.getTime())) return { start: NaN, end: NaN };
  const current = new Date(now);
  let offset = (current.getUTCFullYear() - origin.getUTCFullYear()) * 12 + current.getUTCMonth() - origin.getUTCMonth();
  const boundary = months => {
    const total = origin.getUTCFullYear() * 12 + origin.getUTCMonth() + months;
    const year = Math.floor(total / 12), month = total - year * 12;
    const day = Math.min(origin.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    return Date.UTC(year, month, day, origin.getUTCHours(), origin.getUTCMinutes(), origin.getUTCSeconds(), origin.getUTCMilliseconds());
  };
  if (boundary(offset) > now && now >= origin.getTime()) offset--;
  // Never grant access before the account was actually created.
  if (now < origin.getTime()) offset = 0;
  return { start: boundary(offset), end: boundary(offset + 1) };
}

function entitlement(company, now = Date.now()) {
  const fields = company.fields || {};
  const trial = fields.Status === 'Trialing' && !fields['Stripe Subscription ID'];
  const complimentary = fields['Complimentary Access'] === true && fields.Status === 'Active' && !fields['Stripe Subscription ID'];
  const calendar = complimentary ? monthlyPeriod(company.createdTime, now) : null;
  const start = calendar ? calendar.start : Date.parse(fields['Billing Period Start'] || (trial ? company.createdTime : ''));
  const end = calendar ? calendar.end : fields['Billing Period End'] ? Date.parse(fields['Billing Period End']) : trial ? start + 30 * 86400000 : NaN;
  if (!['Active', 'Trialing'].includes(fields.Status)) {
    throw new RequestError(403, 'Your subscription is inactive. Manage it through the Billing Portal.');
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new RequestError(503, 'Your billing period needs synchronization. Please contact support.');
  }
  if (now < start || now >= end) {
    throw new RequestError(403, 'Your allowance has expired or renewal payment is pending.');
  }
  const quota = trial ? 60 : QUOTAS[fields['Subscription Tier'] || (complimentary ? fields['Calculated Tier'] : '')];
  if (!quota) throw new RequestError(503, 'Your subscription plan needs review.');
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), quota };
}

async function rpc(config, name, body) {
  const response = await fetch(config.url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new RequestError(503, 'Credit verification is temporarily unavailable.');
  return response.json();
}

// Read existing linked rows in bounded batches. Old submissions without a
// reservation marker remain chargeable; new rows are counted in Postgres only.
async function history(company, root, headers) {
  const ids = company.fields['Proposals Pipeline'] || [];
  const records = [];
  if (!Array.isArray(ids) || ids.some(id => !/^rec[A-Za-z0-9]+$/.test(id))) {
    throw new RequestError(503, 'Account usage needs review.');
  }
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    const query = new URLSearchParams({ filterByFormula: 'OR(' + batch.map(id => "RECORD_ID()='" + id + "'").join(',') + ')' });
    for (const field of ['Created Date', 'Pipeline Status', 'Credit Reservation ID']) query.append('fields[]', field);
    let offset;
    do {
      if (offset) query.set('offset', offset);
      const response = await fetch(root + '/'+require('./billing-source').billingSource().proposals+'?' + query, { headers, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new RequestError(503, 'Account usage is temporarily unavailable.');
      const data = await response.json();
      if (!Array.isArray(data.records)) throw new RequestError(503, 'Account usage needs review.');
      records.push(...data.records);
      offset = data.offset;
    } while (offset);
  }
  if (records.length !== ids.length) throw new RequestError(503, 'Account usage is still synchronizing. Please try again.');
  return records;
}

async function reserve(config, user, submissionId, company, root, headers) {
  const period = entitlement(company);
  const records = await history(company, root, headers);
  let legacyUsed = 0;
  for (const record of records) {
    const fields = record.fields || {};
    const marker = fields['Credit Reservation ID'];
    if (marker && FAILED.has(fields['Pipeline Status'])) {
      await rpc(config, 'release_failed_credit', {
        p_submission_id: marker, p_company_id: company.id, p_record_id: record.id
      });
    }
    if (!marker && !FAILED.has(fields['Pipeline Status'])) {
      const created = Date.parse(fields['Created Date'] || record.createdTime);
      if (!Number.isFinite(created)) throw new RequestError(503, 'Account usage needs review.');
      if (created >= Date.parse(period.start) && created < Date.parse(period.end)) legacyUsed++;
    }
  }
  const result = await rpc(config, 'reserve_proposal_credit', {
    p_submission_id: submissionId, p_user_id: user.id, p_company_id: company.id,
    p_period_start: period.start, p_period_end: period.end, p_quota: period.quota,
    p_legacy_used: legacyUsed
  });
  if (result.code === 'quota_exceeded') throw new RequestError(429, 'Your proposal allowance for this billing period has been reached.');
  if (result.code === 'period_expired') throw new RequestError(403, 'Your allowance has expired or renewal payment is pending.');
  if (result.code !== 'reserved') throw new RequestError(503, 'Credit verification needs review.');
}

async function finish(config, submissionId, status, recordId) {
  return rpc(config, 'finish_proposal_credit', {
    p_submission_id: submissionId, p_status: status, p_record_id: recordId || null
  });
}

// Read-only balance: mirror reservation accounting without reserving/releasing credits.
async function summary(config,company,root,headers,now=Date.now()) {
  if (!/^rec[A-Za-z0-9]+$/.test(company.id||'')) throw new RequestError(503,'Your billing account needs review.');
  const fields=company.fields||{},plan=fields['Subscription Tier']||(fields['Complimentary Access']===true?fields['Calculated Tier']:null);
  let period;
  try { period=entitlement(company,now); } catch(e) {
    if(e.status!==403)throw e;
    return {available:false,state:'inactive',plan:plan||null,message:e.message};
  }
  const records=await history(company,root,headers);
  const failed=new Map(records.filter(r=>FAILED.has(r.fields?.['Pipeline Status'])&&r.fields?.['Credit Reservation ID']).map(r=>[r.fields['Credit Reservation ID'],r.id]));
  let legacyUsed=0;
  for(const r of records){const f=r.fields||{};if(f['Credit Reservation ID']||FAILED.has(f['Pipeline Status']))continue;const at=Date.parse(f['Created Date']||r.createdTime);if(!Number.isFinite(at))throw new RequestError(503,'Account usage needs review.');if(at>=Date.parse(period.start)&&at<Date.parse(period.end))legacyUsed++;}
  let held=0;
  for(let offset=0;offset<10000;offset+=1000){
    const q=new URLSearchParams({company_id:'eq.'+company.id,status:'neq.released',and:'(reserved_at.gte.'+period.start+',reserved_at.lt.'+period.end+')',select:'submission_id,record_id,status',order:'submission_id.asc',limit:'1000',offset:String(offset)});
    const r=await fetch(config.url+'/rest/v1/proposal_credit_reservations?'+q,{headers:{apikey:config.serviceKey,Authorization:'Bearer '+config.serviceKey},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new RequestError(503,'Account usage is temporarily unavailable.');
    const rows=await r.json();if(!Array.isArray(rows))throw new RequestError(503,'Account usage needs review.');
    held+=rows.filter(r=>!(r.status==='queued'&&r.record_id&&failed.get(r.submission_id)===r.record_id)).length;
    if(rows.length<1000){const trial=fields.Status==='Trialing';return {available:true,state:trial?'trial':'active',plan:plan||(trial?'Legacy Enterprise trial':null),allowance:period.quota,used:held+legacyUsed,remaining:Math.max(0,period.quota-held-legacyUsed),periodStart:period.start,periodEnd:period.end,nextResetAt:trial?null:period.end,trialEndsAt:trial?period.end:null,asOf:new Date(now).toISOString()};}
  }
  throw new RequestError(503,'Account usage needs review.');
}
module.exports = { entitlement, monthlyPeriod, reserve, finish, rpc, summary };
