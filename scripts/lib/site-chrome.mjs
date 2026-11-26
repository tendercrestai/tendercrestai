// Shared site header and footer for public pages, rendered by the build
// (scripts/build-site.mjs) from a single source of truth. Source pages
// carry <!-- @site-header --> / <!-- @site-footer --> placeholders where
// their old header/footer used to be. Pages that keep their own chrome
// (the app, auth, verification file) are left untouched.
//
// The homepage keeps its tab header and its footer extras (tab links,
// the Terms & Disclaimers modal button, the Stripe billing-portal link);
// every other public page gets the standard header and footer.
//
// Link targets follow the site's existing conventions: clean URLs only
// where netlify.toml has a rewrite (/tools/shredder, /opportunities,
// /teardowns, /compare, /partners, /pricing, /affiliates, /about);
// .html suffixes elsewhere (/demo.html, /product.html, /samples.html,
// /contact.html, /security.html, /privacy.html, /terms.html, /auth.html).
const NAV = [
  { label: 'Free Shredder', href: '/tools/shredder' },
  { label: 'Bid Checker', href: '/tools/bid-check' },
  { label: 'Opportunities', href: '/opportunities' },
  { label: 'Teardowns', href: '/teardowns' },
  { label: 'Interactive demo', href: '/demo.html' },
  { label: 'Compare', href: '/compare' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Partners', href: '/affiliates' },
];
const COLUMNS = [
  { title: 'Product', links: [
    ['Free Shredder', '/tools/shredder'],
    ['Bid Checker', '/tools/bid-check'],
    ['Opportunities', '/opportunities'],
    ['Teardowns', '/teardowns'],
    ['Interactive demo', '/demo.html'],
    ['Compare', '/compare'],
    ['Pricing', '/pricing'],
  ] },
  { title: 'Company', links: [
    ['About', '/about'],
    ['Become a Partner', '/affiliates'],
    ['Partner tools', '/partners'],
    ['Contact', '/contact.html'],
    ['My Account', '/auth.html', 'customer-auth-link'],
  ] },
  { title: 'Resources', links: [
    ['Grants', '/opportunities/grants'],
    ['Washington WEBS', '/opportunities/washington'],
    ['How it works', '/product.html'],
    ['Sample deliverables', '/samples.html'],
    ['Serverdex', 'https://serverdex.io/server/io-github-tendercrestai-tendercrest-ai'],
  ] },
  { title: 'Compare', links: [
    ['Responsive', '/compare/responsive'],
    ['Loopio', '/compare/loopio'],
    ['Qvidian', '/compare/qvidian'],
    ['Xait', '/compare/xait'],
    ['ChatGPT & Claude', '/compare/chatgpt'],
    ['Grantable', '/compare/grantable'],
    ['Granted AI', '/compare/granted-ai'],
    ['GrantParty', '/compare/grantparty'],
  ] },
  { title: 'Trust', links: [
    ['Security & Data Handling', '/security.html'],
    ['Privacy', '/privacy.html'],
    ['Terms', '/terms.html'],
  ] },
];
function navLinks() {
  return NAV.map((item) => `<a href="${item.href}">${item.label}</a>`).join('');
}
function actions() {
  return `<a href="/auth.html" class="site-login-link">Log in</a><a href="/pricing" class="site-trial-link">Start trial</a>`;
}
function columns() {
  return COLUMNS.map((col) => {
    const links = col.links.map(([label, href, id]) =>
      `<li><a href="${href}" class="footer-link"${id ? ` id="${id}"` : ''}>${label}</a></li>`).join('');
    return `<div class="site-footer-col"><h2>${col.title}</h2><ul>${links}</ul></div>`;
  }).join('');
}
export function siteHeader(page) {
  if (page === 'index') {
    return `<header><div class="nav-container"><a href="#overview" class="brand" onclick="switchTab('overview'); return false;"><div class="brand-icon">⚡</div><span>TenderCrest AI</span></a><div class="nav-right"><nav class="nav-tabs" aria-label="Main navigation"><button class="nav-tab-btn active" id="tab-btn-overview" aria-controls="tab-overview" aria-pressed="true" onclick="switchTab('overview')">Platform Overview</button><button class="nav-tab-btn" id="tab-btn-pricing" aria-controls="tab-pricing" aria-pressed="false" onclick="switchTab('pricing')">Pricing &amp; Plans</button><button class="nav-tab-btn" id="tab-btn-portal" aria-controls="tab-portal" aria-pressed="false" onclick="switchTab('portal')">Email a draft</button></nav><nav class="site-nav" aria-label="Site">${navLinks()}${actions()}</nav></div></div><script type="module" src="/assets/site-session.mjs"></script></header>`;
  }
  return `<header class="site-header"><a class="brand" href="/">TenderCrest AI</a><nav aria-label="Site" class="site-nav">${navLinks()}${actions()}</nav><script type="module" src="/assets/site-session.mjs"></script></header>`;
}
export function siteFooter(page) {
  let extra = '';
  if (page === 'index') {
    extra = `<div class="site-footer-extra"><a href="#overview" onclick="switchTab('overview');return false;" class="footer-link">Overview</a><a href="#pricing" onclick="switchTab('pricing');return false;" class="footer-link">Pricing</a><a href="#portal" onclick="switchTab('portal');return false;" class="footer-link">Portal</a><button type="button" onclick="openLegalModal()" class="footer-link">Terms &amp; Disclaimers</button><a href="https://billing.stripe.com/p/login/dRm9AT6PcaJT44U622dby00" target="_blank" rel="noopener noreferrer" class="footer-portal-link">Manage / Cancel Subscription</a></div>`;
  }
  return `<footer class="site-footer"><div class="site-footer-cols">${columns()}</div><div id="privacy-choices"><span>Privacy choices: </span></div>${extra}<div class="site-footer-copy">&copy; 2026 TenderCrest AI. All rights reserved.</div></footer>`;
}
