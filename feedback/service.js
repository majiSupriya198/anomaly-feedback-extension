/* FEEDBACK SERVICE: the only entry point the UI uses.
 * Reads come from the local cache (works offline); writes need the right role AND the backend.
 * Every operation passes through authz first, so UI components never repeat permission logic. */
(function (root) {
  'use strict';

  const ROLE_TTL_MS = 5 * 60 * 1000;
  const NOW = () => Date.now();

  function createService(deps) {
    const { api, store, authz } = deps;
    const localIdentity = deps.localIdentity || null; // () => Promise<email>; used only when the backend is unreachable
    const A = authz.ACTIONS;
    let roleCache = null; // { role, email, at } — memory only, never persisted or trusted from storage
    let inflight = null;

    function err(code, message) { const e = new Error(message); e.code = code; return e; }

    /** Role comes from the backend (never from local storage). Unknown or unreachable = 'user'. */
    async function getIdentity(force) {
      if (!force && roleCache && NOW() - roleCache.at < ROLE_TTL_MS) return roleCache;
      if (inflight) return inflight;
      inflight = (async () => {
        let id = { role: authz.ROLES.USER, email: null, online: false, mode: 'none' };
        try { const me = await api.me(); id = { role: authz.normaliseRole(me && me.role), email: (me && me.email) || null, online: true, mode: 'backend' }; }
        catch (e) {
          // No backend: fall back to the account Chrome is signed into. Fails closed to 'user'.
          if (localIdentity) {
            try { const email = await localIdentity(); id = { role: authz.roleForEmail(email), email: email || null, online: false, mode: 'local' }; }
            catch (e2) { /* stay user */ }
          }
        }
        roleCache = Object.assign(id, { at: NOW() });
        return roleCache;
      })().finally(() => { inflight = null; });
      return inflight;
    }
    async function getRole(force) { return (await getIdentity(force)).role; }

    /** Refreshes the cache from the backend. On failure the existing cache is kept. */
    async function sync() {
      try {
        const list = await api.list();
        if (!Array.isArray(list)) throw err('INVALID', 'Unexpected response from feedback service.');
        if (await store.hasLocalEdits()) await store.backupLocal(); // never silently discard local admin edits
        await store.setAll(list);
        return { ok: true, offline: false, count: list.length };
      } catch (e) { return { ok: false, offline: true, error: e.message }; }
    }

    /** Items visible to the current role. Non-admins only ever see active, non-deleted items. */
    async function list(opts) {
      opts = opts || {};
      const role = await getRole();
      authz.assertCan(role, A.READ);
      const wantsHidden = !!(opts.includeInactive || opts.includeDeleted);
      if (wantsHidden) authz.assertCan(role, A.VIEW_INACTIVE);
      const all = await store.getAll();
      return all.filter((i) => {
        if (i.deletedAt) return !!opts.includeDeleted;
        if (!i.active) return !!opts.includeInactive;
        return true;
      });
    }

    function search(items, query, opts) {
      const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const cat = opts && opts.category ? String(opts.category).toLowerCase() : '';
      const uses = (opts && opts.uses) || {};
      const out = [];
      items.forEach((item, idx) => {
        if (cat && item.attributes.length && !item.attributes.some((a) => a.toLowerCase() === cat)) return;
        if (terms.length) {
          const h = (item.text + ' ' + item.attributes.join(' ')).toLowerCase();
          for (const t of terms) if (h.indexOf(t) === -1) return;
        }
        out.push({ item, idx });
      });
      const score = (i) => (uses[i.id] || 0) * 1000 + (i.popularity || 0);
      out.sort((a, b) => score(b.item) - score(a.item) || a.idx - b.idx);
      return out.map((o) => o.item);
    }

    function categories(items) {
      const c = new Map();
      items.forEach((i) => i.attributes.forEach((a) => c.set(a, (c.get(a) || 0) + 1)));
      return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    }

    /** Re-checks the role for a write and returns the identity (which says where the write goes). */
    async function guard(action) {
      const id = await getIdentity(true); // writes always re-check
      authz.assertCan(id.role, action);
      return id;
    }
    function validateText(text, all, selfId) {
      if (typeof text !== 'string' || text.trim() === '') throw err('EMPTY', 'Feedback text cannot be empty.');
      if (all.some((x) => x.id !== selfId && !x.deletedAt && x.text === text)) throw err('DUPLICATE', 'This exact feedback already exists.');
    }
    function cleanAttrs(a) { return Array.isArray(a) ? [...new Set(a.map((s) => String(s).trim()).filter(Boolean))] : []; }

    /** Backend mode: the server is the source of truth. Local mode (no backend): edit this browser's copy. */
    async function write(id, op) {
      if (id.mode === 'backend') {
        const item = await (op.type === 'create' ? api.create(op.body) : api.patch(op.id, op.body));
        return store.upsert(item);
      }
      const all = await store.getAll();
      const now = new Date().toISOString();
      let item;
      if (op.type === 'create') {
        const max = all.reduce((m, i) => Math.max(m, +((/^fb-(\d+)$/.exec(i.id) || [0, 0])[1])), 0);
        item = { id: 'fb-' + String(max + 1).padStart(3, '0'), text: op.body.text, active: true, attributes: op.body.attributes || [], popularity: 0, source: 'admin-local', createdAt: now, updatedAt: now, deletedAt: null };
      } else {
        const cur = all.find((i) => i.id === op.id);
        if (!cur) throw err('NOT_FOUND', 'Feedback not found: ' + op.id);
        item = Object.assign({}, cur, op.body.deleted === undefined ? op.body : Object.assign({}, op.body, { deleted: undefined }), { updatedAt: now });
        delete item.deleted;
        if (op.body.deleted === true) item.deletedAt = now;
        if (op.body.deleted === false) item.deletedAt = null;
      }
      const saved = await store.upsert(item);
      await store.markLocalEdits();
      return saved;
    }

    async function create(input) {
      const id = await guard(A.CREATE);
      validateText(input && input.text, await store.getAll(), null);
      return write(id, { type: 'create', body: { text: input.text, attributes: cleanAttrs(input.attributes) } });
    }
    async function update(itemId, patch) {
      const id = await guard(A.UPDATE);
      const body = {};
      if (patch && 'text' in patch) { validateText(patch.text, await store.getAll(), itemId); body.text = patch.text; }
      if (patch && 'attributes' in patch) body.attributes = cleanAttrs(patch.attributes);
      return write(id, { type: 'patch', id: itemId, body });
    }
    async function setActive(itemId, active) { const id = await guard(A.TOGGLE); return write(id, { type: 'patch', id: itemId, body: { active: !!active } }); }
    /** Soft delete: the item is hidden but kept, and can be restored. There is no hard delete. */
    async function remove(itemId) { const id = await guard(A.DELETE); return write(id, { type: 'patch', id: itemId, body: { deleted: true } }); }
    async function restore(itemId) { const id = await guard(A.RESTORE); return write(id, { type: 'patch', id: itemId, body: { deleted: false } }); }

    async function markUsed(id) { authz.assertCan(await getRole(), A.SELECT); return store.recordUse(id); }
    async function exportAll() { await guard(A.VIEW_INACTIVE); return JSON.stringify(await store.getAll(), null, 2); }
    async function hasLocalEdits() { return store.hasLocalEdits(); }

    return { getIdentity, getRole, hasLocalEdits, sync, list, search, categories, create, update, setActive, remove, restore, markUsed, exportAll,
      getUses: () => store.getUses(), getSettings: () => store.getSettings(), saveSettings: (p) => store.saveSettings(p) };
  }

  const out = { createService };
  root.AFX = root.AFX || {};
  root.AFX.feedbackService = out;
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
