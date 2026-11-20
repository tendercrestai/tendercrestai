const kb = require('./lib/knowledge-base'), F = require('./lib/free-tools'), B = require('./lib/bonfire-opportunities');
exports.handler = async event => { try {
 const p = kb.parse(event, 2000); if (!F.enabled()) kb.fail(503, 'The opportunity feed is not active on this deployment.');
 if (p.action === 'search') { kb.exact(p, ['action', 'keyword', 'page']); return kb.reply(200, await B.search(kb.configuration(), event, p, 'kcmo')); }
 if (p.action === 'detail') { kb.exact(p, ['action', 'notice']); return kb.reply(200, await B.detail(kb.configuration(), event, p.notice, 'kcmo')); }
 kb.fail(400, 'Unknown action.');
} catch (e) { return kb.reply(e.status || 503, {error: e.status ? e.message : 'Kansas City Bonfire opportunities are temporarily unavailable. No notices are implied.'}); } };
