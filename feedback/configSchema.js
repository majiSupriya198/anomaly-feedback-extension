/* SHARED-CONFIG SCHEMA: validation and version comparison for the remotely published config.
 * Pure functions with no Chrome APIs, so the extension, the CI build and the tests all use the
 * exact same rules. The config is DATA only: the extension never fetches or runs remote code. */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LIMITS = Object.freeze({ MAX_ITEMS: 5000, MAX_TEXT: 5000, MAX_BYTES: 2 * 1024 * 1024 });

  /** "1.0.12" (or a plain number) -> [1,0,12]; anything else -> null. */
  function parseVersion(v) {
    if (typeof v === 'number' && isFinite(v) && v >= 0) v = String(v);
    if (typeof v !== 'string' || !/^\d{1,9}(\.\d{1,9}){0,2}$/.test(v)) return null;
    const p = v.split('.').map(Number);
    while (p.length < 3) p.push(0);
    return p;
  }
  /** -1, 0 or 1. Throws on an invalid version so a bad value can never look "newer". */
  function compareVersions(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    if (!x || !y) throw new Error('Invalid version: ' + (x ? b : a));
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
  }

  const isDate = (s) => typeof s === 'string' && !isNaN(Date.parse(s));

  /** Small file fetched first. Tells the extension whether a download is needed. */
  function validateVersionInfo(v) {
    const errors = [];
    if (!v || typeof v !== 'object') return { ok: false, errors: ['version.json is not an object'] };
    if (v.schemaVersion !== SCHEMA_VERSION) errors.push('unsupported schemaVersion ' + v.schemaVersion);
    if (!parseVersion(v.version)) errors.push('invalid version');
    if (!isDate(v.updatedAt)) errors.push('invalid updatedAt');
    if (typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.sha256)) errors.push('invalid sha256');
    return { ok: errors.length === 0, errors };
  }

  /** The full shared config: { schemaVersion, version, updatedAt, items:[...] }. */
  function validateConfig(cfg) {
    const errors = [];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, errors: ['config is not an object'] };
    if (cfg.schemaVersion !== SCHEMA_VERSION) errors.push('unsupported schemaVersion ' + cfg.schemaVersion);
    if (!parseVersion(cfg.version)) errors.push('invalid version');
    if (!isDate(cfg.updatedAt)) errors.push('invalid updatedAt');
    if (!Array.isArray(cfg.items)) { errors.push('items must be an array'); return { ok: false, errors }; }
    if (cfg.items.length === 0) errors.push('items is empty');
    if (cfg.items.length > LIMITS.MAX_ITEMS) errors.push('too many items (' + cfg.items.length + ')');
    const ids = new Set(), texts = new Set();
    let active = 0;
    cfg.items.slice(0, LIMITS.MAX_ITEMS).forEach((it, n) => {
      const where = 'items[' + n + ']';
      if (!it || typeof it !== 'object') { errors.push(where + ' is not an object'); return; }
      if (typeof it.id !== 'string' || !/^fb-\d+$/.test(it.id)) errors.push(where + ' has an invalid id');
      else if (ids.has(it.id)) errors.push(where + ' duplicate id ' + it.id); else ids.add(it.id);
      if (typeof it.text !== 'string' || it.text.trim() === '') errors.push(where + ' has empty text');
      else if (it.text.length > LIMITS.MAX_TEXT) errors.push(where + ' text is too long');
      else if (!it.deletedAt) { if (texts.has(it.text)) errors.push(where + ' duplicate text'); texts.add(it.text); }
      if ('active' in it && typeof it.active !== 'boolean') errors.push(where + ' active must be a boolean');
      if ('attributes' in it && !(Array.isArray(it.attributes) && it.attributes.every((a) => typeof a === 'string'))) errors.push(where + ' attributes must be strings');
      if (it.active !== false && !it.deletedAt) active++;
    });
    if (cfg.items.length > 0 && active === 0) errors.push('no active items');
    return { ok: errors.length === 0, errors: errors.slice(0, 20) };
  }

  const api = { SCHEMA_VERSION, LIMITS, parseVersion, compareVersions, validateConfig, validateVersionInfo };
  root.AFX = root.AFX || {};
  root.AFX.configSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
