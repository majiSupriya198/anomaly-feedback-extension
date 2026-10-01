/* BACKEND CLIENT: thin wrapper over the feedback REST API (see docs/backend-api.md).
 * The transport is injected: in the extension it forwards to the service worker, which does the
 * actual fetch with the user's Hub session cookie. No API keys or tokens exist anywhere. */
(function (root) {
  'use strict';

  function fail(code, message, status) { const e = new Error(message); e.code = code; if (status) e.status = status; return e; }

  function createApi(transport) {
    async function call(method, path, body) {
      let res;
      try { res = await transport({ method, path, body }); }
      catch (e) { throw fail('OFFLINE', 'Feedback service is unreachable.'); }
      if (!res) throw fail('OFFLINE', 'Feedback service is unreachable.');
      if (res.ok) return res.data;
      const msg = (res.data && res.data.error) || ('Request failed (' + res.status + ')');
      if (res.status === 401 || res.status === 403) throw fail('FORBIDDEN', msg, res.status);
      if (res.status === 409) throw fail('DUPLICATE', msg, res.status);
      if (res.status === 404) throw fail('NOT_FOUND', msg, res.status);
      if (res.status === 400 || res.status === 422) throw fail('INVALID', msg, res.status);
      throw fail('OFFLINE', msg, res.status);
    }
    return {
      me: () => call('GET', '/feedback/me'),
      list: () => call('GET', '/feedback'),
      create: (body) => call('POST', '/feedback', body),
      patch: (id, body) => call('PATCH', '/feedback/' + encodeURIComponent(id), body),
    };
  }

  /** Transport used by extension pages and content scripts. */
  function messageTransport(req) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'afx.api', method: req.method, path: req.path, body: req.body }, (res) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(res);
        });
      } catch (e) { reject(e); }
    });
  }

  /** Asks the service worker for the Chrome profile email (content scripts cannot use chrome.identity). */
  function messageWhoAmI() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'afx.whoami' }, (res) => resolve(chrome.runtime.lastError || !res ? '' : (res.email || '')));
      } catch (e) { resolve(''); }
    });
  }

  const out = { createApi, messageTransport, messageWhoAmI };
  root.AFX = root.AFX || {};
  root.AFX.apiClient = out;
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
