/* REMOTE CONFIG CLIENT (service worker only).
 * Keeps the shared feedback list current from the published config, with as few requests as possible:
 *
 *   throttle -> GET config/version.json (tiny) -> same/older version? stop.
 *            -> newer: GET config/feedback.json -> verify sha256 + schema -> cache.
 *
 * Any failure (offline, timeout, bad JSON, empty list, wrong hash) keeps the last known good cache.
 * Only JSON data is downloaded. No code is ever fetched or executed. */
(function (root) {
  'use strict';

  const DEFAULTS = { throttleMs: 15 * 60 * 1000, errorRetryMs: 2 * 60 * 1000, timeoutMs: 8000 };

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** deps: { baseUrl, fetchFn?, store, schema, now?, throttleMs?, errorRetryMs?, timeoutMs? } */
  function createRemoteConfig(deps) {
    const { store, schema } = deps;
    const base = String(deps.baseUrl).replace(/\/+$/, '') + '/';
    // https only. Plain http is accepted solely for loopback hosts so tests can use a local server.
    if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(base)) throw new Error('Remote config must use https');
    const doFetch = deps.fetchFn || ((u, o) => fetch(u, o));
    const now = deps.now || Date.now;
    const throttleMs = deps.throttleMs != null ? deps.throttleMs : DEFAULTS.throttleMs;
    const errorRetryMs = deps.errorRetryMs != null ? deps.errorRetryMs : DEFAULTS.errorRetryMs;
    const timeoutMs = deps.timeoutMs != null ? deps.timeoutMs : DEFAULTS.timeoutMs;
    let running = null;

    async function getText(path) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        // 'no-cache' = always revalidate with the server, so a 304 costs almost nothing.
        const res = await doFetch(base + path, { signal: ctl.signal, cache: 'no-cache', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + path);
        const text = await res.text();
        if (text.length > schema.LIMITS.MAX_BYTES) throw new Error(path + ' is too large');
        return text;
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('Timed out fetching ' + path);
        throw e;
      } finally { clearTimeout(timer); }
    }
    function parseJson(text, what) { try { return JSON.parse(text); } catch (e) { throw new Error(what + ' is not valid JSON'); } }

    async function run(opts) {
      const st = await store.getRemoteState();
      const wait = st.lastError ? errorRetryMs : throttleMs;
      if (!(opts && opts.force) && st.lastCheck && now() - st.lastCheck < wait) return { status: 'throttled' };
      try {
        const infoText = await getText('config/version.json');
        const info = parseJson(infoText, 'version.json');
        const v = schema.validateVersionInfo(info);
        if (!v.ok) throw new Error('Invalid version.json: ' + v.errors.join('; '));

        const current = await store.getConfigVersion();
        if (schema.compareVersions(info.version, current) <= 0) {
          await store.setRemoteState({ lastCheck: now(), lastError: null, remoteVersion: info.version });
          return { status: 'unchanged', version: current };
        }

        const cfgText = await getText('config/feedback.json');
        if ((await sha256Hex(cfgText)) !== info.sha256) throw new Error('Integrity check failed (sha256 mismatch)');
        const cfg = parseJson(cfgText, 'feedback.json');
        const c = schema.validateConfig(cfg);
        if (!c.ok) throw new Error('Invalid feedback.json: ' + c.errors.join('; '));
        if (cfg.version !== info.version) throw new Error('version.json and feedback.json disagree');

        const res = await store.applyRemote(cfg);
        await store.setRemoteState({ lastCheck: now(), lastError: null, remoteVersion: cfg.version });
        return { status: res.applied ? 'updated' : 'deferred', version: cfg.version, reason: res.reason };
      } catch (e) {
        await store.setRemoteState({ lastCheck: now(), lastError: String(e && e.message || e) });
        return { status: 'error', error: String(e && e.message || e) };
      }
    }

    /** Concurrent callers (several Hub tabs opening at once) share one run. */
    function check(opts) {
      if (!running) running = run(opts).finally(() => { running = null; });
      return running;
    }
    return { check };
  }

  const out = { createRemoteConfig, sha256Hex, DEFAULTS };
  root.AFX = root.AFX || {};
  root.AFX.remoteConfig = out;
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
