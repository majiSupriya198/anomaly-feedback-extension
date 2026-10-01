/* FEEDBACK SERVICE: the only entry point the UI uses.
 * Reads come from the local cache (works offline); writes need the right role AND the backend.
 * Every operation passes through authz first, so UI components never repeat permission logic. */
(function (root) {
  'use strict';

  const ROLE_TTL_MS = 5 * 60 * 1000;
  const NOW = () => Date.now();

  function createService(deps) {
    const { api, store, authz } = deps;
    const A = authz.ACTIONS;
    let roleCache = null; // { role, email, at } — memory only, never persisted or trusted from storage
    let inflight = null;

    function err(code, message) { const e = new Error(message); e.code = code; return e; }

    /** Role comes from the backend (never from local storage). Unknown or unreachable = 'user'. */
    async function getIdentity(force) {
      if (!force && roleCache && NOW() - roleCache.at < ROLE_TTL_MS) return roleCache;
      if (inflight) return inflight;
      inflight = (async () => {
        let id = { role: authz.ROLES.USER, email: null, online: false };
        try { const me = await api.me(); id = { role: authz.normaliseRole(me && me.role), email: (me && me.email) || null, online: true }; }
        catch (e) { /* fail closed to user */ }
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

    async function guard(action) {
      const role = await getRole(true); // writes always re-check the role
      authz.assertCan(role, action);
    }
    async function applyWrite(promise) {
      const item = await promise; // backend is the source of truth
      return store.upsert(item);
    }
    function validateText(text, all, selfId) {
      if (typeof text !== 'string' || text.trim() === '') throw err('EMPTY', 'Feedback text cannot be empty.');
      if (all.some((x) => x.id !== selfId && !x.deletedAt && x.text === text)) throw err('DUPLICATE', 'This exact feedback already exists.');
    }
    function cleanAttrs(a) { return Array.isArray(a) ? [...new Set(a.map((s) => String(s).trim()).filter(Boolean))] : []; }

    async function create(input) {
      await guard(A.CREATE);
      validateText(input && input.text, await store.getAll(), null);
      return applyWrite(api.create({ text: input.text, attributes: cleanAttrs(input.attributes) }));
    }
    async function update(id, patch) {
      await guard(A.UPDATE);
      const body = {};
      if (patch && 'text' in patch) { validateText(patch.text, await store.getAll(), id); body.text = patch.text; }
      if (patch && 'attributes' in patch) body.attributes = cleanAttrs(patch.attributes);
      return applyWrite(api.patch(id, body));
    }
    async function setActive(id, active) { await guard(A.TOGGLE); return applyWrite(api.patch(id, { active: !!active })); }
    /** Soft delete: the item is hidden but kept, and can be restored. There is no hard delete. */
    async function remove(id) { await guard(A.DELETE); return applyWrite(api.patch(id, { deleted: true })); }
    async function restore(id) { await guard(A.RESTORE); return applyWrite(api.patch(id, { deleted: false })); }

    async function markUsed(id) { authz.assertCan(await getRole(), A.SELECT); return store.recordUse(id); }
    async function exportAll() { await guard(A.VIEW_INACTIVE); return JSON.stringify(await store.getAll(), null, 2); }

    return { getIdentity, getRole, sync, list, search, categories, create, update, setActive, remove, restore, markUsed, exportAll,
      getUses: () => store.getUses(), getSettings: () => store.getSettings(), saveSettings: (p) => store.saveSettings(p) };
  }

  const out = { createService };
  root.AFX = root.AFX || {};
  root.AFX.feedbackService = out;
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
