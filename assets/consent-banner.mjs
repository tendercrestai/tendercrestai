// One combined first-visit consent banner for the four opt-in providers
// (usage analytics, OpenAI advertising, Google measurement, Rewardful
// attribution). Each provider keeps its own localStorage key and its own
// footer "Privacy choices" settings button; this module only renders the
// single banner that replaces the four stacked first-visit panels.
//
// Providers register during their own init. The banner shows when any
// registered provider still needs a choice, and hides once every provider
// has one. It is a fixed bottom banner, so the page hero stays visible
// on first visit. Providers that load on only some pages (OpenAI and
// Google load only on the homepage and demo) simply do not register
// elsewhere, and the banner renders only the providers present.
//
// The module guards all DOM access so it can be imported in Node for
// tests; registration is a no-op store without a document.
const options = new Map();
const statuses = new Map();
let banner = null;
let renderScheduled = false;
let currentFocusId = null;

function doc() {
  return typeof document !== 'undefined' ? document : null;
}
function element(tag, text) {
  const d = doc();
  const e = d.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}
function hasChoice(option) {
  try {
    return !!option.readChoice();
  } catch {
    return false;
  }
}
function shouldPrompt(option) {
  try {
    return typeof option.shouldPrompt === 'function'
      ? option.shouldPrompt()
      : !hasChoice(option);
  } catch {
    return false;
  }
}
function canAllow(option) {
  try {
    return typeof option.canAllow === 'function' ? option.canAllow() : true;
  } catch {
    return true;
  }
}
function statusText(option) {
  if (statuses.has(option.id)) return statuses.get(option.id);
  try {
    return typeof option.getStatus === 'function' ? option.getStatus() || '' : '';
  } catch {
    return '';
  }
}
function showStatusLink(option) {
  try {
    return !option.statusLink || (typeof option.showStatusLink !== 'function' || option.showStatusLink());
  } catch {
    return false;
  }
}
function stateLabel(option) {
  let saved = null;
  try {
    saved = option.readChoice();
  } catch {
    saved = null;
  }
  if (!saved) return 'Not set';
  return saved.allowed === true ? 'Allowed' : 'Declined';
}
function ensureBanner() {
  const d = doc();
  if (!d || banner) return banner;
  banner = element('section');
  banner.id = 'consent-banner';
  banner.setAttribute('aria-label', 'Privacy choices');
  banner.hidden = true;
  banner.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:200;max-height:46vh;overflow:auto;background:#fff;color:#17243b;border-top:1px solid #94a3b8;box-shadow:0 -4px 16px rgb(0 0 0/.12);padding:12px 16px;font:inherit';
  d.body.append(banner);
  return banner;
}
function refocus() {
  const d = doc();
  if (!d || !banner || banner.hidden) return;
  let target = null;
  if (currentFocusId) {
    target = banner.querySelector('[data-consent-id="' + currentFocusId + '"] button');
  }
  if (!target) target = banner.querySelector('button');
  if (target && typeof target.focus === 'function') target.focus();
}
function decide(option, allowed) {
  let saved = true;
  try {
    saved = option.saveChoice(allowed) !== false;
  } catch {
    saved = false;
  }
  if (!saved) {
    setConsentStatus(option.id, 'Your choice could not be saved. Check your browser storage settings; this stays disabled for now.');
  } else {
    try {
      if (option.onDecision) option.onDecision(allowed);
    } catch {
      /* A provider side effect must not break the banner. */
    }
  }
  currentFocusId = option.id;
  render();
  evaluate();
  refocus();
}
function decideAll(allowed) {
  for (const option of options.values()) {
    if (allowed && !canAllow(option)) continue;
    try {
      const saved = option.saveChoice(allowed) !== false;
      if (saved && option.onDecision) option.onDecision(allowed);
    } catch {
      /* A provider side effect must not break the banner. */
    }
  }
  currentFocusId = null;
  render();
  evaluate();
}
function rowFor(option) {
  const row = element('div');
  row.setAttribute('data-consent-id', option.id);
  row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;border-top:1px solid #e2e8f0;padding:10px 0';
  const text = element('div');
  text.style.cssText = 'flex:1;min-width:220px';
  const title = element('strong', option.title + ' — ' + stateLabel(option));
  text.append(title);
  const summary = element('p', option.summary);
  summary.style.cssText = 'margin:2px 0';
  text.append(summary);
  if (option.detailsHref) {
    const link = element('a', option.detailsText || 'Privacy details');
    link.href = option.detailsHref;
    text.append(link);
  }
  const status = statusText(option);
  if (status) {
    const note = element('p', status);
    note.setAttribute('role', 'status');
    note.style.cssText = 'margin:6px 0 0';
    text.append(note);
    if (option.statusLink && showStatusLink(option)) {
      const home = element('a', option.statusLink.text);
      home.href = option.statusLink.href;
      text.append(home);
    }
  }
  row.append(text);
  const actions = element('div');
  actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  for (const [label, allowed] of [['Allow', true], ['Decline', false]]) {
    const b = element('button', label);
    b.type = 'button';
    b.style.cssText = 'font:inherit;padding:8px 12px;border:1px solid #64748b;border-radius:6px;background:#eef2ff;color:#17243b;cursor:pointer';
    if (allowed && !canAllow(option)) b.disabled = true;
    let saved = null;
    try {
      saved = option.readChoice();
    } catch {
      saved = null;
    }
    if (saved && saved.allowed === allowed) b.setAttribute('aria-pressed', 'true');
    b.onclick = () => decide(option, allowed);
    actions.append(b);
  }
  row.append(actions);
  return row;
}
function render() {
  const b = ensureBanner();
  if (!b) return;
  while (b.firstChild) b.removeChild(b.firstChild);
  const heading = element('h2', 'Privacy choices');
  heading.style.cssText = 'margin:0 0 4px;font-size:1rem';
  b.append(heading);
  const intro = element('p', 'Choose what TenderCrest AI may measure. Each choice is separate, stored for 30 days, and can be changed anytime from the Privacy choices buttons in the footer.');
  intro.style.cssText = 'margin:0';
  b.append(intro);
  for (const option of options.values()) b.append(rowFor(option));
  const actions = element('div');
  actions.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-top:12px';
  for (const [label, allowed] of [['Allow all', true], ['Decline all', false]]) {
    const button = element('button', label);
    button.type = 'button';
    button.style.cssText = 'font:inherit;padding:10px 14px;border:1px solid #64748b;border-radius:6px;background:#1d4ed8;color:#fff;cursor:pointer';
    button.onclick = () => decideAll(allowed);
    actions.append(button);
  }
  b.append(actions);
}
function evaluate() {
  const b = ensureBanner();
  if (!b) return;
  b.hidden = ![...options.values()].some(shouldPrompt);
}
function schedule() {
  if (renderScheduled) return;
  renderScheduled = true;
  setTimeout(() => {
    renderScheduled = false;
    render();
    evaluate();
  }, 0);
}
export function registerConsentOption(option) {
  if (!option || typeof option.id !== 'string') return;
  options.set(option.id, option);
  schedule();
}
export function setConsentStatus(id, text) {
  statuses.set(id, text || '');
  render();
}
// Open the banner on demand, e.g. from a footer "Privacy choices"
// settings button. Shows every registered provider with its current
// choice, so a saved choice can be changed.
export function showConsentBanner(focusId) {
  const b = ensureBanner();
  if (!b) return;
  currentFocusId = focusId || null;
  render();
  b.hidden = false;
  refocus();
}
