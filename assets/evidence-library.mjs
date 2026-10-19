import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { extractText } from './rfp-document.mjs';
let configResponse;
try { configResponse = await fetch('/.netlify/functions/evidence-config', { cache: 'no-store' }); }
catch { document.getElementById('message').textContent = 'The evidence library could not connect. Refresh or try again later.'; throw new Error('Public configuration unavailable.'); }
if (!configResponse.ok) {
  document.getElementById('message').textContent = 'The evidence library is temporarily unavailable. Please try again later.';
  throw new Error('Public evidence configuration unavailable.');
}
const configuration = await configResponse.json();
const sb = createClient(configuration.url, configuration.key);
const $ = id => document.getElementById(id);
let accountId = null;
let page = 0;
let busy = false;
let pendingSave = null;
const message = text => { $('message').textContent = text; };

function clearSession() {
  accountId = null;
  pendingSave = null;
  $('workspace').hidden = true;
  $('login').hidden = false;
  $('evidence-form').reset();
  $('references').replaceChildren();
  message('Your session has expired. Log in again to manage your evidence.');
}

async function session() {
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) { clearSession(); throw new Error('Please log in again.'); }
  if (accountId && accountId !== data.user.id) { clearSession(); throw new Error('Account changed. Reload before continuing.'); }
  accountId = data.user.id;
  return data.user;
}

async function list(reset = false) {
  const user = await session();
  if (reset) { page = 0; $('references').replaceChildren(); }
  const { data, error } = await sb.from('proposal_evidence').select('id,title,kind,sector,source_label,outcome,approved,content')
    .eq('user_id', user.id).order('created_at', { ascending: false }).order('id').range(page * 20, page * 20 + 19);
  if (error) throw new Error('The evidence library could not load. Please try again or contact support if setup is pending.');
  if (accountId !== user.id) return;
  for (const row of data) {
    const card = document.createElement('article');
    const title = document.createElement('h3'); title.textContent = row.title;
    const details = document.createElement('p'); details.textContent = `${row.kind.replaceAll('_', ' ')} · ${row.sector} · ${row.outcome} · ${row.approved ? 'Approved' : 'Not approved'}`;
    const source = document.createElement('p'); source.textContent = row.source_label;
    const disclosure = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Review saved text';
    const text = document.createElement('p'); text.style.whiteSpace = 'pre-wrap'; text.textContent = row.content;
    disclosure.append(summary, text);
    const approve = document.createElement('button'); approve.className = 'secondary';
    approve.textContent = row.approved ? 'Withdraw approval' : 'Approve for reuse';
    approve.onclick = () => action(approve, async () => {
      await session();
      const result = await sb.from('proposal_evidence').update({ approved: !row.approved }).eq('id', row.id).eq('user_id', user.id).select('id');
      if (result.error || result.data?.length !== 1) throw new Error('Approval could not be updated.');
      await list(true); message('Approval updated for future proposals.');
    });
    const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = 'Delete reference';
    remove.onclick = () => action(remove, async () => {
      if (!confirm('Delete this reference? Existing proposal excerpts will remain.')) return;
      await session();
      const result = await sb.from('proposal_evidence').delete().eq('id', row.id).eq('user_id', user.id).select('id');
      if (result.error || result.data?.length !== 1) throw new Error('Reference could not be deleted.');
      await list(true); message('Reference deleted.');
    });
    card.append(title, details, source, disclosure, approve, remove); $('references').append(card);
  }
  $('more').hidden = data.length < 20;
}

async function action(button, task) {
  if (busy) return;
  busy = true; button.disabled = true;
  try { await task(); } catch (error) { message(error.message); }
  finally { busy = false; button.disabled = false; }
}

$('document').onchange = () => action($('save'), async () => {
  await session();
  const file = $('document').files[0]; if (!file) return;
  const text = await extractText(file);
  if (text.length > 30000) throw new Error('Use a smaller document or paste selected excerpts within 30,000 characters.');
  if (!accountId) return;
  $('content').value = text; $('approved').checked = false;
  message('Text extracted. Review it and confirm permission before saving.');
});
$('evidence-form').onsubmit = event => {
  event.preventDefault();
  action($('save'), async () => {
    const user = await session();
    const sourceRow = { user_id: user.id, title: $('title').value.trim(),
      kind: $('kind').value, sector: $('sector').value, source_label: $('source').value.trim(),
      outcome: $('outcome').value, content: $('content').value.trim(),
      rights_confirmed: $('rights').checked, approved: $('approved').checked };
    const signature = JSON.stringify(sourceRow);
    if (!pendingSave || pendingSave.signature !== signature) pendingSave = { signature, id: crypto.randomUUID() };
    const row = { id: pendingSave.id, ...sourceRow };
    if (!row.title || !row.source_label || !row.content || !row.rights_confirmed) throw new Error('Complete the reference and permission confirmation.');
    const { error } = await sb.from('proposal_evidence').insert(row);
    if (error) {
      const saved = await sb.from('proposal_evidence').select('id').eq('id', row.id).eq('user_id', user.id);
      if (saved.error || saved.data?.length !== 1) throw new Error('Save could not be confirmed. Retry with the same inputs or refresh the reference list.');
    }
    if (accountId !== user.id) return;
    pendingSave = null;
    $('evidence-form').reset(); await list(true); message('Reference saved. Only approved, relevant excerpts are eligible for retrieval.');
  });
};
$('more').onclick = () => action($('more'), async () => { page += 1; try { await list(); } catch (error) { page -= 1; throw error; } });
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session || (accountId && session.user.id !== accountId)) clearSession();
});
try { await session(); $('workspace').hidden = false; $('login').hidden = true; await list(true); message(configuration.enabled ? 'Your private references are ready for retrieval.' : 'Your private references are saved here. Retrieval is awaiting activation for this environment.'); }
catch (error) { message(error.message); }
