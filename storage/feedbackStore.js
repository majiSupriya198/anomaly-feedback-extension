/* LOCAL CACHE LAYER: the only module that touches chrome.storage.local.
 * It is a dumb cache plus per-user preferences. It performs NO authorization:
 * every write must go through feedback/service.js, which checks the role and the backend.
 *
 * Item shape: { id:'fb-001', text, active, attributes:[], popularity, source,
 *               createdAt, updatedAt, deletedAt|null } */
(function (root) {
  'use strict';

  const schema = (root.AFX && root.AFX.configSchema) || (typeof require !== 'undefined' ? require('../feedback/configSchema.js') : null);

  const KEY_FEEDBACK = 'afx.feedback';
  const KEY_LEGACY = 'afx.options'; // v1 list (no roles, hard delete)
  const KEY_LEGACY_BACKUP = 'afx.legacyBackup';
  const KEY_USES = 'afx.uses';
  const KEY_SETTINGS = 'afx.settings';
  const KEY_SYNCED = 'afx.lastSync';
  const KEY_LOCAL_EDITS = 'afx.localEdits';
  const KEY_LOCAL_BACKUP = 'afx.localBackup';
  const KEY_CONFIG_VERSION = 'afx.configVersion'; // version of the list currently in the cache
  const KEY_REMOTE = 'afx.remoteConfig'; // last validated remote config (last known good)
  const KEY_REMOTE_STATE = 'afx.remoteState'; // { lastCheck, lastError, remoteVersion }
  const NO_VERSION = '0.0.0';
  const DEFAULT_SETTINGS = { insertMode: 'replace', confirmReplace: true };

  let backend = null;
  let seedLoader = null;
  let metaLoader = null;
  let metaPromise = null;
  let queue = Promise.resolve();

  function store() {
    return backend || (backend = {
      get: (keys) => chrome.storage.local.get(keys),
      set: (obj) => chrome.storage.local.set(obj),
    });
  }
  function serialise(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }
  // The extension ships a copy of config/feedback.json as the first-run and offline fallback.
  let bundledPromise = null;
  function loadBundled() {
    if (!bundledPromise) bundledPromise = fetch(chrome.runtime.getURL('config/feedback.json')).then((r) => r.json());
    return bundledPromise;
  }
  function defaultMetaLoader() {
    try { return loadBundled().then((c) => ({ version: c.version })).catch(() => ({ version: NO_VERSION })); }
    catch (e) { return Promise.resolve({ version: NO_VERSION }); }
  }
  function bundleMeta() { return metaPromise || (metaPromise = (metaLoader || defaultMetaLoader)().then((m) => ({ version: (schema.parseVersion(m && m.version) ? String(m.version) : NO_VERSION) }))); }
  function defaultSeedLoader() { return loadBundled().then((c) => c.items); }

  function normalise(raw, fallbackSource) {
    if (!raw || typeof raw.text !== 'string' || raw.text.trim() === '') return null;
    const now = new Date().toISOString();
    return {
      id: raw.id || null,
      text: raw.text,
      active: raw.active !== false,
      attributes: Array.isArray(raw.attributes) ? raw.attributes : [],
      popularity: Number.isFinite(raw.popularity) ? raw.popularity : (Number.isFinite(raw.uses) ? raw.uses : 0),
      source: raw.source || fallbackSource || 'user',
      createdAt: raw.createdAt || raw.updatedAt || now,
      updatedAt: raw.updatedAt || now,
      deletedAt: raw.deletedAt || null,
    };
  }

  function assignIds(list) {
    let max = 0;
    list.forEach((i) => { const m = /^fb-(\d+)$/.exec(i.id || ''); if (m) max = Math.max(max, +m[1]); });
    const seen = new Set();
    list.forEach((i) => {
      if (!i.id || seen.has(i.id)) i.id = 'fb-' + String(++max).padStart(3, '0');
      seen.add(i.id);
    });
    return list;
  }

  function fromLegacy(old) {
    return old.map((o) => {
      const item = normalise(o, o.source || 'legacy');
      if (item && /^feedback-\d+$/.test(o.id || '')) item.id = o.id.replace('feedback-', 'fb-');
      return item;
    }).filter(Boolean);
  }

  /** Returns the cached list, creating it on first use: migrate v1 data if present (keeping a
   *  backup of it), otherwise seed from the bundled data/feedback.json. */
  async function getAll() {
    const r = await store().get([KEY_FEEDBACK, KEY_CONFIG_VERSION, KEY_LOCAL_EDITS]);
    if (Array.isArray(r[KEY_FEEDBACK])) {
      // A newer bundled list (shipped with an extension update) replaces the cache, unless this
      // browser has local admin edits, which are never overwritten automatically.
      const meta = await bundleMeta();
      if (schema.compareVersions(meta.version, r[KEY_CONFIG_VERSION] || NO_VERSION) > 0 && !r[KEY_LOCAL_EDITS]) return reseed(meta.version);
      return r[KEY_FEEDBACK];
    }
    return serialise(async () => {
      const again = await store().get([KEY_FEEDBACK, KEY_LEGACY]);
      if (Array.isArray(again[KEY_FEEDBACK])) return again[KEY_FEEDBACK];
      const meta = await bundleMeta();
      let list;
      if (Array.isArray(again[KEY_LEGACY]) && again[KEY_LEGACY].length) {
        list = assignIds(fromLegacy(again[KEY_LEGACY]));
        await store().set({ [KEY_LEGACY_BACKUP]: again[KEY_LEGACY], [KEY_LOCAL_EDITS]: true }); // never lose v1 data
      } else {
        const seed = await (seedLoader || defaultSeedLoader)();
        list = assignIds(seed.map((s) => normalise(s, 'csv')).filter(Boolean));
      }
      await store().set({ [KEY_FEEDBACK]: list, [KEY_CONFIG_VERSION]: meta.version });
      return list;
    });
  }

  function reseed(version) {
    return serialise(async () => {
      const seed = await (seedLoader || defaultSeedLoader)();
      const list = assignIds(seed.map((s) => normalise(s, 'csv')).filter(Boolean));
      await store().set({ [KEY_FEEDBACK]: list, [KEY_CONFIG_VERSION]: version });
      return list;
    });
  }

  async function getConfigVersion() { return (await store().get([KEY_CONFIG_VERSION]))[KEY_CONFIG_VERSION] || NO_VERSION; }
  async function getRemoteState() { return (await store().get([KEY_REMOTE_STATE]))[KEY_REMOTE_STATE] || {}; }
  async function setRemoteState(patch) {
    return serialise(async () => {
      const cur = (await store().get([KEY_REMOTE_STATE]))[KEY_REMOTE_STATE] || {};
      const next = Object.assign({}, cur, patch);
      await store().set({ [KEY_REMOTE_STATE]: next });
      return next;
    });
  }

  /** Applies a validated remote config. Local admin edits are never overwritten: the config is kept
   *  as the last known good copy and reported as deferred. */
  async function applyRemote(cfg) {
    await getAll(); // make sure the cache exists
    return serialise(async () => {
      const edits = !!(await store().get([KEY_LOCAL_EDITS]))[KEY_LOCAL_EDITS];
      if (edits) { await store().set({ [KEY_REMOTE]: cfg }); return { applied: false, reason: 'local-edits' }; }
      const list = assignIds(cfg.items.map((i) => normalise(i, 'remote')).filter(Boolean));
      await store().set({ [KEY_FEEDBACK]: list, [KEY_CONFIG_VERSION]: cfg.version, [KEY_REMOTE]: cfg });
      return { applied: true };
    });
  }

  async function hasLocalEdits() { return !!(await store().get([KEY_LOCAL_EDITS]))[KEY_LOCAL_EDITS]; }
  async function markLocalEdits() { await store().set({ [KEY_LOCAL_EDITS]: true }); }
  /** Keeps a copy of the current list before the backend overwrites a locally edited cache. */
  async function backupLocal() {
    const r = await store().get([KEY_FEEDBACK]);
    await store().set({ [KEY_LOCAL_BACKUP]: r[KEY_FEEDBACK] || [] });
  }

  async function setAll(list) {
    return serialise(async () => {
      const clean = assignIds(list.map((i) => normalise(i)).filter(Boolean));
      // A list from the backend supersedes the bundle, so record the current bundle version.
      await store().set({ [KEY_FEEDBACK]: clean, [KEY_CONFIG_VERSION]: (await bundleMeta()).version, [KEY_SYNCED]: new Date().toISOString() });
      return clean;
    });
  }

  /** Insert or replace one item by id (used with the backend's response). */
  async function upsert(item) {
    await getAll(); // make sure the cache exists (seeded/migrated) before modifying it
    return serialise(async () => {
      const r = await store().get([KEY_FEEDBACK]);
      const list = Array.isArray(r[KEY_FEEDBACK]) ? r[KEY_FEEDBACK] : [];
      const clean = normalise(item);
      if (!clean || !clean.id) throw new Error('upsert needs an item with id and text');
      const i = list.findIndex((x) => x.id === clean.id);
      if (i >= 0) list[i] = clean; else list.push(clean);
      await store().set({ [KEY_FEEDBACK]: list });
      return clean;
    });
  }

  async function getUses() { return (await store().get([KEY_USES]))[KEY_USES] || {}; }
  async function recordUse(id) {
    try {
      await serialise(async () => {
        const uses = (await store().get([KEY_USES]))[KEY_USES] || {};
        uses[id] = (uses[id] || 0) + 1;
        await store().set({ [KEY_USES]: uses });
      });
    } catch (e) { /* ranking is best-effort */ }
  }

  async function getSettings() {
    const r = await store().get([KEY_SETTINGS]);
    return Object.assign({}, DEFAULT_SETTINGS, r[KEY_SETTINGS] || {});
  }
  async function saveSettings(patch) {
    const next = Object.assign(await getSettings(), patch);
    await store().set({ [KEY_SETTINGS]: next });
    return next;
  }
  async function getLastSync() { return (await store().get([KEY_SYNCED]))[KEY_SYNCED] || null; }

  const api = {
    KEY_FEEDBACK, KEY_LEGACY_BACKUP, KEY_USES,
    KEY_LOCAL_BACKUP, KEY_CONFIG_VERSION, KEY_REMOTE, KEY_REMOTE_STATE,
    getConfigVersion, getRemoteState, setRemoteState, applyRemote, getAll, setAll, upsert, hasLocalEdits, markLocalEdits, backupLocal, getUses, recordUse, getSettings, saveSettings, getLastSync,
    _normalise: normalise,
    _configure(o) { backend = o.backend || null; seedLoader = o.seedLoader || null; metaLoader = o.metaLoader || null; metaPromise = null; bundledPromise = null; queue = Promise.resolve(); },
  };
  root.AFX = root.AFX || {};
  root.AFX.store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
