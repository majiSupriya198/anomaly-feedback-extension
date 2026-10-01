importScripts('../authz/authz.js', '../storage/feedbackStore.js', '../feedback/api.js', '../feedback/service.js');

// The service worker is the only place that talks to the backend. Pages and content scripts ask it
// through a narrow message: it will only call /feedback endpoints on the Hub origin.
const API_ORIGIN = 'https://anomaly-hub.ef.uk.com';
const DEV_ORIGIN = 'http://localhost:8787'; // optional host permission, for the dev server only
const API_PREFIX = '/api';
const PATH_RE = /^\/feedback(\/me|\/[A-Za-z0-9_-]+)?(\?[A-Za-z0-9_=&.-]*)?$/;
const METHODS = new Set(['GET', 'POST', 'PATCH']);

// Dev mode (afx.devApi = true) targets the local reference server and identifies the user with an
// X-Dev-User header. Production never sends it: identity comes from the Hub session cookie.
async function target() {
  const s = await chrome.storage.local.get(['afx.devApi', 'afx.devUser']);
  return s['afx.devApi'] === true
    ? { base: DEV_ORIGIN, extra: { 'X-Dev-User': String(s['afx.devUser'] || '') } }
    : { base: API_ORIGIN + API_PREFIX, extra: {} };
}

async function callBackend(req) {
  if (!req || !METHODS.has(req.method) || typeof req.path !== 'string' || !PATH_RE.test(req.path)) {
    return { ok: false, status: 400, data: { error: 'Blocked request.' } };
  }
  try {
    const t = await target();
    const res = await fetch(t.base + req.path, {
      method: req.method,
      credentials: 'include', // the user's existing Hub session; no keys or tokens are stored
      headers: Object.assign({}, t.extra, req.body ? { 'Content-Type': 'application/json' } : {}),
      body: req.body ? JSON.stringify(req.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON error body */ }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'Network error' } };
  }
}

const service = AFX.feedbackService.createService({
  api: AFX.apiClient.createApi((req) => callBackend(req)),
  store: AFX.store, authz: AFX.authz,
});

function profileEmail() {
  return new Promise((resolve) => {
    try { chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => resolve((info && info.email) || '')); }
    catch (e) { resolve(''); }
  });
}

async function warmUp() { try { await AFX.store.getAll(); await service.sync(); } catch (e) { console.warn('[afx] warm-up failed', e); } }
chrome.runtime.onInstalled.addListener(warmUp);
chrome.runtime.onStartup.addListener(warmUp);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg) return false;
  if (msg.type === 'afx.whoami') { profileEmail().then((email) => sendResponse({ email })); return true; }
  if (msg.type === 'afx.api') { callBackend(msg).then(sendResponse); return true; }
  if (msg.type === 'afx.openAdmin') { chrome.tabs.create({ url: chrome.runtime.getURL('admin/admin.html') }); return false; }
  if (msg.type === 'afx.openOptions') { chrome.runtime.openOptionsPage(); return false; }
  return false;
});
