const kb = require('./lib/knowledge-base'), F = require('./lib/free-tools'), S = require('./lib/socrata-opportunities');
exports.handler = async event => { try {
 const p = kb.parse(event, 2000); if (!F.enabled()) kb.fail(503, 'The opportunity feed is not active on this deployment.');
 if (p.action === 'search') { kb.exact(p, ['action', 'keyword', 'page']); return kb.reply(200, await S.search(kb.configuration(), event, p, 'montgomery-county')); }
 if (p.action === 'detail') { kb.exact(p, ['action', 'notice']); return kb.reply(200, await S.detail(kb.configuration(), event, p.notice, 'montgomery-county')); }
 kb.fail(400, 'Unknown action.');
} catch (e) { return kb.reply(e.status || 503, {error: e.status ? e.message : 'Montgomery County solicitations are temporarily unavailable. No notices are implied.'}); } };
