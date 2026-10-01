/* Reference implementation of the feedback API for local development and tests.
 * It enforces the SAME policy as the extension (authz/authz.js) on the server side, which is where
 * enforcement must live in production. Identity here is a dev-only X-Dev-User header; the real
 * backend must derive identity from the Anomaly Hub session instead. Never deploy this file.
 *
 *   node server/dev-server.cjs                                  (admins: INITIAL_ADMINS below)
 *   DEV_ADMINS=a@x.com,b@x.com node server/dev-server.cjs       (override)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const authz = require('../authz/authz.js');
const { ACTIONS: A } = authz;

// Initial admins. In production these two accounts must be seeded as admins in the Hub's user store.
const INITIAL_ADMINS = ['supriya.m@commerceiq.ai', 'diwagar.j@commerceiq.ai'];

function createServer(opts) {
  opts = opts || {};
  const admins = new Set((opts.admins || []).map((s) => s.toLowerCase()));
  let items = JSON.parse(fs.readFileSync(opts.seedFile || path.join(__dirname, '../data/feedback.json'), 'utf8'));
  const now = () => new Date().toISOString();
  const nextId = () => 'fb-' + String(items.reduce((m, i) => Math.max(m, +(/^fb-(\d+)$/.exec(i.id) || [0, 0])[1]), 0) + 1).padStart(3, '0');

  function identity(req) {
    const email = (req.headers['x-dev-user'] || '').toString().toLowerCase();
    if (!email) return null;
    return { email, role: admins.has(email) ? authz.ROLES.ADMIN : authz.ROLES.USER };
  }
  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' });
    res.end(JSON.stringify(data));
  }
  function body(req) {
    return new Promise((resolve, reject) => {
      let s = '';
      req.on('data', (c) => { s += c; if (s.length > 1e6) reject(new Error('too large')); });
      req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    });
  }
  const visible = (role) => (role === 'admin' ? items : items.filter((i) => i.active && !i.deletedAt));

  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, 'http://x');
    const who = identity(req);
    if (!who) return send(res, 401, { error: 'Not signed in.' });
    try {
      if (req.method === 'GET' && url.pathname === '/feedback/me') return send(res, 200, who);
      if (req.method === 'GET' && url.pathname === '/feedback') {
        authz.assertCan(who.role, A.READ);
        return send(res, 200, visible(who.role));
      }
      if (req.method === 'POST' && url.pathname === '/feedback') {
        authz.assertCan(who.role, A.CREATE);
        const b = await body(req);
        if (typeof b.text !== 'string' || !b.text.trim()) return send(res, 400, { error: 'Feedback text cannot be empty.' });
        if (items.some((i) => !i.deletedAt && i.text === b.text)) return send(res, 409, { error: 'This exact feedback already exists.' });
        const item = { id: nextId(), text: b.text, active: true, attributes: Array.isArray(b.attributes) ? b.attributes : [], popularity: 0, source: 'admin', createdAt: now(), updatedAt: now(), deletedAt: null };
        items.push(item);
        return send(res, 201, item);
      }
      const m = /^\/feedback\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (req.method === 'PATCH' && m) {
        const item = items.find((i) => i.id === m[1]);
        const b = await body(req);
        // Authorize every field being changed BEFORE touching anything.
        if ('text' in b || 'attributes' in b) authz.assertCan(who.role, A.UPDATE);
        if ('active' in b) authz.assertCan(who.role, A.TOGGLE);
        if (b.deleted === true) authz.assertCan(who.role, A.DELETE);
        if (b.deleted === false) authz.assertCan(who.role, A.RESTORE);
        if (!item) return send(res, 404, { error: 'Not found.' });
        if ('text' in b) {
          if (typeof b.text !== 'string' || !b.text.trim()) return send(res, 400, { error: 'Feedback text cannot be empty.' });
          if (items.some((i) => i.id !== item.id && !i.deletedAt && i.text === b.text)) return send(res, 409, { error: 'This exact feedback already exists.' });
          item.text = b.text;
        }
        if ('attributes' in b && Array.isArray(b.attributes)) item.attributes = b.attributes;
        if ('active' in b) item.active = !!b.active;
        if (b.deleted === true) item.deletedAt = now();
        if (b.deleted === false) item.deletedAt = null;
        item.updatedAt = now();
        return send(res, 200, item);
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (e) {
      if (e.code === 'FORBIDDEN') return send(res, 403, { error: e.message });
      return send(res, 400, { error: 'Bad request.' });
    }
  });
}

module.exports = { createServer, INITIAL_ADMINS };
if (require.main === module) {
  const fromEnv = (process.env.DEV_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const admins = fromEnv.length ? fromEnv : INITIAL_ADMINS;
  createServer({ admins }).listen(8787, '127.0.0.1', () => console.log('Dev feedback API on http://127.0.0.1:8787 admins=' + (admins.join(',') || '(none)')));
}
